import {
  type Database,
  earnedTrophies,
  games,
  library,
  profiles,
  trophies,
  trophySets,
} from "@anytogether/db";
import {
  type AccentName,
  type CompareGame,
  type CompareTrophy,
  type CompareView,
  type CoverView,
  ErrorCode,
  type Grade,
  LookUpdate,
  type ShowcaseGame,
  type ShowcaseStored,
  type ShowcaseTrophy,
  ShowcaseUpdate,
  type ShowcaseView,
  TitleId,
  accentNames,
  coverPresets,
  levelBadge,
  rarityLabel,
  shownPrivacy,
} from "@anytogether/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { coverUrl } from "./art.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { type ProfileRow, blockedBetween, canSee, findProfile, relationOf } from "./people.js";
import { settingLimiter } from "./ratelimit.js";

type Texts = Record<string, { name: string; detail?: string }>;
const roundRarity = (rarity: number | null) =>
  rarity === null ? null : Math.round(rarity * 10_000) / 10_000;
const progressOf = (earned: number, total: number | null) =>
  total ? Math.min(100, Math.floor((earned * 100) / total)) : null;

/** The cover and accent a profile shows: a preset's picture, or a game's artwork while the server
 *  still knows its icon. */
export async function lookOf(
  db: Pick<Database, "select">,
  publicUrl: string,
  profile: Pick<ProfileRow, "cover" | "accent">,
): Promise<{ cover: CoverView | null; accent: AccentName | null }> {
  const accent = accentNames.includes(profile.accent as AccentName) ? (profile.accent as AccentName) : null;
  const [kind, id] = (profile.cover ?? "").split(":") as [string, string | undefined];
  let cover: CoverView | null = null;
  if (kind === "preset" && id && coverPresets.includes(id))
    cover = { kind, id, url: coverUrl(publicUrl, id) };
  if (kind === "game" && id) {
    const [game] = await db.select({ iconUrl: games.iconUrl }).from(games).where(eq(games.titleId, id));
    if (game?.iconUrl) cover = { kind, id, url: game.iconUrl };
  }
  return { cover, accent };
}

/** The showcase as `viewer` may see it. */
export async function showcaseOf(
  db: Database,
  viewer: string,
  owner: ProfileRow,
  relation: "me" | "friend" | "other",
) {
  const stored = (owner.showcase ?? {}) as ShowcaseStored;
  const privacy = shownPrivacy(owner.privacy, owner.publicProfile);
  const trophiesShown = canSee(privacy.trophies, relation);
  const libraryShown = canSee(privacy.library, relation);
  const view: ShowcaseView = { trophies: null, games: null };

  if (trophiesShown) {
    const pinned = (stored.trophies ?? []).slice(0, 6);
    const rows = pinned.length
      ? await db
          .select({ earned: earnedTrophies, trophy: trophies, names: games.names })
          .from(earnedTrophies)
          .innerJoin(
            trophies,
            and(
              eq(trophies.titleId, earnedTrophies.titleId),
              eq(trophies.setHash, earnedTrophies.setHash),
              eq(trophies.trophyId, earnedTrophies.trophyId),
            ),
          )
          .innerJoin(games, eq(games.titleId, earnedTrophies.titleId))
          .where(
            and(
              eq(earnedTrophies.accountId, owner.accountId),
              sql`(${earnedTrophies.titleId}, ${earnedTrophies.trophyId}) in (${sql.join(
                pinned.map((t) => sql`(${t.titleId}, ${t.trophyId}::int)`),
                sql`, `,
              )})`,
            ),
          )
      : [];
    // A hidden trophy's texts only for its owner and whoever earned it too.
    const hiddenTitles = [...new Set(rows.filter((r) => r.trophy.hidden).map((r) => r.earned.titleId))];
    const viewerHas = new Set(
      viewer === owner.accountId || !hiddenTitles.length
        ? []
        : (
            await db
              .select({ titleId: earnedTrophies.titleId, trophyId: earnedTrophies.trophyId })
              .from(earnedTrophies)
              .where(and(eq(earnedTrophies.accountId, viewer), inArray(earnedTrophies.titleId, hiddenTitles)))
          ).map((e) => `${e.titleId}/${e.trophyId}`),
    );
    const byKey = new Map(rows.map((r) => [`${r.earned.titleId}/${r.earned.trophyId}`, r]));
    view.trophies = pinned.flatMap((pin): ShowcaseTrophy[] => {
      const row = byKey.get(`${pin.titleId}/${pin.trophyId}`);
      if (!row) return [];
      const open =
        !row.trophy.hidden || viewer === owner.accountId || viewerHas.has(`${pin.titleId}/${pin.trophyId}`);
      return [
        {
          titleId: pin.titleId,
          gameNames: row.names,
          trophyId: pin.trophyId,
          grade: row.trophy.grade as Grade,
          hidden: row.trophy.hidden,
          texts: open ? (row.trophy.texts as Texts) : null,
          earnedAt: row.earned.earnedAt.toISOString(),
          rarity: roundRarity(row.trophy.rarity),
          rarityLabel: rarityLabel(row.trophy.rarity),
        },
      ];
    });
  }

  if (libraryShown) {
    const pinned = (stored.games ?? []).slice(0, 4);
    const rows = pinned.length
      ? await db
          .select({ entry: library, game: games })
          .from(library)
          .innerJoin(games, eq(games.titleId, library.titleId))
          .where(and(eq(library.accountId, owner.accountId), inArray(library.titleId, pinned)))
      : [];
    const byTitle = new Map(rows.map((r) => [r.entry.titleId, r]));
    view.games = pinned.flatMap((titleId): ShowcaseGame[] => {
      const row = byTitle.get(titleId);
      if (!row) return [];
      return [
        {
          titleId,
          names: row.game.names,
          iconUrl: row.game.iconUrl,
          secondsPlayed: row.entry.secondsPlayed,
          trophiesEarned: trophiesShown ? row.entry.trophiesEarned : null,
          trophiesTotal: row.entry.trophiesTotal,
          progress: trophiesShown ? progressOf(row.entry.trophiesEarned, row.entry.trophiesTotal) : null,
        },
      ];
    });
  }
  return view;
}

