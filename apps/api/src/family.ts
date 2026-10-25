import {
  type Database,
  accounts,
  childRestrictions,
  families,
  familyInvites,
  familyLog,
  familyMembers,
  familyRequests,
  friendships,
  games,
  playSessions,
  profiles,
} from "@anytogether/db";
import {
  type Allowance,
  ErrorCode,
  FamilyChildCreate,
  FamilyCreate,
  type FamilyFeature,
  FamilyInviteCreate,
  type FamilyInviteView,
  FamilyJoin,
  FamilyLimitReached,
  type FamilyLogView,
  type FamilyMemberView,
  FamilyRequestAnswer,
  FamilyRequestCreate,
  type FamilyRequestKind,
  type FamilyRequestStatus,
  type FamilyRequestView,
  type FamilyRestrictions,
  FamilyRestrictionsUpdate,
  type FamilyRole,
  FamilyRoleChange,
  type FamilyStatus,
  type FamilyStatusResponse,
  FamilyTimeGrant,
  FamilyUpdate,
  type FamilyView,
  type MemberView,
  type MyFamilyView,
  type Privacy,
  type Visibility,
  allowance,
  applyRestrictionsUpdate,
  defaultRestrictions,
  familyAudience,
  familyCodeHours,
  familyInviteDays,
  familyRequestStatuses,
  isGuardian,
  localClock,
  maxFamilyMembers,
  notificationSettingsOf,
  privacyOf,
  privacySections,
  restrictionsOf,
  titleVerdict,
} from "@anytogether/shared";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { findOrCreateAccount } from "./accounts.js";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import { areFriends, blockedBetween, findProfile, people } from "./people.js";
import { presenceShownChanged } from "./profile.js";
import { rateLimiter } from "./ratelimit.js";
import { hash } from "./tokens.js";

type Querier = Pick<Database, "select" | "execute">;
type Member = typeof familyMembers.$inferSelect;
type Family = typeof families.$inferSelect;
type RequestRow = typeof familyRequests.$inferSelect;

/** The 403 every family limit answers with; `feature` says which. */
export const restricted = (feature: FamilyFeature, message: string) =>
  new HttpError(403, ErrorCode.restrictedByFamily, message, { feature });

/** Someone's family and role, if they are in one. */
export async function membershipOf(db: Querier, userId: string) {
  const [row] = await db
    .select({ member: familyMembers, family: families })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(eq(familyMembers.accountId, userId));
  return row;
}

/** The limits of the children among these people; anyone who is not a child is left out. */
export async function childRulesOf(db: Querier, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, FamilyRestrictions>();
  const rows = await db
    .select({ id: familyMembers.accountId, settings: childRestrictions.settings })
    .from(familyMembers)
    .leftJoin(childRestrictions, eq(childRestrictions.accountId, familyMembers.accountId))
    .where(and(inArray(familyMembers.accountId, unique), eq(familyMembers.role, "child")));
  return new Map(rows.map((r) => [r.id, restrictionsOf(r.settings ?? {})]));
}

const rank: Record<Visibility, number> = { nobody: 0, friends: 1, everyone: 2 };

/** The privacy settings no looser than a child's limit allows. */
export function clampPrivacy(privacy: Privacy, most: "friends" | "nobody"): Privacy {
  const result = { ...privacy };
  for (const section of privacySections) if (rank[result[section]] > rank[most]) result[section] = most;
  return result;
}

/** A child may not show more of the profile than the parents allow. */
export async function mayShow(deps: Pick<Deps, "db">, userId: string, privacy: Privacy) {
  const rules = (await childRulesOf(deps.db, [userId])).get(userId);
  if (!rules) return;
  const most = rank[rules.profileVisibility];
  if (privacySections.some((section) => rank[privacy[section]] > most))
    throw restricted("profile_visibility", "Your family settings keep your profile more private");
}

/** Applies a child's limits to what is stored: privacy no looser, and out of discovery if it is
 *  off. */
async function enforceStored(deps: Pick<Deps, "db" | "valkey">, userId: string, rules: FamilyRestrictions) {
  const [profile] = await deps.db.select().from(profiles).where(eq(profiles.accountId, userId));
  if (!profile) return;
  const before = privacyOf(profile.privacy);
  const privacy = clampPrivacy(before, rules.profileVisibility);
  const changes = {
    ...(JSON.stringify(privacy) !== JSON.stringify(before) ? { privacy } : {}),
    ...(!rules.discovery && profile.discoverable !== false ? { discoverable: false } : {}),
  };
  if (Object.keys(changes).length)
    await deps.db.update(profiles).set(changes).where(eq(profiles.accountId, userId));
  await presenceShownChanged(deps, userId, before, privacy);
}

/** The checks other routes make for children: each throws `restricted_by_family` when a parent's
 *  setting does not allow it, for the child or for someone reaching the child. */
