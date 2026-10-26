import { randomInt, timingSafeEqual } from "node:crypto";
import {
  type Database,
  accounts,
  activities,
  activityReactions,
  appeals,
  auditLog,
  avatars,
  blocks,
  childRestrictions,
  communities,
  communityEvents,
  communityMembers,
  connections,
  conversationMembers,
  conversations,
  devices,
  earnedTrophies,
  eventRsvps,
  familyMembers,
  familyRequests,
  friendships,
  games,
  handleHistory,
  identities,
  library,
  messageReactions,
  messages,
  metPlayers,
  notifications,
  passkeys,
  playSessions,
  profiles,
  pushSubscriptions,
  reports,
  sessions,
  signInRequests,
} from "@anytogether/db";
import {
  ErrorCode,
  friendsKey,
  notificationSettingsOf,
  presenceExtraKey,
  presenceHiddenKey,
  presenceKey,
  privacyOf,
  userEvents,
} from "@anytogether/shared";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { handOverCommunities } from "./communities.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { familyAfterManager } from "./family.js";
import { refreshRarityOf } from "./games.js";
import { body } from "./http.js";
import { MailError } from "./mailCheck.js";
import { mediaService } from "./media.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { postsExport } from "./posts.js";
import { rateLimiter } from "./ratelimit.js";
import { revoke } from "./sessions.js";
import { hash } from "./tokens.js";

/** Days between asking to delete the account and it being gone; signing in meanwhile keeps it. */
export const deletionGraceDays = 14;
const deletionKey = (accountId: string) => `delete-code:${accountId}`;
const codeLifetime = 600;
const codeAttempts = 5;
/** Days an expired sign-in request is kept before the hourly purge removes it. */
const signInRequestDays = 30;

/** Signs out every session of the account (all of them, or all but `keep`). */
export async function revokeAll(ctx: { db: Database; valkey: Redis }, accountId: string, keep?: string) {
  const live = await ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
  for (const { id } of live) if (id !== keep) await revoke(ctx, id, accountId);
  return live.filter(({ id }) => id !== keep).length;
}

/** Everything held about the account, for "Download my data" (KVKK and GDPR). Cloud saves and media
 *  are listed with links to download them, good for a week. */