/** A profile's look (cover, accent), its pinned trophies and games, and comparing trophies with
 *  someone, game by game. */
export function showcaseRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const setting = settingLimiter(deps.valkey, deps.limits);

  /** Someone the asker may look at (not blocked either way), and how they relate. */
  const person = async (me: string, handle: string) => {
    const profile = await findProfile(db, handle);
    if (!profile || (profile.accountId !== me && (await blockedBetween(db, me, profile.accountId))))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    return { profile, relation: await relationOf(db, me, profile.accountId) };
  };

  const own = async (me: string) => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.accountId, me));
    if (!profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return profile;
  };

  app.patch("/me/look", async (c) => {
    const me = c.get("userId");
    await setting("look", me);
    const input = await body(c, LookUpdate);
    const changes: { cover?: string | null; accent?: string | null } = {};
    if (input.accent !== undefined) changes.accent = input.accent;
    if (input.cover === null) changes.cover = null;
    else if (input.cover?.kind === "preset") changes.cover = `preset:${input.cover.id}`;
    else if (input.cover?.kind === "game") {
      // Only artwork the server has already: nothing new is fetched or kept for a cover.
      const [game] = await db
        .select({ iconUrl: games.iconUrl })
        .from(games)
        .where(eq(games.titleId, input.cover.titleId));
      if (!game?.iconUrl)
        throw new HttpError(400, ErrorCode.badRequest, "cover: that game has no artwork here");
      changes.cover = `game:${input.cover.titleId}`;
    }
    if (Object.keys(changes).length) await db.update(profiles).set(changes).where(eq(profiles.accountId, me));
    return c.json(await lookOf(db, deps.publicUrl, await own(me)));
  });

  app.put("/me/showcase", async (c) => {
    const me = c.get("userId");
    await setting("showcase", me);
    const input = await body(c, ShowcaseUpdate);
    const profile = await own(me);
    const stored = { ...((profile.showcase ?? {}) as ShowcaseStored) };
    if (input.trophies) {
      const earned = input.trophies.length
        ? await db
            .select({ titleId: earnedTrophies.titleId, trophyId: earnedTrophies.trophyId })
            .from(earnedTrophies)
            .where(
              and(
                eq(earnedTrophies.accountId, me),
                sql`(${earnedTrophies.titleId}, ${earnedTrophies.trophyId}) in (${sql.join(
                  input.trophies.map((t) => sql`(${t.titleId}, ${t.trophyId}::int)`),
                  sql`, `,
                )})`,
              ),
            )
        : [];
      const have = new Set(earned.map((e) => `${e.titleId}/${e.trophyId}`));
      if (input.trophies.some((t) => !have.has(`${t.titleId}/${t.trophyId}`)))
        throw new HttpError(400, ErrorCode.badRequest, "trophies: only trophies you earned");
      stored.trophies = input.trophies;
    }
    if (input.games) {
      const owned = input.games.length
        ? await db
            .select({ titleId: library.titleId })
            .from(library)
            .where(and(eq(library.accountId, me), inArray(library.titleId, input.games)))
        : [];
      if (owned.length !== input.games.length)
        throw new HttpError(400, ErrorCode.badRequest, "games: only games in your library");
      stored.games = input.games;
    }
    await db.update(profiles).set({ showcase: stored }).where(eq(profiles.accountId, me));
    return c.json(await showcaseOf(db, me, { ...profile, showcase: stored }, "me"));
  });

  app.get("/users/:handle/showcase", async (c) => {
    const me = c.get("userId");
    const { profile, relation } = await person(me, c.req.param("handle"));
    return c.json(await showcaseOf(db, me, profile, relation));
  });

  /** Someone whose trophies the asker may see, for comparing; never oneself. */
  const comparable = async (me: string, handle: string) => {
    const found = await person(me, handle);
    if (found.relation === "me") throw new HttpError(400, ErrorCode.badRequest, "That is you");
    if (!canSee(shownPrivacy(found.profile.privacy, found.profile.publicProfile).trophies, found.relation))
      throw new HttpError(403, ErrorCode.forbidden, "This is private", { section: "trophies" });
    return found.profile;
  };

  /** Without a game: the games either of the two has trophies in, the ones both play first. With
   *  ?titleId: that game's trophies side by side, who earned what and when. */
  app.get("/users/:handle/trophies/compare", async (c) => {
    const me = c.get("userId");
    const other = await comparable(me, c.req.param("handle"));
    const query = c.req.query("titleId");
    if (query === undefined) {
      const rows = await db
        .select({ entry: library, game: games })
        .from(library)
        .innerJoin(games, eq(games.titleId, library.titleId))
        .where(
          and(inArray(library.accountId, [me, other.accountId]), sql`${library.trophiesTotal} is not null`),
        )
        .orderBy(desc(library.lastPlayedAt));
      const byTitle = new Map<string, CompareGame & { last: number }>();
      for (const { entry, game } of rows) {
        const item = byTitle.get(entry.titleId) ?? {
          titleId: entry.titleId,
          names: game.names,
          iconUrl: game.iconUrl,
          mine: null,
          theirs: null,
          last: 0,
        };
        const side = {
          earned: entry.trophiesEarned,
          total: entry.trophiesTotal,
          progress: progressOf(entry.trophiesEarned, entry.trophiesTotal),
          points: entry.points,
        };
        if (entry.accountId === me) item.mine = side;
        else item.theirs = side;
        item.last = Math.max(item.last, entry.lastPlayedAt?.getTime() ?? 0);
        byTitle.set(entry.titleId, item);
      }
      const list = [...byTitle.values()]
        .sort((x, y) => Number(!!y.mine && !!y.theirs) - Number(!!x.mine && !!x.theirs) || y.last - x.last)
        .slice(0, 200)
        .map(({ last: _last, ...item }) => item);
      return c.json({ games: list });
    }

    const parsed = TitleId.safeParse(query);
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const titleId = parsed.data;
    const [game] = await db.select().from(games).where(eq(games.titleId, titleId));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const earned = await db
      .select()
      .from(earnedTrophies)
      .where(
        and(eq(earnedTrophies.titleId, titleId), inArray(earnedTrophies.accountId, [me, other.accountId])),
      )
      .orderBy(desc(earnedTrophies.earnedAt));
    // Their set first (it is their list being compared against), then the asker's, then the first.
    const setHash =
      earned.find((e) => e.accountId === other.accountId)?.setHash ??
      earned.find((e) => e.accountId === me)?.setHash ??
      (
        await db
          .select({ setHash: trophySets.setHash })
          .from(trophySets)
          .where(eq(trophySets.titleId, titleId))
          .orderBy(asc(trophySets.createdAt), asc(trophySets.setHash))
          .limit(1)
      )[0]?.setHash ??
      null;
    const list = setHash
      ? await db
          .select()
          .from(trophies)
          .where(and(eq(trophies.titleId, titleId), eq(trophies.setHash, setHash)))
          .orderBy(asc(trophies.trophyId))
      : [];
    const mine = new Map(earned.filter((e) => e.accountId === me).map((e) => [e.trophyId, e.earnedAt]));
    const theirs = new Map(
      earned.filter((e) => e.accountId === other.accountId).map((e) => [e.trophyId, e.earnedAt]),
    );
    const [self] = await db.select().from(profiles).where(eq(profiles.accountId, me));
    const card = (p: ProfileRow) => ({
      userId: p.accountId,
      handle: p.handle,
      displayName: p.displayName,
      avatar: p.avatarUrl,
      level: levelBadge(p.trophyLevel),
    });
    const items: CompareTrophy[] = list.map((t) => ({
      id: t.trophyId,
      grade: t.grade as Grade,
      hidden: t.hidden,
      // A hidden trophy stays hidden unless the asker earned it.
      texts: t.hidden && !mine.has(t.trophyId) ? null : (t.texts as Texts),
      rarity: roundRarity(t.rarity),
      rarityLabel: rarityLabel(t.rarity),
      mine: mine.get(t.trophyId)?.toISOString() ?? null,
      theirs: theirs.get(t.trophyId)?.toISOString() ?? null,
    }));
    const view: CompareView = {
      titleId,
      game: { names: game.names, iconUrl: game.iconUrl },
      setHash,
      me: card(self as ProfileRow),
      them: card(other),
      trophies: items,
      totals: {
        mine: items.filter((t) => t.mine).length,
        theirs: items.filter((t) => t.theirs).length,
        both: items.filter((t) => t.mine && t.theirs).length,
        total: items.length,
      },
    };
    return c.json(view);
  });

  return app;
}
