import {
  type Database,
  accounts,
  appeals,
  auditLog,
  bans,
  conversationMembers,
  lfgPosts,
  messages,
  profiles,
  reports,
  themes,
} from "@anytogether/db";
import {
  type AppealView,
  ErrorCode,
  ReportCreate,
  type RestrictedAction,
  type Restriction,
  presenceKey,
} from "@anytogether/shared";
import { and, asc, count, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { revokeAll } from "./account.js";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { mediaService } from "./media.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";
import { reviewIfReported } from "./themes.js";
import { type TokenSigner, appealLifetime, hash } from "./tokens.js";

type Ctx = { db: Database; valkey: Redis };

export const emailHash = (email: string) => hash(email.trim().toLowerCase());
/** A restriction in force: not lifted, not run out. */
export const liveRestriction = () =>
  and(isNull(bans.liftedAt), or(isNull(bans.expiresAt), gt(bans.expiresAt, new Date())));
/** A ban (not a mute) in force. */
export const liveBan = () => and(eq(bans.kind, "ban"), liveRestriction());

type BanRow = typeof bans.$inferSelect;
const mutedActions: RestrictedAction[] = ["messages", "posts", "friend_requests", "profile", "themes"];

/** A restriction as the person sees it (never the moderators' own note). */
export function restrictionView(row: BanRow, appealable: boolean): Restriction {
  return {
    id: row.id,
    kind: row.kind === "mute" ? "muted" : row.expiresAt ? "suspended" : "banned",
    restricts: row.kind === "mute" ? mutedActions : ["sign_in"],
    reason: row.publicReason,
    since: row.createdAt.toISOString(),
    until: row.expiresAt ? row.expiresAt.toISOString() : null,
    appealable,
  };
}

/** Whether a ban in force covers this account or this address. */
export async function isBanned(
  db: Pick<Database, "select">,
  who: { accountId?: string; email?: string | null },
) {
  const matches = [
    ...(who.accountId ? [eq(bans.accountId, who.accountId)] : []),
    ...(who.email ? [eq(bans.emailHash, emailHash(who.email))] : []),
  ];
  if (!matches.length) return false;
  const found = await db
    .select({ id: bans.id })
    .from(bans)
    .where(and(liveBan(), or(...matches)))
    .limit(1);
  return found.length > 0;
}

/** The restrictions in force on an account (bans on its address too), bans first, and its newest
 *  appeal. */
export async function restrictionsOf(db: Pick<Database, "select">, accountId: string) {
  const [account] = await db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  const rows = await db
    .select()
    .from(bans)
    .where(
      and(
        liveRestriction(),
        or(
          eq(bans.accountId, accountId),
          ...(account?.email
            ? [and(eq(bans.kind, "ban"), eq(bans.emailHash, emailHash(account.email)))]
            : []),
        ),
      ),
    )
    .orderBy(asc(bans.kind), desc(bans.createdAt));
  const [appeal] = await db
    .select()
    .from(appeals)
    .where(eq(appeals.accountId, accountId))
    .orderBy(desc(appeals.createdAt))
    .limit(1);
  const open = appeal?.status === "open";
  return {
    restrictions: rows.map((row) => restrictionView(row, !open)),
    appeal: appeal ? appealView(appeal) : null,
  };
}

export const appealView = (row: typeof appeals.$inferSelect): AppealView => ({
  id: row.id,
  restrictionId: row.banId,
  status: row.status as AppealView["status"],
  text: row.text,
  reply: row.reply,
  createdAt: row.createdAt.toISOString(),
  answeredAt: row.handledAt ? row.handledAt.toISOString() : null,
});

export const bannedError = (extra: Record<string, unknown> = {}) =>
  new HttpError(403, ErrorCode.accountBanned, "This account is banned from AnyTogether", extra);

/** The refusal for a banned account that just proved who it is (a code, a provider, a passkey):
 *  what is restricted, why and until when, and an appeal token for GET /me/restrictions and
 *  POST /me/appeals. */
export async function restrictedSignIn(
  ctx: { db: Database; tokens: Pick<TokenSigner, "signAppeal"> },
  accountId: string,
) {
  const { restrictions } = await restrictionsOf(ctx.db, accountId);
  const restriction = restrictions.find((r) => r.kind !== "muted");
  return bannedError({
    ...(restriction ? { restriction } : {}),
    appealToken: await ctx.tokens.signAppeal(accountId),
    appealTokenExpiresIn: appealLifetime,
  });
}

/** Refuses with 403 account_muted while the account is muted. */
export async function assertNotMuted(db: Pick<Database, "select">, accountId: string) {
  const [row] = await db
    .select()
    .from(bans)
    .where(and(eq(bans.kind, "mute"), eq(bans.accountId, accountId), liveRestriction()))
    .orderBy(desc(bans.createdAt))
    .limit(1);
  if (!row) return;
  const open = await db
    .select({ id: appeals.id })
    .from(appeals)
    .where(and(eq(appeals.accountId, accountId), eq(appeals.status, "open")));
  throw new HttpError(403, ErrorCode.accountMuted, "This account is muted for now", {
    restriction: restrictionView(row, !open.length),
  });
}

/** An account by @handle, email or ID, for the moderators' tools. */
export async function findAccount(db: Database, who: string) {
  const term = who.trim().replace(/^@/, "");
  const byId = /^[0-9a-f-]{36}$/i.test(term);
  const [row] = await db
    .select({ account: accounts, profile: profiles })
    .from(accounts)
    .leftJoin(profiles, eq(profiles.accountId, accounts.id))
    .where(
      byId
        ? eq(accounts.id, term)
        : term.includes("@")
          ? eq(accounts.email, term)
          : eq(profiles.handle, term),
    );
  return row;
}

interface RestrictOptions {
  /** The moderators' own note. */
  reason?: string | undefined;
  /** What the person is told. */
  publicReason?: string | undefined;
  days?: number | undefined;
  by?: string | undefined;
  actorId?: string | undefined;
}

/** Bans the account (and its email), or only an email that has no account. Every session ends at once. */
export async function ban(ctx: Ctx, who: string, options: RestrictOptions = {}) {
  return restrict(ctx, who, "ban", options);
}

/** Mutes an account: it signs in and plays, but writes to no one until it runs out or is lifted. */
export async function mute(ctx: Ctx, who: string, options: RestrictOptions = {}) {
  return restrict(ctx, who, "mute", options);
}

async function restrict(ctx: Ctx, who: string, kind: "ban" | "mute", options: RestrictOptions) {
  const found = await findAccount(ctx.db, who);
  const email =
    kind === "ban" ? (found?.account.email ?? (who.includes("@") ? who.trim().toLowerCase() : null)) : null;
  if (!found && !email) throw new Error(`No account for ${who}`);
  const expiresAt = options.days ? new Date(Date.now() + options.days * 86_400_000) : null;
  const [row] = await ctx.db
    .insert(bans)
    .values({
      id: uuidv7(),
      kind,
      accountId: found?.account.id ?? null,
      emailHash: email ? emailHash(email) : null,
      reason: options.reason ?? null,
      publicReason: options.publicReason ?? null,
      createdBy: options.by ?? null,
      expiresAt,
    })
    .returning();
  if (found && row) {
    // Told first: a ban then signs every device out, and their sockets close.
    await publish(ctx.valkey, found.account.id, {
      type: "account.restricted",
      data: restrictionView(row, true),
    });
    if (kind === "ban") {
      await ctx.db.update(accounts).set({ status: "banned" }).where(eq(accounts.id, found.account.id));
      await ctx.valkey.del(presenceKey(found.account.id));
      await revokeAll(ctx, found.account.id);
    }
  }
  await ctx.db.insert(auditLog).values({
    id: uuidv7(),
    actorId: options.actorId ?? null,
    action: kind,
    target: found?.account.id ?? "email",
    data: {
      reason: options.reason ?? null,
      publicReason: options.publicReason ?? null,
      days: options.days ?? null,
      by: options.by ?? null,
    },
  });
  return {
    id: row?.id ?? null,
    accountId: found?.account.id ?? null,
    handle: found?.profile?.handle ?? null,
    expiresAt,
  };
}

/** Lifts one restriction; with no ban left in force a banned account is active again. The person
 *  is told (account.restored). Null when there is no such restriction in force. */
export async function liftRestriction(ctx: Ctx, id: string) {
  const [lifted] = await ctx.db
    .update(bans)
    .set({ liftedAt: new Date() })
    .where(and(eq(bans.id, id), isNull(bans.liftedAt)))
    .returning();
  if (!lifted) return null;
  if (lifted.accountId) {
    if (lifted.kind === "ban") await liftExpired(ctx.db, lifted.accountId);
    await publish(ctx.valkey, lifted.accountId, {
      type: "account.restored",
      data: { id: lifted.id, kind: restrictionView(lifted, false).kind },
    });
  }
  return lifted;
}

/** Lifts every ban (or every mute) on the account and its email. */
export async function unban(
  ctx: Ctx,
  who: string,
  by?: string,
  actorId?: string,
  kind: "ban" | "mute" = "ban",
) {
  const found = await findAccount(ctx.db, who);
  const email = found?.account.email ?? (who.includes("@") ? who.trim().toLowerCase() : null);
  const matches = [
    ...(found ? [eq(bans.accountId, found.account.id)] : []),
    ...(email && kind === "ban" ? [eq(bans.emailHash, emailHash(email))] : []),
  ];
  if (!matches.length) throw new Error(`No account for ${who}`);
  const live = await ctx.db
    .select({ id: bans.id })
    .from(bans)
    .where(and(eq(bans.kind, kind), isNull(bans.liftedAt), or(...matches)));
  for (const { id } of live) await liftRestriction(ctx, id);
  if (kind === "ban" && found?.account.status === "banned")
    await ctx.db.update(accounts).set({ status: "active" }).where(eq(accounts.id, found.account.id));
  await ctx.db.insert(auditLog).values({
    id: uuidv7(),
    actorId: actorId ?? null,
    action: kind === "ban" ? "unban" : "unmute",
    target: found?.account.id ?? "email",
    data: { by: by ?? null },
  });
  return live.length;
}

/** A ban that ran out lifts itself at the next sign-in. */
export async function liftExpired(db: Database, accountId: string) {
  if (await isBanned(db, { accountId })) return false;
  await db
    .update(accounts)
    .set({ status: "active" })
    .where(and(eq(accounts.id, accountId), eq(accounts.status, "banned")));
  return true;
}

/** Open reports (or all), newest first, with who reported whom and how often the target was reported. */
export async function listReports(db: Database, all = false, limit = 50) {
  const rows = await db
    .select()
    .from(reports)
    .where(all ? undefined : eq(reports.status, "open"))
    .orderBy(desc(reports.createdAt))
    .limit(limit);
  // A message's author, or a theme's maker, as the report's snapshot keeps them.
  const authorOf = (r: (typeof rows)[number]) =>
    r.targetKind !== "user" ? ((r.snapshot as { authorId?: string } | null)?.authorId ?? null) : null;
  const people = [
    ...new Set(rows.flatMap((r) => [r.reporterId, r.targetKind === "user" ? r.targetId : authorOf(r)])),
  ].filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id)));
  const handles = new Map(
    people.length
      ? (
          await db
            .select({ id: profiles.accountId, handle: profiles.handle })
            .from(profiles)
            .where(inArray(profiles.accountId, people))
        ).map((p) => [p.id, p.handle])
      : [],
  );
  const totals = new Map(
    rows.length
      ? (
          await db
            .select({ targetId: reports.targetId, n: count() })
            .from(reports)
            .where(
              inArray(
                reports.targetId,
                rows.map((r) => r.targetId),
              ),
            )
            .groupBy(reports.targetId)
        ).map((t) => [t.targetId, t.n])
      : [],
  );
  return rows.map((r) => ({
    ...r,
    reporter: r.reporterId ? (handles.get(r.reporterId) ?? null) : null,
    target:
      r.targetKind === "user" ? (handles.get(r.targetId) ?? null) : (handles.get(authorOf(r) ?? "") ?? null),
    timesReported: totals.get(r.targetId) ?? 1,
  }));
}