export async function exportAccount(
  db: Database,
  accountId: string,
  storage?: () => Promise<Record<string, unknown> | null>,
) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const [profile] = await db.select().from(profiles).where(eq(profiles.accountId, accountId));
  const pictures = await db.select().from(avatars).where(eq(avatars.accountId, accountId));
  const avatar = pictures.find((p) => !p.private);
  const privateAvatar = pictures.find((p) => p.private);
  const pairs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.userA, accountId), eq(friendships.userB, accountId)));
  const blocked = await db.select().from(blocks).where(eq(blocks.blocker, accountId));
  const others = [
    ...pairs.map((p) => (p.userA === accountId ? p.userB : p.userA)),
    ...blocked.map((b) => b.blocked),
  ];
  const handles = new Map(
    others.length
      ? (
          await db
            .select({ id: profiles.accountId, handle: profiles.handle })
            .from(profiles)
            .where(inArray(profiles.accountId, others))
        ).map((p) => [p.id, p.handle])
      : [],
  );
  return {
    exportedAt: new Date().toISOString(),
    account: account && {
      id: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
      deleteAfter: account.deleteAfter,
      createdAt: account.createdAt,
    },
    signInMethods: (await db.select().from(identities).where(eq(identities.accountId, accountId))).map(
      (i) => ({ provider: i.provider, subject: i.subject, createdAt: i.createdAt }),
    ),
    profile: profile && {
      handle: profile.handle,
      handleChangedAt: profile.handleChangedAt,
      displayName: profile.displayName,
      bio: profile.bio,
      country: profile.country,
      avatarUrl: profile.avatarUrl,
      // The account's own friends-only name (its picture is privateAvatar below); friends' private
      // fields are theirs and are never in this file.
      privateName: profile.privateName,
      privacy: privacyOf(profile.privacy),
      notificationSettings: notificationSettingsOf(profile.notificationSettings),
      trophyPoints: profile.trophyPoints,
      trophyLevel: profile.trophyLevel,
      cover: profile.cover,
      accent: profile.accent,
      showcase: profile.showcase,
      rememberMet: profile.rememberMet,
      readReceipts: profile.readReceipts,
    },
    playersMet: (await db.select().from(metPlayers).where(eq(metPlayers.accountId, accountId))).map(
      ({ accountId: _, ...met }) => met,
    ),
    communities: (
      await db
        .select({ member: communityMembers, community: communities })
        .from(communityMembers)
        .innerJoin(communities, eq(communities.id, communityMembers.communityId))
        .where(eq(communityMembers.accountId, accountId))
    ).map(({ member, community }) => ({
      id: community.id,
      name: community.name,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    eventsHosted: (await db.select().from(communityEvents).where(eq(communityEvents.hostId, accountId))).map(
      ({ hostId: _, ...event }) => event,
    ),
    eventRsvps: (await db.select().from(eventRsvps).where(eq(eventRsvps.accountId, accountId))).map(
      ({ accountId: _, ...rsvp }) => rsvp,
    ),
    avatar: avatar ? `data:image/jpeg;base64,${Buffer.from(avatar.bytes).toString("base64")}` : null,
    privateAvatar: privateAvatar
      ? `data:image/jpeg;base64,${Buffer.from(privateAvatar.bytes).toString("base64")}`
      : null,
    connections: (await db.select().from(connections).where(eq(connections.accountId, accountId))).map(
      (row) => ({
        provider: row.provider,
        externalId: row.externalId,
        name: row.name,
        username: row.username,
        hidden: row.hidden,
        createdAt: row.createdAt,
      }),
    ),
    appeals: (await db.select().from(appeals).where(eq(appeals.accountId, accountId))).map((row) => ({
      text: row.text,
      status: row.status,
      reply: row.reply,
      createdAt: row.createdAt,
      answeredAt: row.handledAt,
    })),
    passkeys: (await db.select().from(passkeys).where(eq(passkeys.accountId, accountId))).map((p) => ({
      id: p.id,
      name: p.name,
      deviceType: p.deviceType,
      backedUp: p.backedUp,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    })),
    oldHandles: (await db.select().from(handleHistory).where(eq(handleHistory.accountId, accountId))).map(
      (h) => ({ handle: h.handle, releasedAt: h.releasedAt }),
    ),
    sessions: (await db.select().from(sessions).where(eq(sessions.accountId, accountId))).map((s) => ({
      id: s.id,
      client: s.client,
      deviceName: s.deviceName,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
    })),
    signInRequests: (
      await db
        .select()
        .from(signInRequests)
        .where(
          or(
            eq(signInRequests.approvedBy, accountId),
            account?.email ? eq(signInRequests.email, account.email) : undefined,
          ),
        )
    ).map((r) => ({
      kind: r.kind,
      client: r.client,
      deviceName: r.deviceName,
      createdAt: r.createdAt,
      consumedAt: r.consumedAt,
    })),
    computers: (await db.select().from(devices).where(eq(devices.accountId, accountId))).map((d) => ({
      id: d.id,
      platform: d.platform,
      name: d.name,
      model: d.model,
      lastSeenAt: d.lastSeenAt,
    })),
    playSessions: (await db.select().from(playSessions).where(eq(playSessions.accountId, accountId))).map(
      (s) => ({
        id: s.id,
        titleId: s.titleId,
        deviceId: s.deviceId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        exit: s.exit,
      }),
    ),
    library: (await db.select().from(library).where(eq(library.accountId, accountId))).map(
      ({ accountId: _, ...entry }) => entry,
    ),
    trophies: (await db.select().from(earnedTrophies).where(eq(earnedTrophies.accountId, accountId))).map(
      ({ accountId: _, ...trophy }) => trophy,
    ),
    gamesTaught: (
      await db.select({ titleId: games.titleId }).from(games).where(eq(games.taughtBy, accountId))
    ).map((g) => g.titleId),
    activity: (
      await db.select().from(activities).where(eq(activities.actorId, accountId)).orderBy(asc(activities.id))
    ).map(({ actorId: _, ...item }) => item),
    reactions: (
      await db.select().from(activityReactions).where(eq(activityReactions.accountId, accountId))
    ).map(({ accountId: _, ...reaction }) => reaction),
    friends: pairs.map((p) => {
      const other = p.userA === accountId ? p.userB : p.userA;
      return {
        userId: other,
        handle: handles.get(other) ?? null,
        state: p.state,
        askedByMe: p.askedBy === accountId,
        createdAt: p.createdAt,
        acceptedAt: p.acceptedAt,
      };
    }),
    blocked: blocked.map((b) => ({
      userId: b.blocked,
      handle: handles.get(b.blocked) ?? null,
      createdAt: b.createdAt,
    })),
    messages: (
      await db
        .select()
        .from(messages)
        .where(and(eq(messages.authorId, accountId), isNull(messages.deletedAt)))
        .orderBy(asc(messages.createdAt))
    ).map((m) => ({
      conversationId: m.conversationId,
      seq: m.seq,
      text: m.text,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      editCount: m.editCount,
      replyTo: m.replyTo,
    })),
    messageReactions: (
      await db
        .select()
        .from(messageReactions)
        .where(eq(messageReactions.accountId, accountId))
        .orderBy(asc(messageReactions.createdAt))
    ).map((r) => ({
      conversationId: r.conversationId,
      seq: r.seq,
      reaction: r.reaction,
      createdAt: r.createdAt,
    })),
    conversations: (
      await db
        .select({ member: conversationMembers, conversation: conversations })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(eq(conversationMembers.accountId, accountId))
        .orderBy(asc(conversationMembers.joinedAt))
    ).map(({ member, conversation }) => ({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      createdByMe: conversation.createdBy === accountId,
      joinedAt: member.joinedAt,
      readSeq: member.readSeq,
      deliveredSeq: member.deliveredSeq,
      muted: member.muted,
      pinned: member.pinnedAt !== null,
    })),
    reportsSent: (
      await db.select().from(reports).where(eq(reports.reporterId, accountId)).orderBy(asc(reports.createdAt))
    ).map((r) => ({
      targetKind: r.targetKind,
      targetId: r.targetId,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
    })),
    notifications: (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.accountId, accountId))
        .orderBy(asc(notifications.id))
    ).map(({ accountId: _, ...n }) => n),
    pushSubscriptions: (
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId))
    ).map((p) => ({ service: new URL(p.endpoint).host, lang: p.lang, createdAt: p.createdAt })),
    family: await (async () => {
      const [member] = await db.select().from(familyMembers).where(eq(familyMembers.accountId, accountId));
      const [rules] = await db
        .select()
        .from(childRestrictions)
        .where(eq(childRestrictions.accountId, accountId));
      return {
        membership: member
          ? {
              familyId: member.familyId,
              role: member.role,
              joinedAt: member.joinedAt,
              confirmedAt: member.confirmedAt,
            }
          : null,
        restrictions: rules ? { settings: rules.settings, updatedAt: rules.updatedAt } : null,
        requests: (
          await db
            .select()
            .from(familyRequests)
            .where(eq(familyRequests.childId, accountId))
            .orderBy(asc(familyRequests.id))
        ).map(({ familyId: _, childId: __, ...r }) => r),
      };
    })(),
    auditLog: await db
      .select({ action: auditLog.action, target: auditLog.target, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(or(eq(auditLog.actorId, accountId), eq(auditLog.target, accountId))),
    // Capture posts, comments and likes: the account's own; others' posts are never in it.
    ...(await postsExport(db, accountId)),
    storage: storage ? await storage() : null,
  };
}

