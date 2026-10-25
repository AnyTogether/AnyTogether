import { games, library } from "@anytogether/db";
import {
  ErrorCode,
  type GameBoard,
  type Leaderboard,
  type LeaderboardEntry,
  type LeaderboardScope,
  TitleId,
  defaultPrivacy,
  friendsBoardSeconds,
  gameBoards,
  globalBoardSeconds,
  leaderboardScopes,
  maxLeaderboardEntries,
} from "@anytogether/shared";
import { type SQL, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { levelsFor } from "./level.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { people } from "./people.js";

type Section = "library" | "trophies";
type Row = { id: string; value: number };

/** What a board ranks: an overall total, or one game's library rows. */
interface Board {
  /** Its name in Valkey keys: "points", "game:PPSA01234:time". */
  key: string;
  board: Leaderboard["board"];
  titleId: string | null;
  /** The sections that must be public for the global board (and not hidden from friends for the
   *  friends board): points only show trophies; a game's rows also show that the game is played. */
  sections: Section[];
  value: SQL;
}

const setting = (section: Section) =>
  sql.raw(`coalesce(p.privacy->>'${section}', '${defaultPrivacy[section]}')`);

const gameValue: Record<GameBoard, SQL> = {
  points: sql`l.points`,
  time: sql`l.seconds_played`,
  completion: sql`case when l.trophies_total > 0
    then least(100, l.trophies_earned * 100 / l.trophies_total) else 0 end`,
};

const pick = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  what: string,
) => {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T))
    throw new HttpError(400, ErrorCode.badRequest, `${what}: one of ${allowed.join(", ")}`);
  return value as T;
};

/** Ranks shared by equal values (1, 2, 2, 4). */
function ranked(rows: Row[], first = 1, before?: number): (Row & { rank: number })[] {
  let rank = first;
  let last = before;
  return rows.map((row, index) => {
    if (row.value !== last) rank = first + index;
    last = row.value;
    return { ...row, rank };
  });
}

/** Leaderboards: overall trophy points and per game points, play time and completion, among
 *  friends or everyone whose trophies (and, per game, library) are public. Global boards are kept
 *  in Valkey sorted sets for a minute, friends boards for half a minute per reader. */
