import {
  type Database,
  challengeEntries,
  challenges,
  communities,
  communityMembers,
  games,
  notifications,
  profiles,
} from "@anytogether/db";
import {
  ChallengeCreate,
  type ChallengeDetail,
  ChallengeInvite,
  type ChallengeMetric,
  type ChallengeStanding,
  type ChallengeState,
  type ChallengeView,
  ErrorCode,
  challengeGraceMinutes,
  challengeHours,
  challengeStandingRows,
  challengeStates,
  maxChallengeDaysAhead,
  maxChallengeEntrants,
  maxOpenChallenges,
  shownPrivacy,
  trophyPoints,
} from "@anytogether/shared";
import { type SQL, and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { iconUrl } from "./art.js";
import { HttpError } from "./errors.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import { areFriends, people } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

export type ChallengeRow = typeof challenges.$inferSelect;
type Ranked = { id: string; value: number; rank: number };
/** How the standings are read: by someone signed in, or through the public API (as a stranger
 *  who sees only what is open to everyone). */
type Mode = "member" | "public";

/** A challenge as the public API shows it: nothing about the reader, and no account IDs. */
export type PublicChallengeView = Omit<ChallengeView, "joined" | "mine" | "canCancel" | "myStanding">;
export type PublicChallengeDetail = PublicChallengeView & {
  standings: Omit<ChallengeStanding, "me">[];
  updatedAt: string;
};

const standingsSeconds = 30;
const graceMs = challengeGraceMinutes * 60_000;
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const stateOf = (row: ChallengeRow, now = Date.now()): ChallengeState =>
  row.status === "cancelled"
    ? "cancelled"
    : now < row.startsAt.getTime()
      ? "upcoming"
      : now < row.endsAt.getTime()
        ? "active"
        : "ended";

/** Ranks shared by equal values (1, 2, 2, 4). */
function ranked(list: { id: string; value: number }[]): Ranked[] {
  let rank = 1;
  let last: number | undefined;
  return list.map((row, index) => {
    if (row.value !== last) rank = index + 1;
    last = row.value;
    return { ...row, rank };
  });
}

/** SQL: what one entrant (`e.account_id`) did in the window. Play time is the union of their
 *  sessions inside it, so two computers running at once count once. Trophies count when earned
 *  in the window and received after its start, and never when flagged. */
function windowValue(metric: ChallengeMetric, titleId: string, startsAt: Date, endsAt: Date): SQL {
  const start = sql`${startsAt.toISOString()}::timestamptz`;
  const end = sql`${endsAt.toISOString()}::timestamptz`;
  if (metric === "time")
    return sql`coalesce((select sum(extract(epoch from upper(r) - lower(r))) from unnest((
      select range_agg(tstzrange(greatest(s.started_at, ${start}), least(s.ended_at, ${end})))
      from play_sessions s
      where s.account_id = e.account_id and s.title_id = ${titleId}
        and s.ended_at > ${start} and s.started_at < ${end} and s.created_at >= ${start})) r), 0)`;
  const earned = sql`from earned_trophies et
    join trophies t on t.title_id = et.title_id and t.set_hash = et.set_hash and t.trophy_id = et.trophy_id
    where et.account_id = e.account_id and et.title_id = ${titleId} and not et.flagged
      and et.earned_at >= ${start} and et.earned_at < ${end} and et.created_at >= ${start}`;
  if (metric === "trophies") return sql`(select count(*) ${earned})`;
  const points = sql.join(
    Object.entries(trophyPoints).map(([grade, n]) => sql`when ${grade} then ${n}`),
    sql` `,
  );
  return sql`coalesce((select sum(case t.grade ${points} else 0 end) ${earned}), 0)`;
}

/** SQL: `me` may see the challenge `c`: anyone a public one; the maker's friends a friends one;
 *  the community's members a community one; whoever is in it, always. Never across a block with
 *  its maker, and never one made by an account that is no longer in good standing. */
function visibleTo(me: string): SQL {
  return sql`(
    (c.creator_id is null or (
      exists (select 1 from accounts a where a.id = c.creator_id and a.status = 'active')
      and not exists (select 1 from blocks b where (b.blocker = ${me}::uuid and b.blocked = c.creator_id)
        or (b.blocker = c.creator_id and b.blocked = ${me}::uuid))))
    and (c.audience = 'public' or c.creator_id = ${me}::uuid
      or exists (select 1 from challenge_entries ce where ce.challenge_id = c.id and ce.account_id = ${me}::uuid)
      or (c.audience = 'friends' and exists (select 1 from friendships f where f.state = 'accepted'
        and ((f.user_a = ${me}::uuid and f.user_b = c.creator_id) or (f.user_b = ${me}::uuid and f.user_a = c.creator_id))))
      or (c.audience = 'community' and exists (select 1 from community_members m
        where m.community_id = c.community_id and m.account_id = ${me}::uuid))))`;
}

/** Which challenges a list shows: running and coming (the default), or over. */
function whenFilter(state: string | undefined): { where: SQL; order: SQL } {
  if (state === "ended") return { where: sql`c.ends_at <= now()`, order: sql`c.ends_at desc, c.id desc` };
  if (state === "active")
    return { where: sql`c.starts_at <= now() and c.ends_at > now()`, order: sql`c.ends_at, c.id` };
  if (state === "upcoming") return { where: sql`c.starts_at > now()`, order: sql`c.starts_at, c.id` };
  return {
    where: sql`c.ends_at > now()`,
    order: sql`(c.starts_at > now()), case when c.starts_at > now() then c.starts_at else c.ends_at end, c.id`,
  };
}

/** Standings, views, lists and the sweep, for the signed-in routes and the public API alike. */
export function challengeService(deps: Pick<Deps, "db" | "valkey" | "publicUrl">, notes: Notifier) {
  const { db, valkey } = deps;
  const who = people(db as Database);

  const load = async (id: string) =>
    isId(id) ? (await db.select().from(challenges).where(eq(challenges.id, id)))[0] : undefined;

  /** The challenge, if `me` may see it (404 otherwise: nobody learns it exists). */
  const visible = async (id: string, me: string) => {
    if (!isId(id)) throw notFound();
    const [row] = await db.execute<{ id: string }>(
      sql`select c.id from challenges c where c.id = ${id}::uuid and ${visibleTo(me)}`,
    );
    const found = row ? await load(id) : undefined;
    if (!found) throw notFound();
    return found;
  };

  /** Everyone in it with their value, best first; the written-down result once final. */
  async function standings(row: ChallengeRow, fresh = false): Promise<{ list: Ranked[]; at: string }> {
    if (row.finalizedAt) {
      const kept = await db
        .select({
          id: challengeEntries.accountId,
          value: challengeEntries.finalValue,
          rank: challengeEntries.finalRank,
        })
        .from(challengeEntries)
        .where(eq(challengeEntries.challengeId, row.id))
        .orderBy(challengeEntries.finalRank, challengeEntries.joinedAt);
      return {
        list: kept.map((k) => ({ id: k.id, value: Number(k.value ?? 0), rank: k.rank ?? kept.length })),
        at: row.finalizedAt.toISOString(),
      };
    }
    const key = `ch:standings:${row.id}`;
    if (!fresh) {
      const cached = await valkey.get(key);
      if (cached) return JSON.parse(cached) as { list: Ranked[]; at: string };
    }
    const value = windowValue(row.metric as ChallengeMetric, row.titleId, row.startsAt, row.endsAt);
    const result = await db.execute<{ id: string; value: number }>(sql`
      select e.account_id id, (${value})::bigint value
      from challenge_entries e join accounts a on a.id = e.account_id and a.status = 'active'
      where e.challenge_id = ${row.id}::uuid
      order by value desc, e.joined_at, e.account_id`);
    const list = ranked([...result].map((r) => ({ id: r.id, value: Number(r.value) })));
    const at = new Date().toISOString();
    await valkey.set(key, JSON.stringify({ list, at }), "EX", standingsSeconds);
    return { list, at };
  }
  const forget = (id: string) => valkey.del(`ch:standings:${id}`);

  /** Of these entrants, the ones the reader may name: in the app everyone not blocked either way
   *  (joining shows one's progress to whoever sees the challenge); in the public API only those
   *  who opened that part of their profile (the library for play time, else trophies) to
   *  everyone, and whom the token's owner has no block with. */
  async function nameable(ids: string[], viewer: string, mode: Mode, metric: ChallengeMetric) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Set<string>();
    const blocked = await who.blockedAmong(viewer, unique);
    let allowed = unique.filter((id) => !blocked.has(id));
    if (mode === "public" && allowed.length) {
      const section = metric === "time" ? "library" : "trophies";
      const rows = await db
        .select({ id: profiles.accountId, privacy: profiles.privacy, publicProfile: profiles.publicProfile })
        .from(profiles)
        .where(inArray(profiles.accountId, allowed));
      const open = new Set(
        rows.filter((p) => shownPrivacy(p.privacy, p.publicProfile)[section] === "everyone").map((p) => p.id),
      );
      allowed = allowed.filter((id) => open.has(id));
    }
    return new Set(allowed);
  }

  const shownStandings = async (
    list: Ranked[],
    viewer: string,
    mode: Mode,
    metric: ChallengeMetric,
  ): Promise<ChallengeStanding[]> => {
    const names = await nameable(
      list.map((r) => r.id),
      viewer,
      mode,
      metric,
    );
    const cards = await who.cards([...names]);
    return list.map((r) => ({
      rank: r.rank,
      user: names.has(r.id) ? (cards.get(r.id) ?? null) : null,
      value: r.value,
      me: mode === "member" && r.id === viewer,
    }));
  };

  /** The views of these challenges for `viewer`. */
  async function views(rows: ChallengeRow[], viewer: string, mode: Mode): Promise<ChallengeView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [counts, mine, gameRows, communityRows, roles] = await Promise.all([
      db
        .select({ id: challengeEntries.challengeId, n: count() })
        .from(challengeEntries)
        .where(inArray(challengeEntries.challengeId, ids))
        .groupBy(challengeEntries.challengeId),
      db
        .select({ id: challengeEntries.challengeId })
        .from(challengeEntries)
        .where(and(inArray(challengeEntries.challengeId, ids), eq(challengeEntries.accountId, viewer))),
      db
        .select()
        .from(games)
        .where(inArray(games.titleId, [...new Set(rows.map((r) => r.titleId))])),
      (async () => {
        const list = [...new Set(rows.flatMap((r) => (r.communityId ? [r.communityId] : [])))];
        return list.length ? db.select().from(communities).where(inArray(communities.id, list)) : [];
      })(),
      (async () => {
        const list = [...new Set(rows.flatMap((r) => (r.communityId ? [r.communityId] : [])))];
        return list.length && mode === "member"
          ? db
              .select({ id: communityMembers.communityId, role: communityMembers.role })
              .from(communityMembers)
              .where(and(inArray(communityMembers.communityId, list), eq(communityMembers.accountId, viewer)))
          : [];
      })(),
    ]);
    const entrants = new Map(counts.map((c) => [c.id, Number(c.n)]));
    const joined = new Set(mine.map((m) => m.id));
    const gameOf = new Map(gameRows.map((g) => [g.titleId, g]));
    const communityOf = new Map(communityRows.map((c) => [c.id, c]));
    const roleOf = new Map(roles.map((r) => [r.id, r.role]));
    const now = Date.now();
    const boards = new Map(
      await Promise.all(
        rows
          .filter((r) => stateOf(r, now) === "active" || stateOf(r, now) === "ended")
          .map(async (r) => [r.id, (await standings(r)).list] as const),
      ),
    );
    // Who may be named: the leaders and the makers.
    const leaders = rows.flatMap((r) => {
      const first = boards.get(r.id)?.[0];
      return first && first.value > 0 ? [first] : [];
    });
    const creators = rows.flatMap((r) => (r.creatorId ? [r.creatorId] : []));
    const named = new Map<ChallengeMetric, Set<string>>();
    for (const metric of new Set(rows.map((r) => r.metric as ChallengeMetric)))
      named.set(
        metric,
        await nameable(
          leaders.map((l) => l.id),
          viewer,
          mode,
          metric,
        ),
      );
    const shownCreators =
      mode === "public"
        ? await publicCreators(creators, viewer)
        : await nameable(creators, viewer, mode, "points");
    const cards = await who.cards([...leaders.map((l) => l.id), ...creators]);
    return rows.map((r) => {
      const state = stateOf(r, now);
      const game = gameOf.get(r.titleId);
      const community = r.communityId ? communityOf.get(r.communityId) : undefined;
      const board = boards.get(r.id) ?? [];
      const first = board[0] && board[0].value > 0 ? board[0] : undefined;
      const myRow = board.find((b) => b.id === viewer);
      const open = state === "upcoming" || state === "active";
      const moderator = ["owner", "moderator"].includes(roleOf.get(r.communityId ?? "") ?? "");
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        game: { titleId: r.titleId, names: game?.names ?? {}, iconUrl: game?.iconUrl ?? null },
        metric: r.metric as ChallengeMetric,
        audience: r.audience as ChallengeView["audience"],
        community: community
          ? {
              id: community.id,
              name: community.name,
              icon: community.icon,
              iconUrl: iconUrl(deps.publicUrl, community.icon),
            }
          : null,
        creator: r.creatorId && shownCreators.has(r.creatorId) ? (cards.get(r.creatorId) ?? null) : null,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        state,
        final: r.finalizedAt !== null,
        entrants: entrants.get(r.id) ?? 0,
        joined: joined.has(r.id),
        mine: r.creatorId === viewer,
        canCancel: open && (r.creatorId === viewer || moderator),
        leader: first
          ? {
              rank: first.rank,
              user: named.get(r.metric as ChallengeMetric)?.has(first.id)
                ? (cards.get(first.id) ?? null)
                : null,
              value: first.value,
              me: mode === "member" && first.id === viewer,
            }
          : null,
        myStanding: myRow && state !== "upcoming" ? { rank: myRow.rank, value: myRow.value } : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Makers the public API may name: a public profile, and no block with the token's owner. */
  async function publicCreators(ids: string[], viewer: string) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Set<string>();
    const blocked = await who.blockedAmong(viewer, unique);
    const rows = await db
      .select({ id: profiles.accountId, publicProfile: profiles.publicProfile })
      .from(profiles)
      .where(inArray(profiles.accountId, unique));
    return new Set(rows.filter((p) => p.publicProfile && !blocked.has(p.id)).map((p) => p.id));
  }

  async function detail(row: ChallengeRow, viewer: string, mode: Mode): Promise<ChallengeDetail> {
    const [view] = await views([row], viewer, mode);
    const state = stateOf(row);
    const { list, at } =
      state === "cancelled" ? { list: [], at: new Date().toISOString() } : await standings(row);
    const index = list.findIndex((r) => r.id === viewer);
    const top = list.slice(0, challengeStandingRows);
    const near = mode === "member" && index >= challengeStandingRows ? list.slice(index - 2, index + 3) : [];
    const metric = row.metric as ChallengeMetric;
    return {
      ...(view as ChallengeView),
      standings: await shownStandings(top, viewer, mode, metric),
      around: await shownStandings(near, viewer, mode, metric),
      updatedAt: at,
    };
  }

  /** Visible challenges for `me`, newest relevant first; `audience` narrows to public ones. */
  async function list(
    me: string,
    options: {
      state?: string | undefined;
      titleId?: string | undefined;
      joinedOnly?: boolean;
      publicOnly?: boolean;
    },
    limit = 50,
  ) {
    const { where, order } = whenFilter(options.state);
    const found = await db.execute<{ id: string }>(sql`
      select c.id from challenges c
      where c.status = 'scheduled' and ${where}
        and ${options.publicOnly ? sql`c.audience = 'public' and ${visibleTo(me)}` : visibleTo(me)}
        ${options.titleId ? sql`and c.title_id = ${options.titleId}` : sql``}
        ${
          options.joinedOnly
            ? sql`and (c.creator_id = ${me}::uuid or exists (select 1 from challenge_entries ce
                where ce.challenge_id = c.id and ce.account_id = ${me}::uuid))`
            : sql``
        }
      order by ${order} limit ${limit}`);
    const ids = [...found].map((r) => r.id);
    if (!ids.length) return [];
    const rows = await db.select().from(challenges).where(inArray(challenges.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  const noteData = (row: ChallengeRow, game: { names: Record<string, string> } | undefined) => ({
    challengeId: row.id,
    title: row.title,
    titleId: row.titleId,
    gameNames: game?.names ?? {},
    metric: row.metric,
    endsAt: row.endsAt.toISOString(),
  });
  const gameOf = async (titleId: string) =>
    (await db.select().from(games).where(eq(games.titleId, titleId)))[0];
  const entrantIds = async (id: string) =>
    (
      await db
        .select({ id: challengeEntries.accountId })
        .from(challengeEntries)
        .where(eq(challengeEntries.challengeId, id))
    ).map((e) => e.id);

  /** Tells the people in challenges that started, and writes down the results of those past their
   *  grace hour and tells everyone in them. Returns how many challenges it handled. */
  async function sweep(now = new Date()) {
    let handled = 0;
    const starting = await db
      .update(challenges)
      .set({ startedNoticeAt: now })
      .where(
        and(
          eq(challenges.status, "scheduled"),
          isNull(challenges.startedNoticeAt),
          sql`${challenges.startsAt} <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .returning();
    for (const row of starting) {
      // Over already (the server was away): the end tells them instead.
      if (row.endsAt <= now) continue;
      handled += 1;
      const data = noteData(row, await gameOf(row.titleId));
      for (const id of await entrantIds(row.id))
        if (id !== row.creatorId)
          await notes.notify(id, {
            kind: "challenge_started",
            actorId: row.creatorId,
            subjectId: row.id,
            data,
          });
    }

    const due = await db
      .select()
      .from(challenges)
      .where(
        and(
          eq(challenges.status, "scheduled"),
          isNull(challenges.finalizedAt),
          sql`${challenges.endsAt} <= ${new Date(now.getTime() - graceMs).toISOString()}::timestamptz`,
        ),
      );
    for (const row of due) {
      const { list } = await standings(row, true);
      const claimed = await db.transaction(async (tx) => {
        const [mine] = await tx
          .update(challenges)
          .set({ finalizedAt: now, updatedAt: now })
          .where(and(eq(challenges.id, row.id), isNull(challenges.finalizedAt)))
          .returning();
        if (!mine) return false;
        for (const entry of list)
          await tx
            .update(challengeEntries)
            .set({ finalValue: entry.value, finalRank: entry.rank })
            .where(and(eq(challengeEntries.challengeId, row.id), eq(challengeEntries.accountId, entry.id)));
        return true;
      });
      if (!claimed) continue;
      handled += 1;
      await forget(row.id);
      const data = noteData(row, await gameOf(row.titleId));
      const first = list[0] && list[0].value > 0 ? list[0] : undefined;
      const winner = first ? await who.card(first.id) : null;
      for (const entry of list) {
        const hidden = first && first.id !== entry.id && (await who.blocked(entry.id, first.id));
        await notes.notify(entry.id, {
          kind: "challenge_ended",
          actorId: null,
          subjectId: row.id,
          data: {
            ...data,
            rank: entry.rank,
            value: entry.value,
            entrants: list.length,
            winner:
              winner && first && !hidden
                ? { displayName: winner.displayName, handle: winner.handle, value: first.value }
                : null,
          },
        });
      }
    }
    return handled;
  }

  return { load, visible, standings, forget, views, detail, list, sweep, noteData, gameOf, entrantIds };
}
export type ChallengeService = ReturnType<typeof challengeService>;

const notFound = () => new HttpError(404, ErrorCode.notFound, "No such challenge");

/** Challenges: making one, lists, a challenge with its standings, joining and leaving, inviting
 *  friends, and calling one off. */
export function challengeRoutes(deps: Deps, notes: Notifier, service: ChallengeService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("/challenges", requireUser(deps));
  app.use("/challenges/*", requireUser(deps));
  app.use("/me/challenges", requireUser(deps));
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);
  const family = familyGuard(db);
  const who = people(db);

  /** A child's family settings: public challenges are public matchmaking, community ones are
   *  communities. */
  const allowed = (me: string, audience: string) =>
    audience === "public"
      ? family.need(me, "public_matchmaking", "Your family settings keep public challenges off")
      : audience === "community"
        ? family.need(me, "communities", "Your family settings keep communities off")
        : Promise.resolve();

  const memberOf = async (communityId: string, me: string) =>
    (
      await db
        .select({ role: communityMembers.role })
        .from(communityMembers)
        .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.accountId, me)))
    )[0]?.role;

  /** May `userId` join this challenge at all (before visibility, blocks and the family)? */
  const eligible = async (row: ChallengeRow, userId: string) => {
    if (row.audience === "public" || row.creatorId === userId) return true;
    if (row.audience === "community")
      return Boolean(row.communityId && (await memberOf(row.communityId, userId)));
    return Boolean(row.creatorId && (await areFriends(db, row.creatorId, userId)));
  };

  const one = async (row: ChallengeRow, me: string) => (await service.views([row], me, "member"))[0];

  const states = (value: string | undefined) => {
    if (value !== undefined && !(challengeStates as readonly string[]).includes(value))
      throw new HttpError(400, ErrorCode.badRequest, "state: upcoming, active or ended");
    if (value === "cancelled")
      throw new HttpError(400, ErrorCode.badRequest, "state: upcoming, active or ended");
    return value;
  };
  const titleOf = (value: string | undefined) => {
    if (value !== undefined && !/^[A-Z]{4}[0-9]{5}$/.test(value))
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    return value;
  };

  /** Invites `ids` (friends of `me` who may join and are not in it yet); returns how many. */
  async function invite(row: ChallengeRow, me: string, ids: string[]) {
    const others = [...new Set(ids)].filter((id) => id !== me);
    if (!others.length) return 0;
    const friends = await who.friendsAmong(me, others);
    const inside = new Set(await service.entrantIds(row.id));
    const data = service.noteData(row, await service.gameOf(row.titleId));
    let invited = 0;
    for (const id of others) {
      if (!friends.has(id) || inside.has(id) || !(await eligible(row, id))) continue;
      if (row.creatorId && (await who.blocked(id, row.creatorId))) continue;
      if (await notes.notify(id, { kind: "challenge_invite", actorId: me, subjectId: row.id, data }))
        invited += 1;
    }
    return invited;
  }

  app.post("/challenges", async (c) => {
    const me = c.get("userId");
    const input = await body(c, ChallengeCreate);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const now = Date.now();
    const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
    if (startsAt.getTime() < now - 5 * 60_000)
      throw new HttpError(400, ErrorCode.badRequest, "startsAt: now or later");
    if (startsAt.getTime() > now + maxChallengeDaysAhead * 86_400_000)
      throw new HttpError(400, ErrorCode.badRequest, `startsAt: at most ${maxChallengeDaysAhead} days ahead`);
    if (hours < challengeHours.min || hours > challengeHours.max)
      throw new HttpError(
        400,
        ErrorCode.badRequest,
        `endsAt: ${challengeHours.min} hour to ${challengeHours.max / 24} days after startsAt`,
      );
    const [game] = await db
      .select({ titleId: games.titleId })
      .from(games)
      .where(eq(games.titleId, input.titleId));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    if (input.communityId) {
      const [community] = await db
        .select({ id: communities.id })
        .from(communities)
        .where(eq(communities.id, input.communityId));
      if (!community) throw new HttpError(404, ErrorCode.notFound, "No such community");
      if (!(await memberOf(community.id, me)))
        throw new HttpError(403, ErrorCode.forbidden, "Join the community first");
    }
    await allowed(me, input.audience);
    const [open] = await db
      .select({ n: count() })
      .from(challenges)
      .where(
        and(
          eq(challenges.creatorId, me),
          eq(challenges.status, "scheduled"),
          gt(challenges.endsAt, new Date()),
        ),
      );
    if ((open?.n ?? 0) >= maxOpenChallenges)
      throw new HttpError(
        409,
        ErrorCode.conflict,
        `At most ${maxOpenChallenges} challenges running or coming at once`,
      );
    await limit("challengeCreate", me);
    const id = uuidv7();
    const row = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(challenges)
        .values({
          id,
          creatorId: me,
          title: input.title,
          description: input.description || null,
          titleId: input.titleId,
          metric: input.metric,
          audience: input.audience,
          communityId: input.communityId ?? null,
          startsAt,
          endsAt,
        })
        .returning();
      await tx.insert(challengeEntries).values({ challengeId: id, accountId: me });
      return made as ChallengeRow;
    });
    if (input.invite?.length) await invite(row, me, input.invite);
    return c.json(await one(row, me), 201);
  });

  app.get("/challenges", async (c) => {
    const me = c.get("userId");
    const rows = await service.list(me, {
      state: states(c.req.query("state")),
      titleId: titleOf(c.req.query("titleId")),
    });
    return c.json({ challenges: await service.views(rows, me, "member") });
  });

  /** The reader's own: what they are in or made, running and coming, then the last 30 days. */
  app.get("/me/challenges", async (c) => {
    const me = c.get("userId");
    const current = await service.list(me, { joinedOnly: true, titleId: titleOf(c.req.query("titleId")) });
    const past = (await service.list(me, { joinedOnly: true, state: "ended" }, 20)).filter(
      (r) => r.endsAt.getTime() > Date.now() - 30 * 86_400_000,
    );
    return c.json({ challenges: await service.views([...current, ...past], me, "member") });
  });

  app.get("/challenges/:id", async (c) => {
    const me = c.get("userId");
    const row = await service.visible(c.req.param("id"), me);
    return c.json(await service.detail(row, me, "member"));
  });

  app.post("/challenges/:id/join", async (c) => {
    const me = c.get("userId");
    const row = await service.visible(c.req.param("id"), me);
    const state = stateOf(row);
    if (state === "cancelled" || state === "ended")
      throw new HttpError(409, ErrorCode.conflict, "This challenge is over");
    if (!(await eligible(row, me))) throw notFound();
    await allowed(me, row.audience);
    await limit("challenge", me);
    const [entrants] = await db
      .select({ n: count() })
      .from(challengeEntries)
      .where(eq(challengeEntries.challengeId, row.id));
    if ((entrants?.n ?? 0) >= maxChallengeEntrants)
      throw new HttpError(409, ErrorCode.full, "This challenge is full");
    await db.insert(challengeEntries).values({ challengeId: row.id, accountId: me }).onConflictDoNothing();
    await service.forget(row.id);
    await notes.settle(me, "challenge_invite", row.id);
    return c.json(await one(row, me));
  });

  app.post("/challenges/:id/leave", async (c) => {
    const me = c.get("userId");
    const row = await service.visible(c.req.param("id"), me);
    const state = stateOf(row);
    if (state === "ended" || state === "cancelled")
      throw new HttpError(409, ErrorCode.conflict, "This challenge is over");
    if (row.creatorId === me)
      throw new HttpError(409, ErrorCode.conflict, "The maker cancels a challenge rather than leaving it");
    await limit("challenge", me);
    await db
      .delete(challengeEntries)
      .where(and(eq(challengeEntries.challengeId, row.id), eq(challengeEntries.accountId, me)));
    await service.forget(row.id);
    return c.json(await one(row, me));
  });

  app.post("/challenges/:id/invites", async (c) => {
    const me = c.get("userId");
    const row = await service.visible(c.req.param("id"), me);
    const state = stateOf(row);
    if (state === "ended" || state === "cancelled")
      throw new HttpError(409, ErrorCode.conflict, "This challenge is over");
    const { userIds } = await body(c, ChallengeInvite);
    if (!(await service.entrantIds(row.id)).includes(me))
      throw new HttpError(403, ErrorCode.forbidden, "Join the challenge first");
    await limit("challenge", me);
    return c.json({ invited: await invite(row, me, userIds) });
  });

  /** Calls it off: its maker, or a moderator of its community, before it ends. */
  app.delete("/challenges/:id", async (c) => {
    const me = c.get("userId");
    const row = await service.visible(c.req.param("id"), me);
    const view = await one(row, me);
    if (!view?.canCancel) {
      const state = stateOf(row);
      if (state === "ended" || state === "cancelled")
        throw new HttpError(409, ErrorCode.conflict, "This challenge is over");
      throw new HttpError(
        403,
        ErrorCode.forbidden,
        "Only its maker or the community's moderators can cancel it",
      );
    }
    const [cancelled] = await db
      .update(challenges)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(challenges.id, row.id))
      .returning();
    await service.forget(row.id);
    // Invites still unread are taken back.
    const invited = await db
      .select({ id: notifications.accountId })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, "challenge_invite"),
          eq(notifications.subjectId, row.id),
          isNull(notifications.readAt),
        ),
      );
    for (const { id } of invited) await notes.withdraw(id, "challenge_invite", row.id);
    return c.json(await one(cancelled as ChallengeRow, me));
  });

  return app;
}