/** Deletes the accounts whose 14 days are over: everything of theirs goes with the row (the
 *  foreign keys cascade); what others keep (games they taught) loses the name. */
export async function purgeDeletedAccounts(
  ctx: { db: Database; valkey: Redis; files?: { forgetAccount(id: string): Promise<void> } | undefined },
  now = new Date(),
) {
  // Sign-in requests are of no use a while after they expired (they hold the address mailed).
  await ctx.db
    .delete(signInRequests)
    .where(lte(signInRequests.expiresAt, new Date(now.getTime() - signInRequestDays * 86_400_000)));
  const due = await ctx.db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(and(eq(accounts.status, "deleting"), lte(accounts.deleteAfter, now)));
  for (const { id, email } of due) {
    // Communities they own pass to their longest-serving moderator, or go when nobody is left.
    await handOverCommunities(ctx, undefined, id);
    const pairs = await ctx.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.userA, id), eq(friendships.userB, id)));
    const titles = (
      await ctx.db.select({ titleId: library.titleId }).from(library).where(eq(library.accountId, id))
    ).map((l) => l.titleId);
    const family = await ctx.db.transaction(async (tx) => {
      // A family they manage goes to the next one in it, or ends with no one left (unless they
      // signed in just now, keeping the account).
      const still = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, id), eq(accounts.status, "deleting")))
        .for("update");
      const family = still.length ? await familyAfterManager(tx, id, "purged") : null;
      // Their messages go too: emptied, so the others' threads keep their order.
      await tx
        .update(messages)
        .set({ text: null, attachments: [], deletedAt: now })
        .where(and(eq(messages.authorId, id), isNull(messages.deletedAt)));
      await tx.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.status, "deleting")));
      // The codes mailed to the address name it; they go with the account.
      if (email) await tx.delete(signInRequests).where(eq(signInRequests.email, email));
      await tx.insert(auditLog).values({ id: uuidv7(), action: "account.deleted", target: id });
      return family;
    });
    await tellFamily(ctx.valkey, family);
    const multi = ctx.valkey.multi();
    for (const pair of pairs) multi.srem(friendsKey(pair.userA === id ? pair.userB : pair.userA), id);
    await multi
      .del(
        friendsKey(id),
        presenceKey(id),
        presenceHiddenKey(id),
        presenceExtraKey(id),
        userEvents(id),
        deletionKey(id),
      )
      .exec();
    // Their cloud saves and media leave the file store (the hourly sweep catches any left).
    await ctx.files
      ?.forgetAccount(id)
      .catch((error) => console.error("could not delete files of", id, error));
    // One player fewer for every game they had.
    await refreshRarityOf(ctx.db, titles);
  }
  return due.length;
}

