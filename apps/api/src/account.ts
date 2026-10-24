import { randomInt, timingSafeEqual } from "node:crypto";
import {
  type Database,
  accounts,
  activities,
  activityReactions,
  auditLog,
  avatars,
  blocks,
  conversationMembers,
  conversations,
  devices,
  earnedTrophies,
  friendships,
  games,
  handleHistory,
  identities,
  library,
  messages,
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
import { HttpError } from "./errors.js";
import { refreshRarityOf } from "./games.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
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

/** Everything held about the account, for "Download my data" (KVKK and GDPR). */
export async function exportAccount(db: Database, accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const [profile] = await db.select().from(profiles).where(eq(profiles.accountId, accountId));
  const [avatar] = await db.select().from(avatars).where(eq(avatars.accountId, accountId));
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
      privacy: privacyOf(profile.privacy),
      notificationSettings: notificationSettingsOf(profile.notificationSettings),
    },
    avatar: avatar ? `data:image/jpeg;base64,${Buffer.from(avatar.bytes).toString("base64")}` : null,
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
      muted: member.muted,
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
    auditLog: await db
      .select({ action: auditLog.action, target: auditLog.target, createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(or(eq(auditLog.actorId, accountId), eq(auditLog.target, accountId))),
  };
}

/** Deletes the accounts whose 14 days are over: everything of theirs goes with the row (the
 *  foreign keys cascade); what others keep (games they taught) loses the name. */
export async function purgeDeletedAccounts(ctx: { db: Database; valkey: Redis }, now = new Date()) {
  // Sign-in requests are of no use a while after they expired (they hold the address mailed).
  await ctx.db
    .delete(signInRequests)
    .where(lte(signInRequests.expiresAt, new Date(now.getTime() - signInRequestDays * 86_400_000)));
  const due = await ctx.db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(and(eq(accounts.status, "deleting"), lte(accounts.deleteAfter, now)));
  for (const { id, email } of due) {
    const pairs = await ctx.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.userA, id), eq(friendships.userB, id)));
    const titles = (
      await ctx.db.select({ titleId: library.titleId }).from(library).where(eq(library.accountId, id))
    ).map((l) => l.titleId);
    await ctx.db.transaction(async (tx) => {
      // Their messages go too: emptied, so the others' threads keep their order.
      await tx
        .update(messages)
        .set({ text: null, attachments: [], deletedAt: now })
        .where(and(eq(messages.authorId, id), isNull(messages.deletedAt)));
      await tx.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.status, "deleting")));
      // The codes mailed to the address name it; they go with the account.
      if (email) await tx.delete(signInRequests).where(eq(signInRequests.email, email));
      await tx.insert(auditLog).values({ id: uuidv7(), action: "account.deleted", target: id });
    });
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
    // One player fewer for every game they had.
    await refreshRarityOf(ctx.db, titles);
  }
  return due.length;
}

/** The account itself: download everything, and delete it (a code by mail, then 14 days). */
export function accountRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const limit = rateLimiter(deps.valkey, deps.limits);
  const ctx = { db: deps.db, valkey: deps.valkey, tokens: deps.tokens };

  app.get("/me/export", async (c) => {
    const me = c.get("userId");
    await limit("export", me);
    const data = await exportAccount(deps.db, me);
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
    await deps.mailer.deletionCode(account.email, code);
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
    await deps.db.update(accounts).set({ status: "deleting", deleteAfter }).where(eq(accounts.id, me));
    await deps.db
      .insert(auditLog)
      .values({ id: uuidv7(), actorId: me, action: "account.deletion_requested", target: me });
    // Friends stop seeing the account at once; every device is signed out.
    await deps.valkey.del(presenceKey(me));
    await revokeAll(ctx, me);
    return c.json({ deleteAfter }, 202);
  });

  return app;
}
