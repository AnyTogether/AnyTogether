import {
  type Database,
  devices,
  earnedTrophies,
  games,
  library,
  playSessions,
  profiles,
  trophies,
  trophySets,
} from "@anytogether/db";
import {
  type BatchResult,
  DeviceRegister,
  EarnedTrophy,
  ErrorCode,
  GameTeach,
  type Grade,
  PlaySession,
  SessionBatch,
  SetHash,
  TitleId,
  TrophyBatch,
  TrophySet,
  friendsKey,
  privacyOf,
  rarityLabel,
  trophyPoints,
} from "@anytogether/shared";
import { type SQL, and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { blockedBetween, canSee, findProfile, relationOf } from "./people.js";

/** Clocks drift; a time a little ahead of ours is still believed. */
const clockSlack = 5 * 60_000;
/** A session longer than this is a launcher bug, not play. */
const longestSession = 7 * 24 * 3_600_000;
/** Only trophies this fresh are told to friends; a first upload of old ones stays quiet. */
const freshTrophy = 3_600_000;

const pointsCase = sql.raw(
  `case t.grade ${Object.entries(trophyPoints)
    .map(([grade, points]) => `when '${grade}' then ${points}`)
    .join(" ")} else 0 end`,
);

function param<T extends z.ZodTypeAny>(schema: T, value: string | undefined, what: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, ErrorCode.badRequest, `${what}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

const issues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`).join("; ");

type Texts = Record<string, { name: string; detail?: string }>;
const nameOf = (texts: Texts) => texts.en?.name ?? Object.values(texts)[0]?.name ?? null;
const roundRarity = (rarity: number | null) =>
  rarity === null ? null : Math.round(rarity * 10_000) / 10_000;

/** Rarity = players who earned it / players with the game (rows in library). */
export async function refreshRarityOf(db: Database, titleIds: string[]) {
  if (!titleIds.length) return;
  await db.execute(sql`
    update trophies t set
      earned_count = c.earned,
      rarity = c.earned::real / nullif(c.players, 0)
    from (
      select t2.title_id, t2.set_hash, t2.trophy_id,
        (select count(*) from earned_trophies e
          where e.title_id = t2.title_id and e.trophy_id = t2.trophy_id)::int earned,
        (select count(*) from library l where l.title_id = t2.title_id)::int players
      from trophies t2 where t2.title_id in ${[...new Set(titleIds)]}
    ) c
    where t.title_id = c.title_id and t.set_hash = c.set_hash and t.trophy_id = c.trophy_id`);
}

/** The game catalogue, computers, play sessions, trophy sets, earned trophies and libraries. */
export function gameRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;

  /** Rows for games not taught yet, so a session or set can arrive first. */
  const stubGames = async (titleIds: string[]) => {
    if (titleIds.length)
      await db
        .insert(games)
        .values([...new Set(titleIds)].map((titleId) => ({ titleId })))
        .onConflictDoNothing();
  };

  /** Works out library rows again from sessions and trophies; `pairs` yields (account_id, title_id). */
  const refreshLibrary = (pairs: SQL) =>
    db.execute(sql`
      insert into library (account_id, title_id, first_played_at, last_played_at, seconds_played,
        trophies_earned, trophies_total, points)
      select p.account_id, p.title_id, least(s.first_at, e.first_at), greatest(s.last_at, e.last_at),
        coalesce(s.seconds, 0), coalesce(e.earned, 0), nullif(total.n, 0), coalesce(e.points, 0)
      from (${pairs}) as p(account_id, title_id)
      left join lateral (
        select min(started_at) first_at, max(ended_at) last_at,
          sum(extract(epoch from ended_at - started_at))::bigint seconds
        from play_sessions where account_id = p.account_id and title_id = p.title_id
      ) s on true
      left join lateral (
        select count(*)::int earned, min(et.earned_at) first_at, max(et.earned_at) last_at,
          sum(${pointsCase})::int points
        from earned_trophies et
        join trophies t on t.title_id = et.title_id and t.set_hash = et.set_hash and t.trophy_id = et.trophy_id
        where et.account_id = p.account_id and et.title_id = p.title_id
      ) e on true
      left join lateral (
        select count(*)::int n from trophies t
        where t.title_id = p.title_id and t.set_hash = coalesce(
          (select set_hash from earned_trophies
            where account_id = p.account_id and title_id = p.title_id order by earned_at desc limit 1),
          (select set_hash from trophy_sets where title_id = p.title_id order by created_at, set_hash limit 1))
      ) total on true
      on conflict (account_id, title_id) do update set
        first_played_at = excluded.first_played_at,
        last_played_at = excluded.last_played_at,
        seconds_played = excluded.seconds_played,
        trophies_earned = excluded.trophies_earned,
        trophies_total = excluded.trophies_total,
        points = excluded.points`);
  const mine = (me: string, titleIds: string[]) =>
    sql`values ${sql.join(
      [...new Set(titleIds)].map((titleId) => sql`(${me}::uuid, ${titleId}::text)`),
      sql`, `,
    )}`;

  const refreshRarity = (titleIds: string[]) => refreshRarityOf(db, titleIds);

  /** Someone whose library or trophies the asker may see, as their privacy settings say. */
  const viewable = async (me: string, handle: string, section: "library" | "trophies") => {
    const profile = await findProfile(db, handle);
    if (!profile) throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    if (profile.accountId === me) return profile;
    if (await blockedBetween(db, me, profile.accountId))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    // The code stays "forbidden" for the launchers that know it; `section` says which part is private.
    if (!canSee(privacyOf(profile.privacy)[section], await relationOf(db, me, profile.accountId)))
      throw new HttpError(403, ErrorCode.forbidden, "This is private", { section });
    return profile;
  };

  const gameCard = (row: typeof games.$inferSelect) => ({
    titleId: row.titleId,
    names: row.names,
    iconUrl: row.iconUrl,
    locked: row.locked,
  });

  app.put("/games/:titleId", async (c) => {
    const me = c.get("userId");
    const titleId = param(TitleId, c.req.param("titleId"), "titleId");
    const input = await body(c, GameTeach);
    const created = await db
      .insert(games)
      .values({ titleId, names: input.names, iconUrl: input.iconUrl ?? null, taughtBy: me })
      .onConflictDoNothing()
      .returning();
    if (created[0]) return c.json({ ...gameCard(created[0]), stored: true }, 201);

    const existing = (await db.select().from(games).where(eq(games.titleId, titleId)))[0];
    if (!existing) throw new HttpError(409, ErrorCode.conflict, "Try again");
    // Names already known are never replaced; only languages it lacks are added.
    const names = { ...input.names, ...existing.names };
    const iconUrl = existing.iconUrl ?? input.iconUrl ?? null;
    const changed =
      !existing.locked &&
      (Object.keys(names).length !== Object.keys(existing.names).length || iconUrl !== existing.iconUrl);
    if (!changed) return c.json({ ...gameCard(existing), stored: false });
    const [updated] = await db
      .update(games)
      .set({
        names,
        iconUrl,
        taughtBy: Object.keys(existing.names).length ? existing.taughtBy : me,
      })
      .where(and(eq(games.titleId, titleId), eq(games.locked, false)))
      .returning();
    return c.json({ ...gameCard(updated ?? existing), stored: Boolean(updated) });
  });

  app.get("/games/:titleId", async (c) => {
    const titleId = param(TitleId, c.req.param("titleId"), "titleId");
    const row = (await db.select().from(games).where(eq(games.titleId, titleId)))[0];
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const [players] = await db.select({ n: count() }).from(library).where(eq(library.titleId, titleId));
    const sets = await db
      .select({ setHash: trophySets.setHash, trophies: count(trophies.trophyId) })
      .from(trophySets)
      .leftJoin(
        trophies,
        and(eq(trophies.titleId, trophySets.titleId), eq(trophies.setHash, trophySets.setHash)),
      )
      .where(eq(trophySets.titleId, titleId))
      .groupBy(trophySets.titleId, trophySets.setHash, trophySets.createdAt)
      .orderBy(asc(trophySets.createdAt));
    return c.json({ ...gameCard(row), players: players?.n ?? 0, trophySets: sets });
  });

  app.post("/me/devices", async (c) => {
    const me = c.get("userId");
    const input = await body(c, DeviceRegister);
    const values = {
      platform: input.platform,
      name: input.name,
      model: input.model ?? null,
      lastSeenAt: new Date(),
    };
    const existed = (await db.select().from(devices).where(eq(devices.id, input.id)))[0];
    const [row] = await db
      .insert(devices)
      .values({ id: input.id, accountId: me, ...values })
      .onConflictDoUpdate({ target: devices.id, set: values, setWhere: eq(devices.accountId, me) })
      .returning();
    if (!row) throw new HttpError(409, ErrorCode.conflict, "This device ID belongs to another account");
    return c.json(
      { id: row.id, platform: row.platform, name: row.name, model: row.model, lastSeenAt: row.lastSeenAt },
      existed ? 200 : 201,
    );
  });

  app.post("/me/sessions", async (c) => {
    const me = c.get("userId");
    const { sessions } = await body(c, SessionBatch);
    const results: BatchResult[] = [];
    const valid: { index: number; item: z.infer<typeof PlaySession> }[] = [];
    const now = Date.now();
    sessions.forEach((raw, index) => {
      const parsed = PlaySession.safeParse(raw);
      if (!parsed.success)
        results[index] = {
          index,
          status: "rejected",
          code: ErrorCode.badRequest,
          detail: issues(parsed.error),
        };
      else if (Date.parse(parsed.data.endedAt) > now + clockSlack)
        results[index] = {
          index,
          status: "rejected",
          code: ErrorCode.badRequest,
          detail: "endedAt is ahead",
        };
      else if (Date.parse(parsed.data.endedAt) - Date.parse(parsed.data.startedAt) > longestSession)
        results[index] = { index, status: "rejected", code: ErrorCode.badRequest, detail: "too long" };
      else valid.push({ index, item: parsed.data });
    });

    const deviceIds = [...new Set(valid.map((v) => v.item.deviceId))];
    const owned = new Set(
      deviceIds.length
        ? (
            await db
              .select({ id: devices.id })
              .from(devices)
              .where(and(eq(devices.accountId, me), inArray(devices.id, deviceIds)))
          ).map((d) => d.id)
        : [],
    );
    const accepted = valid.filter(({ index, item }) => {
      if (owned.has(item.deviceId)) return true;
      results[index] = {
        index,
        status: "rejected",
        code: ErrorCode.unknownDevice,
        detail: "Register this computer with POST /me/devices first",
      };
      return false;
    });

    const stored = new Set<string>();
    if (accepted.length) {
      await stubGames(accepted.map((a) => a.item.titleId));
      const inserted = await db
        .insert(playSessions)
        .values(
          accepted.map(({ item }) => ({
            id: item.id,
            accountId: me,
            titleId: item.titleId,
            deviceId: item.deviceId,
            startedAt: new Date(item.startedAt),
            endedAt: new Date(item.endedAt),
            exit: item.exit ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: playSessions.id });
      for (const row of inserted) stored.add(row.id);
    }
    const titles = new Set<string>();
    for (const { index, item } of accepted) {
      if (stored.delete(item.id)) {
        results[index] = { index, status: "stored" };
        titles.add(item.titleId);
      } else results[index] = { index, status: "duplicate" };
    }
    if (titles.size) {
      await refreshLibrary(mine(me, [...titles]));
      await refreshRarity([...titles]);
      await db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(devices.accountId, me), inArray(devices.id, deviceIds)));
    }
    return c.json({ results });
  });

  app.put("/trophy-sets/:titleId/:setHash", async (c) => {
    const me = c.get("userId");
    const titleId = param(TitleId, c.req.param("titleId"), "titleId");
    const setHash = param(SetHash, c.req.param("setHash"), "setHash");
    const input = await body(c, TrophySet);
    await stubGames([titleId]);
    const rows = input.trophies.map((t) => ({
      titleId,
      setHash,
      trophyId: t.id,
      grade: t.grade,
      hidden: t.hidden,
      texts: t.texts,
    }));
    // The set and its trophies arrive together or not at all.
    const created = await db.transaction(async (tx) => {
      const set = await tx
        .insert(trophySets)
        .values({ titleId, setHash, taughtBy: me })
        .onConflictDoNothing()
        .returning();
      if (set[0]) await tx.insert(trophies).values(rows);
      return Boolean(set[0]);
    });
    if (created) {
      await refreshRarity([titleId]);
      await refreshLibrary(sql`select account_id, title_id from library where title_id = ${titleId}`);
      return c.json({ titleId, setHash, stored: true, trophies: rows.length }, 201);
    }
    // A known set: grades, flags and trophy IDs stay; only languages the server lacks are added.
    await db.execute(sql`
      update trophies t set texts = v.texts::jsonb || t.texts
      from (values ${sql.join(
        rows.map((r) => sql`(${r.trophyId}::int, ${JSON.stringify(r.texts)})`),
        sql`, `,
      )}) as v(trophy_id, texts)
      where t.title_id = ${titleId} and t.set_hash = ${setHash} and t.trophy_id = v.trophy_id`);
    const [total] = await db
      .select({ n: count() })
      .from(trophies)
      .where(and(eq(trophies.titleId, titleId), eq(trophies.setHash, setHash)));
    return c.json({ titleId, setHash, stored: false, trophies: total?.n ?? 0 });
  });

  app.post("/me/trophies", async (c) => {
    const me = c.get("userId");
    const { trophies: items } = await body(c, TrophyBatch);
    const results: BatchResult[] = [];
    const valid: { index: number; item: z.infer<typeof EarnedTrophy> }[] = [];
    const now = Date.now();
    items.forEach((raw, index) => {
      const parsed = EarnedTrophy.safeParse(raw);
      if (!parsed.success)
        results[index] = {
          index,
          status: "rejected",
          code: ErrorCode.badRequest,
          detail: issues(parsed.error),
        };
      else if (Date.parse(parsed.data.earnedAt) > now + clockSlack)
        results[index] = {
          index,
          status: "rejected",
          code: ErrorCode.badRequest,
          detail: "earnedAt is ahead",
        };
      else valid.push({ index, item: parsed.data });
    });

    const known = valid.length
      ? await db
          .select()
          .from(trophies)
          .where(
            sql`(${trophies.titleId}, ${trophies.setHash}, ${trophies.trophyId}) in (${sql.join(
              valid.map(({ item }) => sql`(${item.titleId}, ${item.setHash}, ${item.trophyId}::int)`),
              sql`, `,
            )})`,
          )
      : [];
    const key = (t: { titleId: string; setHash: string; trophyId: number }) =>
      `${t.titleId}/${t.setHash}/${t.trophyId}`;
    const byKey = new Map(known.map((t) => [key(t), t]));
    const accepted = valid.filter(({ index, item }) => {
      if (byKey.has(key(item))) return true;
      results[index] = {
        index,
        status: "rejected",
        code: ErrorCode.unknownTrophy,
        detail: "Send the trophy set with PUT /trophy-sets/{titleId}/{setHash} first",
      };
      return false;
    });

    const stored = new Set<string>();
    if (accepted.length) {
      const inserted = await db
        .insert(earnedTrophies)
        .values(
          accepted.map(({ item }) => ({
            accountId: me,
            titleId: item.titleId,
            setHash: item.setHash,
            trophyId: item.trophyId,
            earnedAt: new Date(item.earnedAt),
          })),
        )
        .onConflictDoNothing()
        .returning({ titleId: earnedTrophies.titleId, trophyId: earnedTrophies.trophyId });
      for (const row of inserted) stored.add(`${row.titleId}/${row.trophyId}`);
    }
    const titles = new Set<string>();
    const fresh: { item: z.infer<typeof EarnedTrophy>; grade: Grade; name: string | null }[] = [];
    for (const { index, item } of accepted) {
      if (!stored.delete(`${item.titleId}/${item.trophyId}`)) {
        results[index] = { index, status: "duplicate" };
        continue;
      }
      results[index] = { index, status: "stored" };
      titles.add(item.titleId);
      const trophy = byKey.get(key(item));
      if (trophy && Date.parse(item.earnedAt) > now - freshTrophy)
        fresh.push({
          item,
          grade: trophy.grade as Grade,
          name: trophy.hidden ? null : nameOf(trophy.texts),
        });
    }
    if (titles.size) {
      await refreshLibrary(mine(me, [...titles]));
      await refreshRarity([...titles]);
    }

    if (fresh.length) {
      const friends = await deps.valkey.smembers(friendsKey(me));
      const profile = (await db.select().from(profiles).where(eq(profiles.accountId, me)))[0];
      // Trophies hidden from everyone are not told to friends either.
      if (friends.length && profile && privacyOf(profile.privacy).trophies !== "nobody")
        for (const { item, grade, name } of fresh)
          for (const friend of friends)
            await publish(deps.valkey, friend, {
              type: "trophy.earned",
              data: {
                userId: me,
                handle: profile.handle,
                displayName: profile.displayName,
                titleId: item.titleId,
                trophyId: item.trophyId,
                grade,
                name,
              },
            });
    }
    return c.json({ results });
  });

  app.get("/users/:handle/library", async (c) => {
    const me = c.get("userId");
    const owner = await viewable(me, c.req.param("handle"), "library");
    // Trophy counts in the library follow the trophies setting, not the library's.
    const trophiesShown = canSee(
      privacyOf(owner.privacy).trophies,
      await relationOf(db, me, owner.accountId),
    );
    const rows = await db
      .select({ entry: library, game: games })
      .from(library)
      .innerJoin(games, eq(games.titleId, library.titleId))
      .where(eq(library.accountId, owner.accountId))
      .orderBy(sql`${library.lastPlayedAt} desc nulls last`, asc(library.titleId));
    // Which computers each game was played on, for the owner only.
    const computers = new Map<string, { id: string; name: string; platform: string }[]>();
    if (owner.accountId === me) {
      const used = await db
        .selectDistinct({
          titleId: playSessions.titleId,
          id: devices.id,
          name: devices.name,
          platform: devices.platform,
        })
        .from(playSessions)
        .innerJoin(devices, eq(devices.id, playSessions.deviceId))
        .where(eq(playSessions.accountId, me));
      for (const { titleId, ...device } of used)
        computers.set(titleId, [...(computers.get(titleId) ?? []), device]);
    }
    return c.json({
      games: rows.map(({ entry, game }) => ({
        titleId: entry.titleId,
        names: game.names,
        iconUrl: game.iconUrl,
        firstPlayedAt: entry.firstPlayedAt,
        lastPlayedAt: entry.lastPlayedAt,
        secondsPlayed: entry.secondsPlayed,
        trophiesEarned: trophiesShown ? entry.trophiesEarned : null,
        trophiesTotal: entry.trophiesTotal,
        progress:
          trophiesShown && entry.trophiesTotal
            ? Math.min(100, Math.floor((entry.trophiesEarned * 100) / entry.trophiesTotal))
            : null,
        points: trophiesShown ? entry.points : null,
        ...(owner.accountId === me ? { devices: computers.get(entry.titleId) ?? [] } : {}),
      })),
    });
  });

  app.get("/users/:handle/trophies", async (c) => {
    const me = c.get("userId");
    const query = c.req.query("titleId");
    const titleId = query === undefined ? undefined : param(TitleId, query, "titleId");
    const owner = await viewable(me, c.req.param("handle"), "trophies");
    const self = owner.accountId === me;
    /** Hidden trophies the asker earned themselves, whose texts they may see. */
    const askerHas = async (titleIds: string[]) =>
      new Set(
        self || !titleIds.length
          ? []
          : (
              await db
                .select({ titleId: earnedTrophies.titleId, trophyId: earnedTrophies.trophyId })
                .from(earnedTrophies)
                .where(and(eq(earnedTrophies.accountId, me), inArray(earnedTrophies.titleId, titleIds)))
            ).map((e) => `${e.titleId}/${e.trophyId}`),
      );
    const texts = (
      t: { titleId: string; trophyId: number; hidden: boolean; texts: Texts },
      has: Set<string>,
    ) => (t.hidden && !self && !has.has(`${t.titleId}/${t.trophyId}`) ? null : t.texts);

    if (titleId) {
      const earned = await db
        .select()
        .from(earnedTrophies)
        .where(and(eq(earnedTrophies.accountId, owner.accountId), eq(earnedTrophies.titleId, titleId)))
        .orderBy(desc(earnedTrophies.earnedAt));
      const setHash =
        earned[0]?.setHash ??
        (
          await db
            .select({ setHash: trophySets.setHash })
            .from(trophySets)
            .where(eq(trophySets.titleId, titleId))
            .orderBy(asc(trophySets.createdAt), asc(trophySets.setHash))
            .limit(1)
        )[0]?.setHash ??
        null;
      if (!setHash) return c.json({ titleId, setHash: null, trophies: [] });
      const list = await db
        .select()
        .from(trophies)
        .where(and(eq(trophies.titleId, titleId), eq(trophies.setHash, setHash)))
        .orderBy(asc(trophies.trophyId));
      const when = new Map(earned.map((e) => [e.trophyId, e.earnedAt]));
      const has = await askerHas([titleId]);
      return c.json({
        titleId,
        setHash,
        trophies: list.map((t) => ({
          id: t.trophyId,
          grade: t.grade,
          hidden: t.hidden,
          texts: texts(t, has),
          earnedAt: when.get(t.trophyId) ?? null,
          earnedCount: t.earnedCount,
          rarity: roundRarity(t.rarity),
          rarityLabel: rarityLabel(t.rarity),
        })),
      });
    }

    const timeline = await db
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
      .where(eq(earnedTrophies.accountId, owner.accountId))
      .orderBy(desc(earnedTrophies.earnedAt))
      .limit(200);
    const has = await askerHas([...new Set(timeline.map((r) => r.earned.titleId))]);
    return c.json({
      trophies: timeline.map(({ earned, trophy, names }) => ({
        titleId: earned.titleId,
        gameNames: names,
        setHash: earned.setHash,
        trophyId: earned.trophyId,
        grade: trophy.grade,
        hidden: trophy.hidden,
        texts: texts(trophy, has),
        earnedAt: earned.earnedAt,
        earnedCount: trophy.earnedCount,
        rarity: roundRarity(trophy.rarity),
        rarityLabel: rarityLabel(trophy.rarity),
      })),
    });
  });

  return app;
}