/** Tells the members of a family whose manager left to fetch their family status again. */
async function tellFamily(valkey: Redis, family: Awaited<ReturnType<typeof familyAfterManager>>) {
  for (const userId of family?.tell ?? [])
    await publish(valkey, userId, { type: "family.updated", data: { familyId: family?.familyId ?? null } });
}

/** The account itself: download everything, and delete it (a code by mail, then 14 days). */
export function accountRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const limit = rateLimiter(deps.valkey, deps.limits);
  const ctx = { db: deps.db, valkey: deps.valkey, tokens: deps.tokens };
  const mediaOf = mediaService(deps);

  app.get("/me/export", async (c) => {
    const me = c.get("userId");
    await limit("export", me);
    const data = await exportAccount(deps.db, me, () => mediaOf.exportFor(me));
    const day = new Date().toISOString().slice(0, 10);
    return c.body(JSON.stringify(data, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="anytogether-${data.profile?.handle ?? me}-${day}.json"`,
      "cache-control": "no-store",
    });
  });

  /** Mails the code that confirms deleting the account. An account without an email confirms with
   *  its handle instead. */
  app.post("/me/deletion", async (c) => {
    const me = c.get("userId");
    const [account] = await deps.db.select().from(accounts).where(eq(accounts.id, me));
    if (!account) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    if (!account.email) return c.json({ confirmWith: "handle" });
    await limit("deletionCode", me);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await deps.valkey.set(
      deletionKey(me),
      JSON.stringify({ hash: hash(code).toString("hex"), attempts: 0 }),
      "EX",
      codeLifetime,
    );
    try {
      await deps.mailer.deletionCode(account.email, code);
    } catch (error) {
      if (error instanceof MailError)
        throw new HttpError(
          503,
          ErrorCode.mailUnavailable,
          "The code could not be mailed; try again later",
          {},
          { "retry-after": "60" },
        );
      throw error;
    }
    return c.json({ confirmWith: "code" }, 202);
  });

  app.delete("/me", async (c) => {
    const me = c.get("userId");
    const input = await body(
      c,
      z.object({
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        handle: z.string().max(40).optional(),
      }),
    );
    const [account] = await deps.db.select().from(accounts).where(eq(accounts.id, me));
    const [profile] = await deps.db.select().from(profiles).where(eq(profiles.accountId, me));
    if (!account || !profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    if (account.email) {
      const kept = await deps.valkey.get(deletionKey(me));
      if (!kept) throw new HttpError(400, ErrorCode.codeExpired, "Ask for a new code first");
      const state = JSON.parse(kept) as { hash: string; attempts: number };
      const expected = Buffer.from(state.hash, "hex");
      const given = hash(input.code ?? "");
      if (!input.code || !timingSafeEqual(expected, given)) {
        if (state.attempts + 1 >= codeAttempts) await deps.valkey.del(deletionKey(me));
        else
          await deps.valkey.set(
            deletionKey(me),
            JSON.stringify({ ...state, attempts: state.attempts + 1 }),
            "KEEPTTL",
          );
        throw new HttpError(400, ErrorCode.codeInvalid, "That code is not right");
      }
      await deps.valkey.del(deletionKey(me));
    } else if ((input.handle ?? "").replace(/^@/, "").toLowerCase() !== profile.handle.toLowerCase()) {
      throw new HttpError(400, ErrorCode.codeInvalid, "Type your handle to confirm");
    }
    const deleteAfter = new Date(Date.now() + deletionGraceDays * 86_400_000);
    const family = await deps.db.transaction(async (tx) => {
      await tx.update(accounts).set({ status: "deleting", deleteAfter }).where(eq(accounts.id, me));
      await tx
        .insert(auditLog)
        .values({ id: uuidv7(), actorId: me, action: "account.deletion_requested", target: me });
      // A family they manage goes to the next one in it at once.
      return familyAfterManager(tx, me, "asked");
    });
    await tellFamily(deps.valkey, family);
    // Friends stop seeing the account at once; every device is signed out.
    await deps.valkey.del(presenceKey(me));
    await revokeAll(ctx, me);
    return c.json({ deleteAfter }, 202);
  });

  return app;
}