export function familyGuard(db: Querier) {
  const rulesOf = async (userId: string) => (await childRulesOf(db, [userId])).get(userId) ?? null;

  const sameFamily = async (a: string, b: string) => {
    const rows = await db
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(inArray(familyMembers.accountId, [a, b]));
    return rows.length === 2 && rows[0]?.familyId === rows[1]?.familyId;
  };

  const sharesFriend = async (a: string, b: string) => {
    const [row] = await db.execute<{ yes: boolean }>(sql`
      select exists (
        select 1 from friendships f1 join friendships f2 on
          (case when f1.user_a = ${a}::uuid then f1.user_b else f1.user_a end)
            = (case when f2.user_a = ${b}::uuid then f2.user_b else f2.user_a end)
        where f1.state = 'accepted' and f2.state = 'accepted'
          and (f1.user_a = ${a}::uuid or f1.user_b = ${a}::uuid)
          and (f2.user_a = ${b}::uuid or f2.user_b = ${b}::uuid)
      ) yes`);
    return Boolean(row?.yes);
  };

  /** Whether the child's rules let `other` be a friend (kind friend) or reach them (message). */
  async function allows(child: string, rules: FamilyRestrictions, other: string, kind: "friend" | "message") {
    if (await sameFamily(child, other)) return true;
    const approved = rules.approvedContacts.includes(other);
    if (kind === "friend") {
      if (rules.friendRequests === "everyone") return true;
      if (rules.friendRequests === "nobody") return false;
      if (approved) return true;
      return rules.friendRequests === "friends_of_friends" && (await sharesFriend(child, other));
    }
    if (rules.messages === "nobody") return false;
    if (approved) return true;
    return rules.messages === "friends" && (await areFriends(db as Database, child, other));
  }

  /** A child's own setting is on. */
  async function need(userId: string, feature: FamilyFeature, message: string) {
    const rules = await rulesOf(userId);
    if (!rules) return;
    const on =
      feature === "voice_chat"
        ? rules.voiceChat
        : feature === "share_play"
          ? rules.sharePlay
          : feature === "public_matchmaking"
            ? rules.publicMatchmaking
            : feature === "discovery"
              ? rules.discovery
              : feature === "communities"
                ? rules.communities
                : feature === "media_sharing"
                  ? rules.mediaSharing
                  : true;
    if (!on) throw restricted(feature, message);
  }

  /** A friend request (or accepting one) between `me` and `other`, for either side being a child. */
  async function mayFriend(me: string, other: string) {
    const kids = await childRulesOf(db, [me, other]);
    const mine = kids.get(me);
    if (mine && !(await allows(me, mine, other, "friend")))
      throw restricted(
        "friend_requests",
        "Your family settings do not allow friend requests with this person",
      );
    const theirs = kids.get(other);
    if (theirs && !(await allows(other, theirs, me, "friend")))
      throw restricted("friend_requests", "This person cannot get friend requests from you");
  }

  /** Messages among these people (`me` among them): every child in it must be allowed to reach each
   *  of the others. */
  async function mayMessage(me: string, members: string[]) {
    const everyone = [...new Set([me, ...members])];
    const kids = await childRulesOf(db, everyone);
    for (const [child, rules] of kids)
      for (const other of everyone)
        if (other !== child && !(await allows(child, rules, other, "message")))
          throw child === me
            ? restricted("messages", "Your family settings do not allow messages with this person")
            : restricted("messages", "Someone here cannot get messages from you");
  }

  /** A call: voice chat on for each child in it, and for a call between two people, messages too. */
  async function mayCall(me: string, callee?: string) {
    const kids = await childRulesOf(db, callee ? [me, callee] : [me]);
    if (kids.get(me) && !kids.get(me)?.voiceChat)
      throw restricted("voice_chat", "Your family settings turn voice chat off");
    if (callee && kids.get(callee) && !kids.get(callee)?.voiceChat)
      throw restricted("voice_chat", "This person cannot take calls");
    if (callee) await mayMessage(me, [callee]);
  }

  /** Of these people, the children who may not use a feature (for invites to share plays). */
  async function without(ids: string[], feature: "share_play" | "voice_chat") {
    const kids = await childRulesOf(db, ids);
    return new Set(
      [...kids].filter(([, r]) => !(feature === "share_play" ? r.sharePlay : r.voiceChat)).map(([id]) => id),
    );
  }

  /** A child playing (hosting or joining) a game: its age rating against the limit. */
  async function mayPlay(userId: string, titleId: string) {
    const rules = await rulesOf(userId);
    if (!rules || rules.ageLimit === null) return;
    const [game] = await db.select({ levels: games.ageLevels }).from(games).where(eq(games.titleId, titleId));
    if (titleVerdict(rules, titleId, game?.levels ?? null) !== "allowed")
      throw restricted("age_rating", "Your family settings do not allow this game");
  }

  return { rulesOf, need, mayFriend, mayMessage, mayCall, mayPlay, without, sameFamily };
}
export type FamilyGuard = ReturnType<typeof familyGuard>;

/** Eight characters people can read out: no 0/O, no 1/I. */
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function linkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => codeAlphabet[b % codeAlphabet.length]).join("");
}

const validZone = (zone: string | undefined) => {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
};

const roleOrder: Record<FamilyRole, number> = { manager: 0, parent: 1, adult: 2, child: 3 };
const day = 86_400_000;

/** Seconds played on the child's day so far (sessions from every computer, as synced). */
async function playedToday(db: Querier, userId: string, now: Date, timeZone: string) {
  const clock = localClock(now, timeZone);
  const start = new Date(now.getTime() - clock.seconds * 1000);
  const [row] = await db.execute<{ seconds: number }>(sql`
    select coalesce(sum(extract(epoch from least(ended_at, ${now.toISOString()}::timestamptz)
      - greatest(started_at, ${start.toISOString()}::timestamptz))), 0)::int seconds
    from play_sessions
    where account_id = ${userId}::uuid and ended_at > ${start.toISOString()}::timestamptz
      and started_at < ${now.toISOString()}::timestamptz`);
  return Math.max(0, Number(row?.seconds ?? 0));
}

async function bonusOn(db: Querier, userId: string, date: string) {
  const [row] = await db.execute<{ minutes: number }>(sql`
    select coalesce(sum(granted_minutes), 0)::int minutes from family_requests
    where child_id = ${userId}::uuid and kind = 'more_time' and status = 'approved' and day = ${date}`);
  return Number(row?.minutes ?? 0);
}

/** What GET /me/family/restrictions says about someone now. */
export async function familyStatus(db: Querier, userId: string, now = new Date()): Promise<FamilyStatus> {
  const membership = await membershipOf(db, userId);
  const issuedAt = now.toISOString();
  if (!membership || membership.member.role !== "child")
    return {
      userId,
      restricted: false,
      familyId: membership?.family.id ?? null,
      role: (membership?.member.role as FamilyRole) ?? null,
      restrictions: null,
      today: null,
      issuedAt,
    };
  const rules = (await childRulesOf(db, [userId])).get(userId) ?? defaultRestrictions();
  const zone = rules.playTime.timeZone;
  const today: Allowance = allowance(rules.playTime, {
    now,
    playedSeconds: await playedToday(db, userId, now, zone),
    bonusMinutes: await bonusOn(db, userId, localClock(now, zone).date),
  });
  return {
    userId,
    restricted: true,
    familyId: membership.family.id,
    role: "child",
    restrictions: rules,
    today,
    issuedAt,
  };
}

/** Families: making one, members and invites, child accounts and link codes, the children's limits,
 *  their requests and activity, and the status the launchers enforce. */
