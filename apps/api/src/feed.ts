import {
  type Database,
  accounts,
  activities,
  activityReactions,
  earnedTrophies,
  games,
  profiles,
  trophies,
} from "@anytogether/db";
import {
  type ActivityKind,
  type ActivitySection,
  type ActivityTrophy,
  type ActivityView,
  ErrorCode,
  type FeedPage,
  type Grade,
  type MilestoneKind,
  type Reaction,
  ReactionSet,
  defaultPrivacy,
  feedPageSize,
  foldTrophiesMs,
  freshActivityMs,
  friendsKey,
  grades,
  levelBadge,
  longSessionSeconds,
  maxFeedPage,
  milestones,
  rarityLabel,
} from "@anytogether/shared";
import { type AnyColumn, type SQL, and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { type Relation, blockedBetween, findProfile, relationOf } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

type Ctx = Pick<Deps, "db" | "valkey">;
type NewActivity = {
  actorId: string;
  kind: ActivityKind;
  section: ActivitySection;
  titleId?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
};
type TrophyPayload = { setHash: string; trophies: { id: number; grade: Grade }[]; count: number };

/** At most this many trophies are kept in one folded item (the count keeps going). */
const foldedTrophies = 100;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sp = alias(profiles, "subject_profile");

/** The stored privacy of `section` for a profile column, with the defaults filled in. */
const setting = (privacy: SQL | AnyColumn, section: SQL) =>
  sql`coalesce(${privacy} ->> ${section}, case ${section} ${sql.raw(
    Object.entries(defaultPrivacy)
      .map(([name, value]) => `when '${name}' then '${value}'`)
      .join(" "),
  )} end)`;

const friendIdsOf = (viewer: string) => sql`(select case when f.user_a = ${viewer}::uuid then f.user_b
  else f.user_a end from friendships f
  where f.state = 'accepted' and (f.user_a = ${viewer}::uuid or f.user_b = ${viewer}::uuid))`;

/** What the reader may see of whose items: their friends' (the feed), or one person's (a profile). */
type Scope = { feed: true } | { owner: string; relation: Relation };

/** Items for `viewer`, newest first, as they may see them: the actor's privacy setting for the
 *  item's section, and for a friendship the new friend's friends-list setting, are read now. */
export async function readActivities(
  db: Database,
  viewer: string,
  scope: Scope,
  options: { before?: string; limit?: number; ids?: string[] } = {},
): Promise<ActivityView[]> {
  const friends = friendIdsOf(viewer);
  const actorSetting = setting(profiles.privacy, sql`${activities.section}`);
  const subjectSetting = setting(sp.privacy, sql`'friends'`);
  const actorSees =
    "feed" in scope || scope.relation === "friend"
      ? sql`${actorSetting} <> 'nobody'`
      : scope.relation === "me"
        ? sql`true`
        : // Open to everyone only while the public profile switch is on (shownPrivacy).
          sql`${actorSetting} = 'everyone' and ${profiles.publicProfile}`;
  const where = and(
    "feed" in scope ? sql`${activities.actorId} in ${friends}` : eq(activities.actorId, scope.owner),
    options.before ? sql`${activities.id} < ${options.before}::uuid` : undefined,
    options.ids ? inArray(activities.id, options.ids) : undefined,
    actorSees,
    sql`(${activities.kind} <> 'friendship' or (
      ${sp.accountId} is not null
      and ${activities.subjectId} <> ${viewer}::uuid
      and exists (select 1 from accounts sa where sa.id = ${activities.subjectId} and sa.status = 'active')
      and not exists (select 1 from blocks b where (b.blocker = ${viewer}::uuid and b.blocked = ${activities.subjectId})
        or (b.blocker = ${activities.subjectId} and b.blocked = ${viewer}::uuid))
      and (${activities.actorId} = ${viewer}::uuid or (${subjectSetting} = 'everyone' and ${sp.publicProfile})
        or (${subjectSetting} = 'friends' and ${activities.subjectId} in ${friends}))
      ${
        // A friend befriending another friend: one item, not one from each side.
        "feed" in scope
          ? sql`and not (${activities.actorId} > ${activities.subjectId} and ${activities.subjectId} in ${friends})`
          : sql``
      }))`,
  );
  const rows = await db
    .select({ activity: activities, actor: profiles, subject: sp })
    .from(activities)
    .innerJoin(profiles, eq(profiles.accountId, activities.actorId))
    .innerJoin(accounts, and(eq(accounts.id, activities.actorId), eq(accounts.status, "active")))
    .leftJoin(sp, eq(sp.accountId, activities.subjectId))
    .where(where)
    .orderBy(desc(activities.id))
    .limit(Math.min(options.limit ?? feedPageSize, maxFeedPage));
  if (!rows.length) return [];

  const titleIds = [...new Set(rows.map((r) => r.activity.titleId).filter((t): t is string => !!t))];
  const gameRows = titleIds.length
    ? await db.select().from(games).where(inArray(games.titleId, titleIds))
    : [];
  const gameOf = new Map(gameRows.map((g) => [g.titleId, g]));

  // Trophy texts and rarity as they are now; a hidden one shows only to who earned it.
  const wanted = rows.flatMap(({ activity }) =>
    activity.kind === "trophy" || activity.kind === "platinum"
      ? (activity.payload as TrophyPayload).trophies.map((t) => ({
          titleId: activity.titleId as string,
          setHash: (activity.payload as TrophyPayload).setHash,
          trophyId: t.id,
        }))
      : [],
  );
  const trophyRows = wanted.length
    ? await db
        .select()
        .from(trophies)
        .where(
          sql`(${trophies.titleId}, ${trophies.setHash}, ${trophies.trophyId}) in (${sql.join(
            wanted.map((w) => sql`(${w.titleId}, ${w.setHash}, ${w.trophyId}::int)`),
            sql`, `,
          )})`,
        )
    : [];
  const trophyKey = (titleId: string, setHash: string, id: number) => `${titleId}/${setHash}/${id}`;
  const trophyOf = new Map(trophyRows.map((t) => [trophyKey(t.titleId, t.setHash, t.trophyId), t]));
  const hiddenTitles = [...new Set(trophyRows.filter((t) => t.hidden).map((t) => t.titleId))];
  const viewerHas = new Set(
    hiddenTitles.length
      ? (
          await db
            .select({ titleId: earnedTrophies.titleId, trophyId: earnedTrophies.trophyId })
            .from(earnedTrophies)
            .where(and(eq(earnedTrophies.accountId, viewer), inArray(earnedTrophies.titleId, hiddenTitles)))
        ).map((e) => `${e.titleId}/${e.trophyId}`)
      : [],
  );

  const ids = rows.map((r) => r.activity.id);
  const reactionRows = await db
    .select({
      activityId: activityReactions.activityId,
      reaction: activityReactions.reaction,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${activityReactions.accountId} = ${viewer}::uuid)`,
    })
    .from(activityReactions)
    .where(inArray(activityReactions.activityId, ids))
    .groupBy(activityReactions.activityId, activityReactions.reaction);

  const card = (p: typeof profiles.$inferSelect) => ({
    userId: p.accountId,
    handle: p.handle,
    displayName: p.displayName,
    avatar: p.avatarUrl,
  });
  const gradeRank = (grade: string) => grades.indexOf(grade as Grade);

  return rows.map(({ activity, actor, subject }) => {
    const game = activity.titleId ? gameOf.get(activity.titleId) : undefined;
    const payload = activity.payload;
    const view: ActivityView = {
      id: activity.id,
      kind: activity.kind as ActivityKind,
      createdAt: activity.createdAt.toISOString(),
      actor: card(actor),
      game: game ? { titleId: game.titleId, names: game.names, iconUrl: game.iconUrl } : null,
      highlight: null,
      reactions: { counts: {}, mine: null },
    };
    if (activity.kind === "trophy" || activity.kind === "platinum") {
      const { setHash, trophies: list, count } = payload as TrophyPayload;
      const shown: ActivityTrophy[] = list.flatMap(({ id }) => {
        const t = trophyOf.get(trophyKey(activity.titleId as string, setHash, id));
        if (!t) return [];
        const open = !t.hidden || viewer === activity.actorId || viewerHas.has(`${t.titleId}/${t.trophyId}`);
        return [
          {
            trophyId: t.trophyId,
            grade: t.grade as Grade,
            hidden: t.hidden,
            texts: open ? t.texts : null,
            rarity: t.rarity === null ? null : Math.round(t.rarity * 10_000) / 10_000,
            rarityLabel: rarityLabel(t.rarity),
          },
        ];
      });
      shown.sort((x, y) => (x.rarity ?? 1) - (y.rarity ?? 1) || gradeRank(y.grade) - gradeRank(x.grade));
      view.trophies = shown.slice(0, 5);
      view.trophyCount = count;
      view.highlight =
        activity.kind === "platinum"
          ? "platinum"
          : shown.some((t) => t.rarity !== null && t.rarity <= 0.2)
            ? "rare"
            : null;
    }
    if ((activity.kind === "long_session" || activity.kind === "first_play") && payload.seconds)
      view.seconds = payload.seconds as number;
    if (activity.kind === "friendship" && subject) view.friend = card(subject);
    if (activity.kind === "milestone")
      view.milestone = { kind: payload.kind as MilestoneKind, value: payload.value as number };
    if (activity.kind === "level_up" && typeof payload.level === "number")
      view.level = levelBadge(payload.level);
    for (const r of reactionRows.filter((r) => r.activityId === activity.id)) {
      view.reactions.counts[r.reaction as Reaction] = r.count;
      if (r.mine) view.reactions.mine = r.reaction as Reaction;
    }
    return view;
  });
}

/** Tells each friend of the actor who may see them about new or changed items. */
async function fanOut(ctx: Ctx, actorId: string, ids: string[], skip: string[] = []) {
  if (!ids.length) return;
  const friends = (await ctx.valkey.smembers(friendsKey(actorId))).filter((f) => !skip.includes(f));
  for (const friend of friends)
    for (const item of await readActivities(ctx.db, friend, { feed: true }, { ids }))
      await publish(ctx.valkey, friend, { type: "feed.item", data: item });
}

async function write(ctx: Ctx, items: NewActivity[]) {
  if (!items.length) return [];
  const rows = items.map((item) => ({ id: uuidv7(), payload: {}, ...item }));
  await ctx.db.insert(activities).values(rows);
  return rows.map((r) => r.id);
}

const isFresh = (iso: string | Date, now = Date.now()) => new Date(iso).getTime() > now - freshActivityMs;

/** Trophies just stored: a platinum is an item of its own; the rest of a game fold into the
 *  game's item from the last hour, or start one. Only recent trophies count. */
export async function recordTrophies(
  ctx: Ctx,
  me: string,
  stored: { titleId: string; setHash: string; trophyId: number; grade: Grade; earnedAt: string }[],
) {
  const fresh = stored.filter((t) => isFresh(t.earnedAt));
  if (!fresh.length) return;
  const changed: string[] = [];
  const created = await write(
    ctx,
    fresh
      .filter((t) => t.grade === "platinum")
      .map((t) => ({
        actorId: me,
        kind: "platinum" as const,
        section: "trophies" as const,
        titleId: t.titleId,
        payload: { setHash: t.setHash, trophies: [{ id: t.trophyId, grade: t.grade }], count: 1 },
      })),
  );
  changed.push(...created);

  const byGame = new Map<string, typeof fresh>();
  for (const t of fresh.filter((t) => t.grade !== "platinum"))
    byGame.set(`${t.titleId}/${t.setHash}`, [...(byGame.get(`${t.titleId}/${t.setHash}`) ?? []), t]);
  for (const list of byGame.values()) {
    const first = list[0];
    if (!first) continue;
    const added = list.map((t) => ({ id: t.trophyId, grade: t.grade }));
    const [recent] = await ctx.db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.actorId, me),
          eq(activities.kind, "trophy"),
          eq(activities.titleId, first.titleId),
          sql`${activities.payload} ->> 'setHash' = ${first.setHash}`,
          gt(activities.createdAt, new Date(Date.now() - foldTrophiesMs)),
        ),
      )
      .orderBy(desc(activities.id))
      .limit(1);
    if (recent) {
      const payload = recent.payload as TrophyPayload;
      const known = new Set(payload.trophies.map((t) => t.id));
      const fresher = added.filter((t) => !known.has(t.id));
      if (!fresher.length) continue;
      await ctx.db
        .update(activities)
        .set({
          payload: {
            setHash: payload.setHash,
            trophies: [...payload.trophies, ...fresher].slice(0, foldedTrophies),
            count: payload.count + fresher.length,
          },
          updatedAt: new Date(),
        })
        .where(eq(activities.id, recent.id));
      changed.push(recent.id);
    } else {
      changed.push(
        ...(await write(ctx, [
          {
            actorId: me,
            kind: "trophy",
            section: "trophies",
            titleId: first.titleId,
            payload: {
              setHash: first.setHash,
              trophies: added.slice(0, foldedTrophies),
              count: added.length,
            },
          },
        ])),
      );
    }
  }
  await fanOut(ctx, me, changed);
}

/** Sessions just stored: a game's first session ever, and sessions of two hours or more, while
 *  they are recent. `newTitles` are the games with no session before this batch. */
export async function recordSessions(
  ctx: Ctx,
  me: string,
  stored: { titleId: string; startedAt: string; endedAt: string }[],
  newTitles: Set<string>,
) {
  const seconds = (s: { startedAt: string; endedAt: string }) =>
    Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
  const fresh = stored.filter((s) => isFresh(s.endedAt));
  const items: NewActivity[] = [];
  for (const titleId of new Set(fresh.map((s) => s.titleId))) {
    const ofGame = fresh.filter((s) => s.titleId === titleId);
    if (newTitles.has(titleId)) {
      const longest = Math.max(...ofGame.map(seconds));
      items.push({
        actorId: me,
        kind: "first_play",
        section: "library",
        titleId,
        payload: longest >= longSessionSeconds ? { seconds: longest } : {},
      });
    } else
      for (const session of ofGame.filter((s) => seconds(s) >= longSessionSeconds))
        items.push({
          actorId: me,
          kind: "long_session",
          section: "library",
          titleId,
          payload: { seconds: seconds(session) },
        });
  }
  await fanOut(ctx, me, await write(ctx, items));
}

export type Totals = Record<MilestoneKind, number>;

/** What milestones are counted from: trophies, platinums, games and whole hours played. */
export async function totalsOf(db: Database, me: string): Promise<Totals> {
  const [row] = await db.execute<{ trophies: number; platinums: number; games: number; hours: number }>(sql`
    select coalesce(sum(trophies_earned), 0)::int trophies, count(*)::int games,
      (coalesce(sum(seconds_played), 0) / 3600)::int hours,
      (select count(*) from earned_trophies e join trophies t on t.title_id = e.title_id
        and t.set_hash = e.set_hash and t.trophy_id = e.trophy_id
        where e.account_id = ${me}::uuid and t.grade = 'platinum')::int platinums
    from library where account_id = ${me}::uuid`);
  return {
    trophies: Number(row?.trophies ?? 0),
    platinums: Number(row?.platinums ?? 0),
    games: Number(row?.games ?? 0),
    hours: Number(row?.hours ?? 0),
  };
}

/** The highest round number each total went past, between before and after. */
export async function recordMilestones(ctx: Ctx, me: string, before: Totals, after: Totals) {
  const items: NewActivity[] = [];
  for (const kind of Object.keys(milestones) as MilestoneKind[]) {
    const crossed = milestones[kind].filter((n) => before[kind] < n && after[kind] >= n);
    const value = crossed[crossed.length - 1];
    if (value)
      items.push({
        actorId: me,
        kind: "milestone",
        section: kind === "trophies" || kind === "platinums" ? "trophies" : "library",
        payload: { kind, value },
      });
  }
  await fanOut(ctx, me, await write(ctx, items));
}

/** A new trophy level: one item, with the level reached. */
export async function recordLevelUp(ctx: Ctx, me: string, level: number) {
  await fanOut(
    ctx,
    me,
    await write(ctx, [{ actorId: me, kind: "level_up", section: "trophies", payload: { level } }]),
  );
}

/** Two people became friends: an item for each, told to each one's other friends. */
export async function recordFriendship(ctx: Ctx, a: string, b: string) {
  const [forA, forB] = await write(ctx, [
    { actorId: a, kind: "friendship", section: "friends", subjectId: b },
    { actorId: b, kind: "friendship", section: "friends", subjectId: a },
  ]);
  if (forA) await fanOut(ctx, a, [forA], [b]);
  if (forB) await fanOut(ctx, b, [forB], [a]);
}

/** A friendship ended (or a block ended it): its items go. */
export async function forgetFriendship(db: Database, a: string, b: string) {
  await db
    .delete(activities)
    .where(
      and(
        eq(activities.kind, "friendship"),
        or(
          and(eq(activities.actorId, a), eq(activities.subjectId, b)),
          and(eq(activities.actorId, b), eq(activities.subjectId, a)),
        ),
      ),
    );
}

/** ?before= and ?limit= of a feed or activity page. */
export function paging(query: (name: string) => string | undefined) {
  const before = query("before");
  if (before !== undefined && !uuid.test(before))
    throw new HttpError(400, ErrorCode.badRequest, "before: an item ID");
  const raw = query("limit");
  const count = raw === undefined ? feedPageSize : Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > maxFeedPage)
    throw new HttpError(400, ErrorCode.badRequest, `limit: 1 to ${maxFeedPage}`);
  return { before, limit: count };
}

export const page = (items: ActivityView[], count: number): FeedPage => ({
  items,
  next: items.length === count ? (items[items.length - 1]?.id ?? null) : null,
});

/** Reading the feed and someone's activity, and reacting to items. */
export function feedRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);

  app.get("/me/feed", async (c) => {
    const options = paging((name) => c.req.query(name));
    return c.json(page(await readActivities(db, c.get("userId"), { feed: true }, options), options.limit));
  });

  app.get("/users/:handle/activity", async (c) => {
    const me = c.get("userId");
    const options = paging((name) => c.req.query(name));
    const owner = await findProfile(db, c.req.param("handle"));
    if (!owner || (owner.accountId !== me && (await blockedBetween(db, me, owner.accountId))))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    const relation = await relationOf(db, me, owner.accountId);
    return c.json(
      page(await readActivities(db, me, { owner: owner.accountId, relation }, options), options.limit),
    );
  });

  /** The item, if the reader may see it (in their feed, or on the actor's profile). */
  const visible = async (me: string, id: string) => {
    if (!uuid.test(id)) throw new HttpError(404, ErrorCode.notFound, "No such item");
    const [row] = await db
      .select({ actorId: activities.actorId })
      .from(activities)
      .where(eq(activities.id, id));
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such item");
    if (row.actorId !== me && (await blockedBetween(db, me, row.actorId)))
      throw new HttpError(404, ErrorCode.notFound, "No such item");
    const relation = await relationOf(db, me, row.actorId);
    const [item] = await readActivities(db, me, { owner: row.actorId, relation }, { ids: [id] });
    if (!item) throw new HttpError(404, ErrorCode.notFound, "No such item");
    return item;
  };

  app.put("/activities/:id/reaction", async (c) => {
    const me = c.get("userId");
    const { reaction } = await body(c, ReactionSet);
    await limit("reaction", me);
    const id = c.req.param("id");
    await visible(me, id);
    await db
      .insert(activityReactions)
      .values({ activityId: id, accountId: me, reaction })
      .onConflictDoUpdate({
        target: [activityReactions.activityId, activityReactions.accountId],
        set: { reaction, createdAt: new Date() },
      });
    return c.json((await visible(me, id)).reactions);
  });

  app.delete("/activities/:id/reaction", async (c) => {
    const me = c.get("userId");
    const id = c.req.param("id");
    await visible(me, id);
    await db
      .delete(activityReactions)
      .where(and(eq(activityReactions.activityId, id), eq(activityReactions.accountId, me)));
    return c.json((await visible(me, id)).reactions);
  });

  return app;
}