export function leaderboardRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const { cards } = people(db);

  /** (account, value) for everyone the condition lets in, with a value above zero. */
  const rows = async (board: Board, who: SQL): Promise<Row[]> => {
    const value = board.titleId ? board.value : sql`sum(l.points)`;
    const result = await db.execute<{ id: string; value: number }>(sql`
      select l.account_id id, (${value})::bigint value
      from library l
      join profiles p on p.account_id = l.account_id
      join accounts a on a.id = l.account_id and a.status = 'active'
      where ${board.titleId ? sql`l.title_id = ${board.titleId}` : sql`true`} and ${who}
      ${board.titleId ? sql`and (${value}) > 0` : sql`group by l.account_id having sum(l.points) > 0`}
      order by value desc, l.account_id`);
    return [...result].map((r) => ({ id: r.id, value: Number(r.value) }));
  };

  const globalWho = (board: Board) =>
    sql`${sql.join(
      board.sections.map((section) => sql`${setting(section)} = 'everyone'`),
      sql` and `,
    )} and not exists (select 1 from earned_trophies e where e.account_id = l.account_id and e.flagged
      ${board.titleId ? sql`and e.title_id = ${board.titleId}` : sql``})`;

  const friendsWho = (board: Board, me: string) => sql`(l.account_id = ${me}::uuid or (
    l.account_id in (select case when f.user_a = ${me}::uuid then f.user_b else f.user_a end
      from friendships f where f.state = 'accepted' and (f.user_a = ${me}::uuid or f.user_b = ${me}::uuid))
    and ${sql.join(
      board.sections.map((section) => sql`${setting(section)} <> 'nobody'`),
      sql` and `,
    )}))`;

  /** The global board's sorted set, worked out again when it has expired; when it was made. */
  const globalSet = async (board: Board) => {
    const key = `lb:global:${board.key}`;
    const kept = await valkey.get(`${key}:at`);
    if (kept) return { key, at: kept };
    const list = await rows(board, globalWho(board));
    const at = new Date().toISOString();
    const building = `${key}:build:${uuidv7()}`;
    const multi = valkey.multi();
    for (let i = 0; i < list.length; i += 1000)
      multi.zadd(building, ...list.slice(i, i + 1000).flatMap((r) => [r.value, r.id]));
    if (list.length) multi.rename(building, key).expire(key, globalBoardSeconds);
    else multi.del(key);
    await multi.set(`${key}:at`, at, "EX", globalBoardSeconds).exec();
    return { key, at };
  };

  const pairs = (flat: string[]): Row[] => {
    const list: Row[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2)
      list.push({ id: flat[i] as string, value: Number(flat[i + 1]) });
    return list;
  };

  async function global(board: Board, me: string, limit: number) {
    const { key, at } = await globalSet(board);
    const higher = (value: number) => valkey.zcount(key, `(${value}`, "+inf");
    const [total, top, mine, place] = await Promise.all([
      valkey.zcard(key),
      valkey.zrevrange(key, 0, limit - 1, "WITHSCORES"),
      valkey.zscore(key, me),
      valkey.zrevrank(key, me),
    ]);
    let self: Leaderboard["me"];
    let around: (Row & { rank: number })[] = [];
    if (mine !== null) {
      const value = Number(mine);
      self = { rank: (await higher(value)) + 1, value, listed: true };
      if (place !== null && place >= limit) {
        const near = pairs(await valkey.zrevrange(key, Math.max(limit, place - 2), place + 2, "WITHSCORES"));
        around = await Promise.all(near.map(async (r) => ({ ...r, rank: (await higher(r.value)) + 1 })));
      }
    } else {
      // Not on the board (private, or nothing yet): where the reader would be.
      const value = (await rows(board, sql`l.account_id = ${me}::uuid`))[0]?.value ?? 0;
      self = { rank: value > 0 ? (await higher(value)) + 1 : null, value, listed: false };
    }
    return { entries: ranked(pairs(top)), self, around, total, at };
  }

  async function friends(board: Board, me: string, limit: number) {
    const key = `lb:friends:${me}:${board.key}`;
    const kept = await valkey.get(key);
    let list: Row[];
    let at: string;
    if (kept) ({ list, at } = JSON.parse(kept) as { list: Row[]; at: string });
    else {
      list = await rows(board, friendsWho(board, me));
      at = new Date().toISOString();
      await valkey.set(key, JSON.stringify({ list, at }), "EX", friendsBoardSeconds);
    }
    const all = ranked(list);
    const index = all.findIndex((r) => r.id === me);
    const self = all[index];
    return {
      entries: all.slice(0, limit),
      self: self
        ? { rank: self.rank, value: self.value, listed: true }
        : { rank: null, value: 0, listed: false },
      around: index >= limit ? all.slice(Math.max(limit, index - 2), index + 3) : [],
      total: all.length,
      at,
    };
  }

  async function answer(board: Board, me: string, query: (name: string) => string | undefined) {
    const scope = pick<LeaderboardScope>(query("scope"), leaderboardScopes, "friends", "scope");
    const raw = query("limit");
    const limit = raw === undefined ? maxLeaderboardEntries : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLeaderboardEntries)
      throw new HttpError(400, ErrorCode.badRequest, `limit: 1 to ${maxLeaderboardEntries}`);
    const result = scope === "global" ? await global(board, me, limit) : await friends(board, me, limit);
    const ids = [...result.entries, ...result.around].map((r) => r.id);
    const [byId, levels] = await Promise.all([cards(ids), levelsFor(db, me, ids)]);
    const shown = (list: (Row & { rank: number })[]): LeaderboardEntry[] =>
      list.flatMap((r) => {
        const user = byId.get(r.id);
        const level = levels.get(r.id);
        return user ? [{ rank: r.rank, user, value: r.value, ...(level ? { level } : {}) }] : [];
      });
    const game = board.titleId
      ? (await db.select().from(games).where(eq(games.titleId, board.titleId)))[0]
      : undefined;
    const body: Leaderboard = {
      board: board.board,
      scope,
      game: game ? { titleId: game.titleId, names: game.names, iconUrl: game.iconUrl } : null,
      entries: shown(result.entries),
      me: result.self,
      around: shown(result.around),
      total: result.total,
      updatedAt: result.at,
    };
    return body;
  }

  app.get("/leaderboards/points", async (c) =>
    c.json(
      await answer(
        { key: "points", board: "points", titleId: null, sections: ["trophies"], value: sql`l.points` },
        c.get("userId"),
        (name) => c.req.query(name),
      ),
    ),
  );

  app.get("/games/:titleId/leaderboard", async (c) => {
    const parsed = TitleId.safeParse(c.req.param("titleId"));
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const titleId = parsed.data;
    const [game] = await db.select({ titleId: games.titleId }).from(games).where(eq(games.titleId, titleId));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const by = pick<GameBoard>(c.req.query("by"), gameBoards, "points", "by");
    return c.json(
      await answer(
        {
          key: `game:${titleId}:${by}`,
          board: by,
          titleId,
          sections: by === "time" ? ["library"] : ["library", "trophies"],
          value: gameValue[by],
        },
        c.get("userId"),
        (name) => c.req.query(name),
      ),
    );
  });

  /** Games to pick a board from: the reader's own first, then the most played. */
  app.get("/leaderboards/games", async (c) => {
    const me = c.get("userId");
    const mine = sql<boolean>`bool_or(${library.accountId} = ${me}::uuid)`;
    const players = sql<number>`count(*)::int`;
    const list = await db
      .select({ titleId: games.titleId, names: games.names, iconUrl: games.iconUrl, players, mine })
      .from(library)
      .innerJoin(games, eq(games.titleId, library.titleId))
      .groupBy(games.titleId)
      .orderBy(desc(mine), desc(players), games.titleId)
      .limit(50);
    return c.json({ games: list });
  });

  return app;
}
