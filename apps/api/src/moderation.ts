import {
  type Database,
  accounts,
  auditLog,
  bans,
  conversationMembers,
  lfgPosts,
  messages,
  profiles,
  reports,
  themes,
} from "@anytogether/db";
import { ErrorCode, ReportCreate, presenceKey } from "@anytogether/shared";
import { and, count, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { revokeAll } from "./account.js";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";
import { reviewIfReported } from "./themes.js";
import { hash } from "./tokens.js";

type Ctx = { db: Database; valkey: Redis };

export const emailHash = (email: string) => hash(email.trim().toLowerCase());
export const liveBan = () =>
  and(isNull(bans.liftedAt), or(isNull(bans.expiresAt), gt(bans.expiresAt, new Date())));

/** Whether a ban in force covers this account or this address. */
export async function isBanned(db: Database, who: { accountId?: string; email?: string | null }) {
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

export const bannedError = () =>
  new HttpError(403, ErrorCode.accountBanned, "This account is banned from AnyTogether");

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

/** Bans the account (and its email), or only an email that has no account. Every session ends at once. */
export async function ban(
  ctx: Ctx,
  who: string,
  options: { reason?: string; days?: number; by?: string; actorId?: string } = {},
) {
  const found = await findAccount(ctx.db, who);
  const email = found?.account.email ?? (who.includes("@") ? who.trim().toLowerCase() : null);
  if (!found && !email) throw new Error(`No account for ${who}`);
  const expiresAt = options.days ? new Date(Date.now() + options.days * 86_400_000) : null;
  await ctx.db.insert(bans).values({
    id: uuidv7(),
    accountId: found?.account.id ?? null,
    emailHash: email ? emailHash(email) : null,
    reason: options.reason ?? null,
    createdBy: options.by ?? null,
    expiresAt,
  });
  if (found) {
    await ctx.db.update(accounts).set({ status: "banned" }).where(eq(accounts.id, found.account.id));
    await ctx.valkey.del(presenceKey(found.account.id));
    await revokeAll(ctx, found.account.id);
  }
  await ctx.db.insert(auditLog).values({
    id: uuidv7(),
    actorId: options.actorId ?? null,
    action: "ban",
    target: found?.account.id ?? "email",
    data: { reason: options.reason ?? null, days: options.days ?? null, by: options.by ?? null },
  });
  return { accountId: found?.account.id ?? null, handle: found?.profile?.handle ?? null, expiresAt };
}

/** Lifts every ban on the account and its email. */
export async function unban(ctx: Ctx, who: string, by?: string, actorId?: string) {
  const found = await findAccount(ctx.db, who);
  const email = found?.account.email ?? (who.includes("@") ? who.trim().toLowerCase() : null);
  const matches = [
    ...(found ? [eq(bans.accountId, found.account.id)] : []),
    ...(email ? [eq(bans.emailHash, emailHash(email))] : []),
  ];
  if (!matches.length) throw new Error(`No account for ${who}`);
  const lifted = await ctx.db
    .update(bans)
    .set({ liftedAt: new Date() })
    .where(and(isNull(bans.liftedAt), or(...matches)))
    .returning({ id: bans.id });
  if (found?.account.status === "banned")
    await ctx.db.update(accounts).set({ status: "active" }).where(eq(accounts.id, found.account.id));
  await ctx.db.insert(auditLog).values({
    id: uuidv7(),
    actorId: actorId ?? null,
    action: "unban",
    target: found?.account.id ?? "email",
    data: { by: by ?? null },
  });
  return lifted.length;
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