export function familyRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const who = people(db);
  const limit = rateLimiter(valkey, deps.limits);

  const log = (
    familyId: string,
    actorId: string | null,
    action: string,
    subjectId: string | null = null,
    data: Record<string, unknown> = {},
  ) => db.insert(familyLog).values({ id: uuidv7(), familyId, actorId, action, subjectId, data });

  const membersOf = (familyId: string) =>
    db.select().from(familyMembers).where(eq(familyMembers.familyId, familyId));
  const guardiansOf = async (familyId: string) =>
    (await membersOf(familyId)).filter((m) => isGuardian(m.role as FamilyRole)).map((m) => m.accountId);
  /** Tells someone's launchers and pages to fetch their family status again. */
  const changed = (userId: string, familyId: string | null) =>
    publish(valkey, userId, { type: "family.updated", data: { familyId } });

  const mine = async (me: string) => {
    const row = await membershipOf(db, me);
    if (!row) throw new HttpError(404, ErrorCode.notFound, "You are not in a family");
    return { ...row, role: row.member.role as FamilyRole };
  };
  const asManager = async (me: string) => {
    const row = await mine(me);
    if (row.role !== "manager")
      throw new HttpError(403, ErrorCode.forbidden, "Only the family manager can do that");
    return row;
  };
  const asGuardian = async (me: string) => {
    const row = await mine(me);
    if (!isGuardian(row.role)) throw new HttpError(403, ErrorCode.forbidden, "Only a parent can do that");
    return row;
  };
  /** A child of the asker's family, for a parent or the manager. */
  const childOf = async (me: string, childId: string) => {
    const row = await asGuardian(me);
    if (!z.string().uuid().safeParse(childId).success)
      throw new HttpError(404, ErrorCode.notFound, "No such child in your family");
    const [child] = await db
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, row.family.id),
          eq(familyMembers.accountId, childId),
          eq(familyMembers.role, "child"),
        ),
      );
    if (!child) throw new HttpError(404, ErrorCode.notFound, "No such child in your family");
    return { ...row, child };
  };
  const notIn = async (userId: string, message: string) => {
    if (await membershipOf(db, userId)) throw new HttpError(409, ErrorCode.conflict, message);
  };
  const roomIn = async (familyId: string) => {
    if ((await membersOf(familyId)).length >= maxFamilyMembers)
      throw new HttpError(409, ErrorCode.full, `A family has at most ${maxFamilyMembers} people`);
  };

  const rulesRow = async (childId: string) =>
    (await db.select().from(childRestrictions).where(eq(childRestrictions.accountId, childId)))[0];
  const saveRules = async (childId: string, rules: FamilyRestrictions, by: string | null) => {
    await db
      .insert(childRestrictions)
      .values({ accountId: childId, settings: rules, updatedBy: by })
      .onConflictDoUpdate({
        target: childRestrictions.accountId,
        set: { settings: rules, updatedBy: by, updatedAt: new Date() },
      });
    await enforceStored(deps, childId, rules);
  };

  // --- views

  const inviteViews = async (rows: (typeof familyInvites.$inferSelect)[]): Promise<FamilyInviteView[]> => {
    if (!rows.length) return [];
    const familyRows = await db
      .select()
      .from(families)
      .where(inArray(families.id, [...new Set(rows.map((r) => r.familyId))]));
    const names = new Map(familyRows.map((f) => [f.id, f.name]));
    const cards = await who.cards(
      rows.flatMap((r) => [r.invitedBy, r.accountId].filter(Boolean) as string[]),
    );
    return rows.map((r) => ({
      id: r.id,
      familyId: r.familyId,
      familyName: names.get(r.familyId) ?? "",
      role: r.role as FamilyRole,
      from: r.invitedBy ? (cards.get(r.invitedBy) ?? null) : null,
      to: r.accountId ? (cards.get(r.accountId) ?? null) : null,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  };

  const familyView = async (family: Family, role: FamilyRole): Promise<FamilyView> => {
    const members = await membersOf(family.id);
    const cards = await who.cards(members.map((m) => m.accountId));
    const list: FamilyMemberView[] = members
      .map((m) => {
        const card = cards.get(m.accountId);
        return card
          ? {
              ...card,
              role: m.role as FamilyRole,
              joinedAt: m.joinedAt.toISOString(),
              confirmed: m.confirmedAt !== null || m.role !== "child",
            }
          : null;
      })
      .filter((m): m is FamilyMemberView => m !== null)
      .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.displayName.localeCompare(b.displayName));
    const invites =
      role === "manager"
        ? await inviteViews(
            await db
              .select()
              .from(familyInvites)
              .where(
                and(
                  eq(familyInvites.familyId, family.id),
                  eq(familyInvites.kind, "member"),
                  gt(familyInvites.expiresAt, new Date()),
                ),
              )
              .orderBy(desc(familyInvites.createdAt)),
          )
        : [];
    return {
      id: family.id,
      name: family.name,
      createdAt: family.createdAt.toISOString(),
      members: list,
      role,
      invites,
    };
  };

  const requestViews = async (rows: RequestRow[]): Promise<FamilyRequestView[]> => {
    const ids = rows.flatMap((r) => {
      const data = r.data as { userId?: string };
      return [r.childId, r.answeredBy, data.userId].filter(Boolean) as string[];
    });
    const cards = await who.cards(ids);
    const titleIds = [
      ...new Set(rows.map((r) => (r.data as { titleId?: string }).titleId).filter(Boolean)),
    ] as string[];
    const gameRows = titleIds.length
      ? await db.select().from(games).where(inArray(games.titleId, titleIds))
      : [];
    const gameNames = new Map(
      gameRows.map((g) => [g.titleId, g.names.en ?? Object.values(g.names)[0] ?? null]),
    );
    return rows.map((r) => {
      const data = r.data as {
        minutes?: number;
        userId?: string;
        titleId?: string;
        name?: string;
        note?: string;
      };
      return {
        id: r.id,
        kind: r.kind as FamilyRequestKind,
        status: r.status as FamilyRequestStatus,
        child: cards.get(r.childId) ?? null,
        minutes: data.minutes ?? null,
        grantedMinutes: r.grantedMinutes,
        person: data.userId ? (cards.get(data.userId) ?? null) : null,
        titleId: data.titleId ?? null,
        gameName: (data.titleId ? gameNames.get(data.titleId) : null) ?? data.name ?? null,
        note: data.note ?? null,
        day: r.day,
        answeredBy: r.answeredBy ? (cards.get(r.answeredBy) ?? null) : null,
        answeredAt: r.answeredAt ? r.answeredAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  };

  // --- the family itself

  app.get("/me/family", async (c) => {
    const me = c.get("userId");
    const row = await membershipOf(db, me);
    const waiting = await db
      .select()
      .from(familyInvites)
      .where(and(eq(familyInvites.accountId, me), gt(familyInvites.expiresAt, new Date())))
      .orderBy(desc(familyInvites.createdAt));
    const view: MyFamilyView = {
      family: row ? await familyView(row.family, row.member.role as FamilyRole) : null,
      invites: await inviteViews(waiting),
    };
    return c.json(view);
  });

  app.post("/families", async (c) => {
    const me = c.get("userId");
    const { name } = await body(c, FamilyCreate);
    await limit("family", me);
    await notIn(me, "You are in a family already");
    const id = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(families).values({ id, name, createdBy: me });
        await tx
          .insert(familyMembers)
          .values({ familyId: id, accountId: me, role: "manager", addedBy: me, confirmedAt: new Date() });
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, ErrorCode.conflict, "You are in a family already");
      throw error;
    }
    await log(id, me, "family.created", null, { name });
    const [family] = await db.select().from(families).where(eq(families.id, id));
    return c.json(await familyView(family as Family, "manager"), 201);
  });

  app.patch("/me/family", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const { name } = await body(c, FamilyUpdate);
    await db.update(families).set({ name }).where(eq(families.id, family.id));
    await log(family.id, me, "family.renamed", null, { name });
    return c.json(await familyView({ ...family, name }, "manager"));
  });

  /** The manager ends the family: everyone leaves it, children's limits go with it. */
  app.delete("/me/family", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const members = await membersOf(family.id);
    const children = members.filter((m) => m.role === "child").map((m) => m.accountId);
    await db.transaction(async (tx) => {
      if (children.length)
        await tx.delete(childRestrictions).where(inArray(childRestrictions.accountId, children));
      await tx.delete(families).where(eq(families.id, family.id));
    });
    for (const m of members) await changed(m.accountId, null);
    return c.body(null, 204);
  });

  // --- invites for adults and parents

  app.post("/me/family/invites", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const input = await body(c, FamilyInviteCreate);
    await limit("family", me);
    const target = await findProfile(db, input.handle);
    if (!target || (await blockedBetween(db, me, target.accountId)))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    if (target.accountId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
    await notIn(target.accountId, "This person is in a family already");
    await roomIn(family.id);
    const [existing] = await db
      .select()
      .from(familyInvites)
      .where(
        and(
          eq(familyInvites.familyId, family.id),
          eq(familyInvites.accountId, target.accountId),
          gt(familyInvites.expiresAt, new Date()),
        ),
      );
    if (existing) return c.json((await inviteViews([existing]))[0]);
    const [invite] = await db
      .insert(familyInvites)
      .values({
        id: uuidv7(),
        familyId: family.id,
        kind: "member",
        accountId: target.accountId,
        role: input.role,
        invitedBy: me,
        expiresAt: new Date(Date.now() + familyInviteDays * day),
      })
      .returning();
    const inviteRow = invite as typeof familyInvites.$inferSelect;
    await log(family.id, me, "member.invited", target.accountId, { role: input.role });
    await notes.notify(target.accountId, {
      kind: "family_invite",
      actorId: me,
      subjectId: inviteRow.id,
      data: { inviteId: inviteRow.id, familyId: family.id, familyName: family.name, role: input.role },
    });
    return c.json((await inviteViews([inviteRow]))[0], 201);
  });

  app.delete("/me/family/invites/:id", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const id = c.req.param("id");
    const removed = z.string().uuid().safeParse(id).success
      ? await db
          .delete(familyInvites)
          .where(and(eq(familyInvites.id, id), eq(familyInvites.familyId, family.id)))
          .returning()
      : [];
    const gone = removed[0];
    if (!gone) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    if (gone.accountId) await notes.withdraw(gone.accountId, "family_invite", gone.id);
    await log(family.id, me, "invite.cancelled", gone.accountId);
    return c.body(null, 204);
  });

  const myInvite = async (me: string, id: string) => {
    const [invite] = z.string().uuid().safeParse(id).success
      ? await db
          .select()
          .from(familyInvites)
          .where(
            and(
              eq(familyInvites.id, id),
              eq(familyInvites.accountId, me),
              gt(familyInvites.expiresAt, new Date()),
            ),
          )
      : [];
    if (!invite) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    return invite;
  };

  app.post("/family-invites/:id/accept", async (c) => {
    const me = c.get("userId");
    const invite = await myInvite(me, c.req.param("id"));
    await notIn(me, "You are in a family already");
    await roomIn(invite.familyId);
    await db.transaction(async (tx) => {
      await tx.insert(familyMembers).values({
        familyId: invite.familyId,
        accountId: me,
        role: invite.role,
        addedBy: invite.invitedBy,
        confirmedAt: new Date(),
      });
      await tx.delete(familyInvites).where(eq(familyInvites.accountId, me));
    });
    await notes.settle(me, "family_invite", invite.id);
    await log(invite.familyId, me, "member.joined", me, { role: invite.role });
    for (const guardian of (await membersOf(invite.familyId)).filter((m) => m.role === "manager"))
      await notes.notify(guardian.accountId, {
        kind: "family_alert",
        actorId: me,
        subjectId: `${me}:joined`,
        data: { event: "member_joined", role: invite.role },
      });
    await changed(me, invite.familyId);
    const row = await mine(me);
    return c.json(await familyView(row.family, row.role));
  });

  app.post("/family-invites/:id/decline", async (c) => {
    const me = c.get("userId");
    const invite = await myInvite(me, c.req.param("id"));
    await db.delete(familyInvites).where(eq(familyInvites.id, invite.id));
    await notes.settle(me, "family_invite", invite.id);
    await log(invite.familyId, me, "invite.declined", me);
    return c.body(null, 204);
  });

  // --- children: new accounts and link codes

  app.post("/me/family/children", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const input = await body(c, FamilyChildCreate);
    await limit("family", me);
    await roomIn(family.id);
    const [taken] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, input.email));
    if (taken)
      throw new HttpError(
        409,
        ErrorCode.conflict,
        "That address has an account: link it with a code instead",
        {
          hint: "link_code",
        },
      );
    const { accountId, created } = await findOrCreateAccount(db, {
      provider: "email",
      subject: input.email,
      email: input.email,
      emailVerified: true,
      name: input.displayName,
    });
    if (!created)
      throw new HttpError(
        409,
        ErrorCode.conflict,
        "That address has an account: link it with a code instead",
      );
    await db.insert(familyMembers).values({ familyId: family.id, accountId, role: "child", addedBy: me });
    await saveRules(accountId, defaultRestrictions(validZone(input.timeZone)), me);
    await log(family.id, me, "child.created", accountId);
    const manager = await who.card(me);
    await deps.mailer
      .familyChild(
        input.email,
        { familyName: family.name, managerName: manager?.displayName ?? "" },
        deps.publicUrl,
      )
      .catch((error) => console.error("family mail failed", error));
    const view = await familyView(family, "manager");
    return c.json({ child: view.members.find((m) => m.userId === accountId) ?? null, family: view }, 201);
  });

  /** A code for linking an existing account as a child: the manager reads it to the child, who
   *  enters it signed in (POST /me/family/join). */
  app.post("/me/family/link-codes", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    await limit("family", me);
    await roomIn(family.id);
    const code = linkCode();
    const expiresAt = new Date(Date.now() + familyCodeHours * 3_600_000);
    await db.insert(familyInvites).values({
      id: uuidv7(),
      familyId: family.id,
      kind: "child_link",
      role: "child",
      codeHash: hash(code),
      invitedBy: me,
      expiresAt,
    });
    await log(family.id, me, "link_code.created");
    return c.json({ code, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.post("/me/family/join", async (c) => {
    const me = c.get("userId");
    const input = await body(c, FamilyJoin);
    await limit("family", me);
    const [invite] = await db
      .select()
      .from(familyInvites)
      .where(
        and(
          eq(familyInvites.codeHash, hash(input.code)),
          eq(familyInvites.kind, "child_link"),
          gt(familyInvites.expiresAt, new Date()),
        ),
      );
    if (!invite) throw new HttpError(400, ErrorCode.codeInvalid, "That code is wrong or too old");
    await notIn(me, "You are in a family already: leave it first");
    await roomIn(invite.familyId);
    await db.transaction(async (tx) => {
      await tx.insert(familyMembers).values({
        familyId: invite.familyId,
        accountId: me,
        role: "child",
        addedBy: invite.invitedBy,
        confirmedAt: new Date(),
      });
      await tx.delete(familyInvites).where(eq(familyInvites.id, invite.id));
    });
    await saveRules(me, defaultRestrictions(validZone(input.timeZone)), invite.invitedBy);
    await log(invite.familyId, me, "child.linked", me);
    for (const guardian of await guardiansOf(invite.familyId))
      await notes.notify(guardian, {
        kind: "family_alert",
        actorId: me,
        subjectId: `${me}:joined`,
        data: { event: "child_joined", childId: me },
      });
    await changed(me, invite.familyId);
    const row = await mine(me);
    return c.json(await familyView(row.family, row.role));
  });

  /** A child account the manager made: the child says yes, or that this is not their family (the
   *  account then leaves it and the parents hear it). */
  app.post("/me/family/confirm", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    if (row.role !== "child" || row.member.confirmedAt)
      throw new HttpError(409, ErrorCode.conflict, "Nothing to confirm");
    await db.update(familyMembers).set({ confirmedAt: new Date() }).where(eq(familyMembers.accountId, me));
    await log(row.family.id, me, "child.confirmed", me);
    return c.json(await familyView(row.family, row.role));
  });

  app.post("/me/family/not-mine", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    if (row.role !== "child" || row.member.confirmedAt)
      throw new HttpError(409, ErrorCode.conflict, "Only a new account not confirmed yet can say that");
    await db.transaction(async (tx) => {
      await tx.delete(familyMembers).where(eq(familyMembers.accountId, me));
      await tx.delete(childRestrictions).where(eq(childRestrictions.accountId, me));
    });
    await log(row.family.id, me, "child.declined", me);
    for (const guardian of await guardiansOf(row.family.id))
      await notes.notify(guardian, {
        kind: "family_alert",
        actorId: me,
        subjectId: `${me}:declined`,
        data: { event: "child_declined", childId: me },
      });
    await changed(me, null);
    return c.body(null, 204);
  });

  // --- members

  app.patch("/me/family/members/:userId", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const userId = c.req.param("userId");
    const { role } = await body(c, FamilyRoleChange);
    const members = await membersOf(family.id);
    const target = members.find((m) => m.accountId === userId);
    if (!target || userId === me) throw new HttpError(404, ErrorCode.notFound, "No such member");
    if (target.role === "child")
      throw new HttpError(400, ErrorCode.badRequest, "A child account stays a child while in the family");
    if (role === "manager") {
      await db.transaction(async (tx) => {
        await tx.update(familyMembers).set({ role: "parent" }).where(eq(familyMembers.accountId, me));
        await tx.update(familyMembers).set({ role: "manager" }).where(eq(familyMembers.accountId, userId));
      });
      await log(family.id, me, "family.handed_over", userId);
    } else {
      await db.update(familyMembers).set({ role }).where(eq(familyMembers.accountId, userId));
      await log(family.id, me, "member.role_changed", userId, { from: target.role, to: role });
    }
    await changed(userId, family.id);
    const row = await mine(me);
    return c.json(await familyView(row.family, row.role));
  });

  const removeMember = async (familyId: string, member: Member) => {
    await db.transaction(async (tx) => {
      await tx.delete(familyMembers).where(eq(familyMembers.accountId, member.accountId));
      if (member.role === "child")
        await tx.delete(childRestrictions).where(eq(childRestrictions.accountId, member.accountId));
    });
    await changed(member.accountId, null);
    return familyId;
  };

  app.delete("/me/family/members/:userId", async (c) => {
    const me = c.get("userId");
    const { family } = await asManager(me);
    const userId = c.req.param("userId");
    if (userId === me) throw new HttpError(400, ErrorCode.badRequest, "Leave or end the family instead");
    const target = (await membersOf(family.id)).find((m) => m.accountId === userId);
    if (!target) throw new HttpError(404, ErrorCode.notFound, "No such member");
    await removeMember(family.id, target);
    await log(family.id, me, "member.removed", userId, { role: target.role });
    return c.body(null, 204);
  });

  /** Leaving: a child cannot (a parent removes them); the manager hands over first, or, alone,
   *  the family ends. */
  app.post("/me/family/leave", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    if (row.role === "child") throw restricted("family", "Ask a parent to take you out of the family");
    if (row.role === "manager") {
      const others = (await membersOf(row.family.id)).filter((m) => m.accountId !== me);
      if (others.length) throw new HttpError(409, ErrorCode.conflict, "Hand the family over or end it first");
      await db.delete(families).where(eq(families.id, row.family.id));
      await changed(me, null);
      return c.body(null, 204);
    }
    await removeMember(row.family.id, row.member);
    await log(row.family.id, me, "member.left", me);
    return c.body(null, 204);
  });

  // --- a child's limits

  app.get("/me/family/children/:userId/restrictions", async (c) => {
    const me = c.get("userId");
    const { child } = await childOf(me, c.req.param("userId"));
    const row = await rulesRow(child.accountId);
    const rules = restrictionsOf(row?.settings ?? {});
    const cards = await who.cards(rules.approvedContacts);
    const status = await familyStatus(db, child.accountId);
    return c.json({
      restrictions: rules,
      approvedContacts: rules.approvedContacts.map((id) => cards.get(id)).filter(Boolean),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ? await who.card(row.updatedBy) : null,
      today: status.today,
    });
  });

  app.patch("/me/family/children/:userId/restrictions", async (c) => {
    const me = c.get("userId");
    const { family, child } = await childOf(me, c.req.param("userId"));
    const update = await body(c, FamilyRestrictionsUpdate);
    const before = restrictionsOf((await rulesRow(child.accountId))?.settings ?? {});
    const after = applyRestrictionsUpdate(before, update);
    await saveRules(child.accountId, after, me);
    const changedKeys = Object.keys(update);
    await log(family.id, me, "restrictions.changed", child.accountId, { changed: changedKeys });
    await changed(child.accountId, family.id);
    const cards = await who.cards(after.approvedContacts);
    return c.json({
      restrictions: after,
      approvedContacts: after.approvedContacts.map((id) => cards.get(id)).filter(Boolean),
      updatedAt: new Date().toISOString(),
      updatedBy: await who.card(me),
      today: (await familyStatus(db, child.accountId)).today,
    });
  });

  /** Extra time today, given without being asked. */
  app.post("/me/family/children/:userId/time-grants", async (c) => {
    const me = c.get("userId");
    const { family, child } = await childOf(me, c.req.param("userId"));
    const { minutes } = await body(c, FamilyTimeGrant);
    const rules = restrictionsOf((await rulesRow(child.accountId))?.settings ?? {});
    const date = localClock(new Date(), rules.playTime.timeZone).date;
    const id = uuidv7();
    await db.insert(familyRequests).values({
      id,
      familyId: family.id,
      childId: child.accountId,
      kind: "more_time",
      data: { minutes, given: true },
      day: date,
      status: "approved",
      grantedMinutes: minutes,
      answeredBy: me,
      answeredAt: new Date(),
    });
    await log(family.id, me, "time.granted", child.accountId, { minutes, day: date });
    await notes.notify(child.accountId, {
      kind: "family_answer",
      actorId: me,
      subjectId: id,
      data: { requestId: id, kind: "more_time", approved: true, minutes },
    });
    await changed(child.accountId, family.id);
    return c.json((await familyStatus(db, child.accountId)).today, 201);
  });

  /** A child's play over the last `days` days (7 by default, at most 90). */
  app.get("/me/family/children/:userId/activity", async (c) => {
    const me = c.get("userId");
    const { child } = await childOf(me, c.req.param("userId"));
    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 7) || 7));
    return c.json(await activityOf(child.accountId, days));
  });

  async function activityOf(childId: string, days: number, now = new Date()) {
    const rules = restrictionsOf((await rulesRow(childId))?.settings ?? {});
    const zone = rules.playTime.timeZone;
    const clock = localClock(now, zone);
    const until = new Date(now.getTime());
    const from = new Date(now.getTime() - clock.seconds * 1000 - (days - 1) * day);
    const fromIso = from.toISOString();
    const untilIso = until.toISOString();
    const perDay = await db.execute<{ date: string; seconds: number }>(sql`
      select to_char((started_at at time zone ${zone})::date, 'YYYY-MM-DD') date,
        sum(extract(epoch from ended_at - started_at))::int seconds
      from play_sessions where account_id = ${childId}::uuid
        and started_at >= ${fromIso}::timestamptz and started_at < ${untilIso}::timestamptz
      group by 1 order by 1`);
    const perGame = await db.execute<{ title_id: string; seconds: number; last: string }>(sql`
      select title_id, sum(extract(epoch from ended_at - started_at))::int seconds, max(ended_at) last
      from play_sessions where account_id = ${childId}::uuid
        and started_at >= ${fromIso}::timestamptz and started_at < ${untilIso}::timestamptz
      group by title_id order by 2 desc`);
    const titleIds = perGame.map((g) => g.title_id);
    const names = new Map(
      titleIds.length
        ? (await db.select().from(games).where(inArray(games.titleId, titleIds))).map((g) => [
            g.titleId,
            g.names,
          ])
        : [],
    );
    const friends = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.state, "accepted"),
          or(eq(friendships.userA, childId), eq(friendships.userB, childId)),
          gt(friendships.acceptedAt, from),
        ),
      );
    const cards = await who.cards([
      childId,
      ...friends.map((f) => (f.userA === childId ? f.userB : f.userA)),
    ]);
    const [asked] = await db.execute<{ n: number }>(sql`
      select count(*)::int n from family_requests where child_id = ${childId}::uuid
        and created_at >= ${fromIso}::timestamptz and (data->>'given') is null`);
    const byDate = new Map(perDay.map((d) => [d.date, Number(d.seconds)]));
    const dates = Array.from(
      { length: days },
      (_, i) => localClock(new Date(now.getTime() - (days - 1 - i) * day), zone).date,
    );
    return {
      child: cards.get(childId) as MemberView,
      from: dates[0] as string,
      until: clock.date,
      totalSeconds: perDay.reduce((sum, d) => sum + Number(d.seconds), 0),
      days: dates.map((date) => ({ date, seconds: byDate.get(date) ?? 0 })),
      games: perGame.map((g) => ({
        titleId: g.title_id,
        names: names.get(g.title_id) ?? {},
        seconds: Number(g.seconds),
        lastPlayedAt: new Date(g.last).toISOString(),
      })),
      friendsAdded: friends
        .map((f) => {
          const other = cards.get(f.userA === childId ? f.userB : f.userA);
          return other ? { ...other, at: (f.acceptedAt as Date).toISOString() } : null;
        })
        .filter((f): f is MemberView & { at: string } => f !== null),
      requests: Number(asked?.n ?? 0),
    };
  }

  app.get("/me/family/log", async (c) => {
    const me = c.get("userId");
    const { family } = await asGuardian(me);
    const before = c.req.query("before");
    if (before !== undefined && !z.string().uuid().safeParse(before).success)
      throw new HttpError(400, ErrorCode.badRequest, "before: an entry ID");
    const rows = await db
      .select()
      .from(familyLog)
      .where(and(eq(familyLog.familyId, family.id), before ? lt(familyLog.id, before) : undefined))
      .orderBy(desc(familyLog.id))
      .limit(51);
    const page = rows.slice(0, 50);
    const cards = await who.cards(page.flatMap((r) => [r.actorId, r.subjectId].filter(Boolean) as string[]));
    const entries: FamilyLogView[] = page.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actorId ? (cards.get(r.actorId) ?? null) : null,
      subject: r.subjectId ? (cards.get(r.subjectId) ?? null) : null,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    }));
    return c.json({ entries, more: rows.length > 50 });
  });

  // --- requests

  app.post("/me/family/requests", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    if (row.role !== "child") throw new HttpError(403, ErrorCode.forbidden, "Only a child asks the parents");
    const input = await body(c, FamilyRequestCreate);
    await limit("familyRequest", me);
    const rules = restrictionsOf((await rulesRow(me))?.settings ?? {});
    let data: Record<string, unknown>;
    let dayOf: string | null = null;
    if (input.kind === "more_time") {
      dayOf = localClock(new Date(), rules.playTime.timeZone).date;
      data = { minutes: input.minutes, titleId: input.titleId, note: input.note };
    } else if (input.kind === "add_friend") {
      const target = await findProfile(db, input.handle);
      if (!target || target.accountId === me || (await blockedBetween(db, me, target.accountId)))
        throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
      data = { userId: target.accountId, note: input.note };
    } else data = { titleId: input.titleId, name: input.name, note: input.note };
    // One waiting request of a kind (per game or person) is enough.
    const [waiting] = await db
      .select()
      .from(familyRequests)
      .where(
        and(
          eq(familyRequests.childId, me),
          eq(familyRequests.kind, input.kind),
          eq(familyRequests.status, "pending"),
          input.kind === "more_time" ? eq(familyRequests.day, dayOf as string) : undefined,
          input.kind === "add_friend"
            ? sql`${familyRequests.data}->>'userId' = ${data.userId as string}`
            : undefined,
          input.kind === "play_game"
            ? sql`${familyRequests.data}->>'titleId' = ${data.titleId as string}`
            : undefined,
        ),
      );
    if (waiting) return c.json((await requestViews([waiting]))[0]);
    const [made] = (await db
      .insert(familyRequests)
      .values({ id: uuidv7(), familyId: row.family.id, childId: me, kind: input.kind, data, day: dayOf })
      .returning()) as [RequestRow];
    const [view] = await requestViews([made]);
    await log(row.family.id, me, "request.made", me, { kind: input.kind });
    for (const guardian of await guardiansOf(row.family.id))
      await notes.notify(guardian, {
        kind: "family_request",
        actorId: me,
        subjectId: made.id,
        data: {
          requestId: made.id,
          kind: input.kind,
          minutes: view?.minutes ?? null,
          titleId: view?.titleId ?? null,
          gameName: view?.gameName ?? null,
          person: view?.person ?? null,
        },
      });
    return c.json(view, 201);
  });

  /** A child sees their own; a parent or the manager the family's (pending first by default). */
  app.get("/me/family/requests", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    const status = c.req.query("status");
    if (
      status !== undefined &&
      status !== "all" &&
      !familyRequestStatuses.includes(status as FamilyRequestStatus)
    )
      throw new HttpError(400, ErrorCode.badRequest, "status: pending, approved, declined or all");
    if (row.role === "adult") throw new HttpError(403, ErrorCode.forbidden, "Only a parent sees requests");
    const rows = await db
      .select()
      .from(familyRequests)
      .where(
        and(
          eq(familyRequests.familyId, row.family.id),
          row.role === "child" ? eq(familyRequests.childId, me) : undefined,
          status && status !== "all" ? eq(familyRequests.status, status) : undefined,
          sql`(${familyRequests.data}->>'given') is null`,
        ),
      )
      .orderBy(desc(familyRequests.id))
      .limit(100);
    return c.json({ requests: await requestViews(rows) });
  });

  app.post("/me/family/requests/:id/:answer{approve|decline}", async (c) => {
    const me = c.get("userId");
    const { family } = await asGuardian(me);
    const id = c.req.param("id");
    const approve = c.req.param("answer") === "approve";
    const input = await body(c, FamilyRequestAnswer);
    const [request] = z.string().uuid().safeParse(id).success
      ? await db
          .select()
          .from(familyRequests)
          .where(and(eq(familyRequests.id, id), eq(familyRequests.familyId, family.id)))
      : [];
    if (!request) throw new HttpError(404, ErrorCode.notFound, "No such request");
    if (request.status !== "pending") throw new HttpError(409, ErrorCode.conflict, "Already answered");
    const data = request.data as { minutes?: number; userId?: string; titleId?: string };
    const granted = request.kind === "more_time" && approve ? (input.minutes ?? data.minutes ?? 0) : null;
    const [answered] = await db
      .update(familyRequests)
      .set({
        status: approve ? "approved" : "declined",
        grantedMinutes: granted,
        answeredBy: me,
        answeredAt: new Date(),
      })
      .where(and(eq(familyRequests.id, request.id), eq(familyRequests.status, "pending")))
      .returning();
    if (!answered) throw new HttpError(409, ErrorCode.conflict, "Already answered");
    if (approve && request.kind !== "more_time") {
      const before = restrictionsOf((await rulesRow(request.childId))?.settings ?? {});
      const after: FamilyRestrictions = { ...before };
      if (request.kind === "play_game" && data.titleId)
        after.allowedTitles = [...new Set([...before.allowedTitles, data.titleId])];
      if (request.kind === "add_friend" && data.userId) {
        after.approvedContacts = [...new Set([...before.approvedContacts, data.userId])];
        // A yes to one person opens requests to the approved people.
        if (after.friendRequests === "nobody") after.friendRequests = "approved";
      }
      await saveRules(request.childId, after, me);
    }
    await log(family.id, me, approve ? "request.approved" : "request.declined", request.childId, {
      kind: request.kind,
      ...(granted !== null ? { minutes: granted } : {}),
    });
    for (const guardian of await guardiansOf(family.id))
      await notes.settle(guardian, "family_request", request.id);
    await notes.notify(request.childId, {
      kind: "family_answer",
      actorId: me,
      subjectId: request.id,
      data: { requestId: request.id, kind: request.kind, approved: approve, minutes: granted },
    });
    // The friend request itself, now allowed, goes out from the child.
    if (approve && request.kind === "add_friend" && data.userId)
      await friendRequestFor(request.childId, data.userId);
    await changed(request.childId, family.id);
    return c.json((await requestViews([answered]))[0]);
  });

  /** After a parent's yes: the child's friend request to the person (or a yes to theirs). */
  async function friendRequestFor(childId: string, otherId: string) {
    if (await blockedBetween(db, childId, otherId)) return;
    const [userA, userB] = childId < otherId ? [childId, otherId] : [otherId, childId];
    const [existing] = await db
      .select()
      .from(friendships)
      .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)));
    if (existing) return;
    await db
      .insert(friendships)
      .values({ userA, userB, state: "pending", askedBy: childId })
      .onConflictDoNothing();
    const card = await who.card(childId);
    if (card)
      await publish(valkey, otherId, {
        type: "friend.request",
        data: { userId: childId, handle: card.handle, displayName: card.displayName },
      });
    await notes.notify(otherId, { kind: "friend_request", actorId: childId, subjectId: childId });
  }

  /** The launcher says today's limit was reached; the parents hear it once a day. */
  app.post("/me/family/limit-reached", async (c) => {
    const me = c.get("userId");
    const row = await mine(me);
    if (row.role !== "child") return c.body(null, 204);
    const input = await body(c, FamilyLimitReached);
    const rules = restrictionsOf((await rulesRow(me))?.settings ?? {});
    const date = localClock(new Date(), rules.playTime.timeZone).date;
    if (!rules.playTime.notifyParents) return c.body(null, 204);
    const first = await valkey.set(`family-limit:${me}:${date}`, "1", "EX", 2 * 86_400, "NX");
    if (first !== "OK") return c.body(null, 204);
    for (const guardian of await guardiansOf(row.family.id))
      await notes.notify(guardian, {
        kind: "family_alert",
        actorId: me,
        subjectId: `${me}:${date}`,
        data: { event: "limit_reached", childId: me, date, titleId: input.titleId ?? null },
      });
    await log(row.family.id, me, "limit.reached", me, { date, titleId: input.titleId ?? null });
    return c.body(null, 204);
  });

  /** What the launchers enforce, and the same signed for keeping offline. */
  app.get("/me/family/restrictions", async (c) => {
    const me = c.get("userId");
    const status = await familyStatus(db, me);
    const signed = await deps.tokens.signDocument(familyAudience, me, { family: status }, 30);
    const response: FamilyStatusResponse = { ...status, signed };
    return c.json(response);
  });

  return Object.assign(app, { activityOf });
}