export async function handleReport(
  db: Database,
  id: string,
  verdict: "actioned" | "dismissed",
  by?: string,
  actorId?: string,
) {
  const [row] = await db
    .update(reports)
    .set({ status: verdict, handledBy: by ?? "admin", handledAt: new Date() })
    .where(eq(reports.id, id))
    .returning({ id: reports.id });
  if (!row) throw new Error(`No report ${id}`);
  await db.insert(auditLog).values({
    id: uuidv7(),
    actorId: actorId ?? null,
    action: `report.${verdict}`,
    target: id,
    data: { by },
  });
}

/** POST /reports: a user reports someone (later a message or more) to the moderators. */
export function reportRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const limit = rateLimiter(deps.valkey, deps.limits);
  const mediaOf = mediaService(deps);

  app.post("/reports", async (c) => {
    const me = c.get("userId");
    const input = await body(c, ReportCreate);
    await limit("report", me);
    if (input.targetKind === "user") {
      if (input.targetId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
      const target = /^[0-9a-f-]{36}$/i.test(input.targetId)
        ? await deps.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.targetId))
        : [];
      if (!target[0]) throw new HttpError(404, ErrorCode.notFound, "No such user");
    }
    // A message: only someone in its conversation can report it, and not its author; what it
    // said is kept with the report.
    let snapshot: Record<string, unknown> | null = null;
    if (input.targetKind === "message") {
      const [found] = /^[0-9a-f-]{36}$/i.test(input.targetId)
        ? await deps.db
            .select({ message: messages })
            .from(messages)
            .innerJoin(
              conversationMembers,
              and(
                eq(conversationMembers.conversationId, messages.conversationId),
                eq(conversationMembers.accountId, me),
              ),
            )
            .where(eq(messages.id, input.targetId))
        : [];
      if (!found || found.message.deletedAt) throw new HttpError(404, ErrorCode.notFound, "No such message");
      if (found.message.authorId === me) throw new HttpError(400, ErrorCode.badRequest, "That is yours");
      snapshot = {
        authorId: found.message.authorId,
        conversationId: found.message.conversationId,
        seq: found.message.seq,
        text: found.message.text,
        attachments: found.message.attachments,
        createdAt: found.message.createdAt,
      };
    }
    // A theme: anyone signed in but its maker; its name and version are kept with the report.
    if (input.targetKind === "theme") {
      const [found] = /^[0-9a-f-]{36}$/i.test(input.targetId)
        ? await deps.db.select().from(themes).where(eq(themes.id, input.targetId))
        : [];
      if (!found || found.status === "hidden") throw new HttpError(404, ErrorCode.notFound, "No such theme");
      if (found.makerId === me) throw new HttpError(400, ErrorCode.badRequest, "That is yours");
      snapshot = { authorId: found.makerId, name: found.name, version: found.version };
    }
    // A looking-for-group post: anyone who can see it but its poster; what it said is kept.
    if (input.targetKind === "lfg") {
      const [found] = /^[0-9a-f-]{36}$/i.test(input.targetId)
        ? await deps.db.select().from(lfgPosts).where(eq(lfgPosts.id, input.targetId))
        : [];
      if (!found || found.status === "removed") throw new HttpError(404, ErrorCode.notFound, "No such post");
      if (found.authorId === me) throw new HttpError(400, ErrorCode.badRequest, "That is yours");
      snapshot = {
        authorId: found.authorId,
        titleId: found.titleId,
        purpose: found.purpose,
        languages: found.languages,
        note: found.note,
        createdAt: found.createdAt,
      };
    }
    // Media: anyone who can see it but its owner; what it is (not its bytes) is kept.
    if (input.targetKind === "media") {
      const found = await mediaOf.find(deps.db, input.targetId);
      if (!found || !(await mediaOf.canView(me, found)))
        throw new HttpError(404, ErrorCode.notFound, "No such media");
      if (found.accountId === me) throw new HttpError(400, ErrorCode.badRequest, "That is yours");
      snapshot = {
        authorId: found.accountId,
        kind: found.kind,
        sha256: found.sha256,
        createdAt: found.createdAt,
      };
    }
    // One open report per person and target: a second one adds nothing for the moderators.
    const [made] = await deps.db
      .insert(reports)
      .values({
        id: uuidv7(),
        reporterId: me,
        targetKind: input.targetKind,
        targetId: input.targetId,
        reason: input.reason,
        note: input.note || null,
        snapshot,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (made && input.targetKind === "theme") await reviewIfReported(deps.db, input.targetId);
    return c.json({ received: true }, made ? 201 : 200);
  });

  return app;
}