/** Once a week per family with children: each parent's notification (and mail, for those who
 *  turned it on) with the week's play per child. Returns how many families were summed up. */
export async function sendFamilySummaries(
  deps: Pick<Deps, "db" | "valkey" | "mailer" | "publicUrl">,
  notes: Notifier,
  activityOf: (
    childId: string,
    days: number,
    now?: Date,
  ) => Promise<{
    child: MemberView;
    from: string;
    until: string;
    totalSeconds: number;
    games: { titleId: string; names: Record<string, string>; seconds: number }[];
    friendsAdded: unknown[];
  }>,
  now = new Date(),
) {
  const { db } = deps;
  const weekAgo = new Date(now.getTime() - 7 * day);
  const due = await db
    .select()
    .from(families)
    .where(
      and(
        or(and(isNull(families.summaryAt), lt(families.createdAt, weekAgo)), lt(families.summaryAt, weekAgo)),
        sql`exists (select 1 from family_members m where m.family_id = ${families.id} and m.role = 'child')`,
      ),
    )
    .limit(200);
  let sent = 0;
  for (const family of due) {
    const lock = `family-summary-lock:${family.id}`;
    if ((await deps.valkey.set(lock, "1", "PX", 600_000, "NX")) !== "OK") continue;
    try {
      const members = await db.select().from(familyMembers).where(eq(familyMembers.familyId, family.id));
      const children = await Promise.all(
        members.filter((m) => m.role === "child").map((m) => activityOf(m.accountId, 7, now)),
      );
      const summary = {
        familyId: family.id,
        from: children[0]?.from ?? "",
        until: children[0]?.until ?? "",
        children: children.map((c) => ({
          userId: c.child.userId,
          displayName: c.child.displayName,
          seconds: c.totalSeconds,
          games: c.games.slice(0, 5).map((g) => ({
            titleId: g.titleId,
            name: g.names.en ?? Object.values(g.names)[0] ?? g.titleId,
            seconds: g.seconds,
          })),
          friendsAdded: c.friendsAdded.length,
        })),
      };
      const guardians = members.filter((m) => isGuardian(m.role as FamilyRole)).map((m) => m.accountId);
      for (const guardian of guardians) {
        await notes.notify(guardian, {
          kind: "family_summary",
          subjectId: `${family.id}:${summary.until}`,
          data: summary,
        });
        const [row] = await db
          .select({ email: accounts.email, settings: profiles.notificationSettings })
          .from(accounts)
          .innerJoin(profiles, eq(profiles.accountId, accounts.id))
          .where(and(eq(accounts.id, guardian), eq(accounts.status, "active")));
        if (row?.email && notificationSettingsOf(row.settings).familyMail)
          await deps.mailer
            .familySummary(row.email, { familyName: family.name, ...summary }, deps.publicUrl)
            .catch((error) => console.error("family summary mail failed", error));
      }
      await db.update(families).set({ summaryAt: now }).where(eq(families.id, family.id));
      sent++;
    } finally {
      await deps.valkey.del(lock);
    }
  }
  return sent;
}
