import {
  accounts,
  auditLog,
  avatars,
  bans,
  conversationMembers,
  lfgPosts,
  messages,
  profiles,
  reports,
  sessions,
} from "@anytogether/db";
import { AdminBan, ErrorCode, ReportVerdict } from "@anytogether/shared";
import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { lfgService } from "./lfg.js";
import { messageView } from "./messages.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { ban, emailHash, handleReport, liveBan } from "./moderation.js";
import type { Notifier } from "./notifications.js";
import { people } from "./people.js";

type AdminVariables = AuthVariables & { adminHandle: string };
type Report = typeof reports.$inferSelect;
type Ban = typeof bans.$inferSelect;
type AccountRow = { account: typeof accounts.$inferSelect; profile: typeof profiles.$inferSelect | null };

const Id = z.string().uuid();
const isId = (value: string | undefined) => Id.safeParse(value).success;
const page = (raw: string | undefined, max = 50) => Math.min(max, Math.max(1, Number(raw ?? 30) || 30));
const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Only an account whose role is admin, looked up on every request (a revoked admin is refused at
 *  once, whatever the page they have open shows). */
function requireAdmin(deps: Deps): MiddlewareHandler<{ Variables: AdminVariables }> {
  return async (c, next) => {
    const [row] = await deps.db
      .select({ role: accounts.role, status: accounts.status, handle: profiles.handle })
      .from(accounts)
      .leftJoin(profiles, eq(profiles.accountId, accounts.id))
      .where(eq(accounts.id, c.get("userId")));
    if (row?.role !== "admin" || row.status !== "active")
      throw new HttpError(403, ErrorCode.forbidden, "Admins only");
    c.set("adminHandle", row.handle ?? "admin");
    await next();
  };
}

/** The admin page's API: the reports queue and what to do about a report, finding an account,
 *  bans and lifting them, and the audit log. Every change is written to the audit log with the
 *  admin who made it. */
export function adminRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AdminVariables }>();
  app.use("/admin/*", requireUser(deps));
  app.use("/admin/*", requireAdmin(deps));
  const { db, valkey } = deps;
  const who = people(db);
  const board = lfgService(deps, notes);

  const audit = (
    c: { get: (key: "userId" | "adminHandle") => string },
    action: string,
    target: string,
    data: Record<string, unknown> = {},
  ) =>
    db.insert(auditLog).values({
      id: uuidv7(),
      actorId: c.get("userId"),
      action,
      target,
      data: { by: c.get("adminHandle"), ...data },
    });

  /** The account a report is about: the reported person, or the reported message's author. */
  const subjectOf = (r: Report) =>
    r.targetKind === "user" ? r.targetId : ((r.snapshot as { authorId?: string } | null)?.authorId ?? null);

  const accountRows = async (ids: string[]) => {
    const valid = [...new Set(ids)].filter(isId);
    if (!valid.length) return new Map<string, AccountRow>();
    const rows = await db
      .select({ account: accounts, profile: profiles })
      .from(accounts)
      .leftJoin(profiles, eq(profiles.accountId, accounts.id))
      .where(inArray(accounts.id, valid));
    return new Map<string, AccountRow>(rows.map((r) => [r.account.id, r]));
  };

  const personView = (row: AccountRow) => ({
    userId: row.account.id,
    handle: row.profile?.handle ?? null,
    displayName: row.profile?.displayName ?? null,
    avatar: row.profile?.avatarUrl ?? null,
    bio: row.profile?.bio ?? null,
    role: row.account.role,
    status: row.account.status,
  });

  const reportViews = async (rows: Report[]) => {
    const people = await accountRows(rows.flatMap((r) => [r.reporterId ?? "", subjectOf(r) ?? ""]));
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
    const messageIds = rows
      .filter((r) => r.targetKind === "message" && isId(r.targetId))
      .map((r) => r.targetId);
    const postIds = rows.filter((r) => r.targetKind === "lfg" && isId(r.targetId)).map((r) => r.targetId);
    const removedPosts = new Set(
      postIds.length
        ? (
            await db
              .select({ id: lfgPosts.id })
              .from(lfgPosts)
              .where(and(inArray(lfgPosts.id, postIds), eq(lfgPosts.status, "removed")))
          ).map((p) => p.id)
        : [],
    );
    const removed = new Set(
      messageIds.length
        ? (
            await db
              .select({ id: messages.id, deletedAt: messages.deletedAt })
              .from(messages)
              .where(inArray(messages.id, messageIds))
          )
            .filter((m) => m.deletedAt)
            .map((m) => m.id)
        : [],
    );
    return rows.map((r) => {
      const reporter = r.reporterId ? people.get(r.reporterId) : undefined;
      const subject = people.get(subjectOf(r) ?? "");
      const snapshot = (r.snapshot ?? null) as {
        text?: string;
        createdAt?: string;
        note?: string | null;
        titleId?: string;
        purpose?: string;
      } | null;
      return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        note: r.note,
        targetKind: r.targetKind,
        targetId: r.targetId,
        message:
          r.targetKind === "message"
            ? {
                text: snapshot?.text ?? null,
                sentAt: snapshot?.createdAt ?? null,
                removed: removed.has(r.targetId),
              }
            : null,
        post:
          r.targetKind === "lfg"
            ? {
                note: snapshot?.note ?? null,
                titleId: snapshot?.titleId ?? null,
                purpose: snapshot?.purpose ?? null,
                postedAt: snapshot?.createdAt ?? null,
                removed: removedPosts.has(r.targetId),
              }
            : null,
        reporter: reporter ? personView(reporter) : null,
        target: subject ? personView(subject) : null,
        timesReported: totals.get(r.targetId) ?? 1,
        handledBy: r.handledBy,
        handledAt: iso(r.handledAt),
        createdAt: r.createdAt.toISOString(),
      };
    });
  };

  /** The reports queue: open ones by default, newest first, 30 a page (before = the last ID). */
  app.get("/admin/reports", async (c) => {
    const status = c.req.query("status") ?? "open";
    if (!["open", "actioned", "dismissed", "all"].includes(status))
      throw new HttpError(400, ErrorCode.badRequest, "status: open, actioned, dismissed or all");
    const before = c.req.query("before");
    const limit = page(c.req.query("limit"));
    const rows = await db
      .select()
      .from(reports)
      .where(
        and(
          status === "all" ? undefined : eq(reports.status, status),
          isId(before) ? lt(reports.id, before as string) : undefined,
        ),
      )
      .orderBy(desc(reports.id))
      .limit(limit + 1);
    const [open] = await db.select({ n: count() }).from(reports).where(eq(reports.status, "open"));
    return c.json({
      reports: await reportViews(rows.slice(0, limit)),
      more: rows.length > limit,
      open: open?.n ?? 0,
    });
  });

  /** Does what the moderator chose about a report, closes it (and, for an action, every other open
   *  report on the same person or message) and audits it. */
  app.post("/admin/reports/:id", async (c) => {
    const id = c.req.param("id");
    const [report] = isId(id) ? await db.select().from(reports).where(eq(reports.id, id)) : [];
    if (!report) throw new HttpError(404, ErrorCode.notFound, "No such report");
    const input = await body(c, ReportVerdict);
    const by = c.get("adminHandle");
    const actorId = c.get("userId");
    const subject = subjectOf(report);

    if (input.action === "dismiss") {
      await handleReport(db, report.id, "dismissed", by, actorId);
      const [view] = await reportViews([
        { ...report, status: "dismissed", handledBy: by, handledAt: new Date() },
      ]);
      return c.json({ report: view, closed: 1 });
    }
    if (!subject) throw new HttpError(409, ErrorCode.conflict, "The reported account is gone");
    const [target] = await db.select().from(accounts).where(eq(accounts.id, subject));
    if (!target) throw new HttpError(409, ErrorCode.conflict, "The reported account is gone");

    switch (input.action) {
      case "warn": {
        const reason = input.reason ?? report.reason;
        await notes.notify(subject, { kind: "warning", subjectId: report.id, data: { reason } });
        await audit(c, "warn", subject, { reason, report: report.id });
        break;
      }
      case "ban": {
        if (target.role === "admin")
          throw new HttpError(409, ErrorCode.conflict, "Revoke their admin role first");
        await ban({ db, valkey }, subject, {
          reason: input.reason ?? report.reason,
          days: input.days ?? undefined,
          by,
          actorId,
        });
        break;
      }
      case "remove_message": {
        if (report.targetKind !== "message")
          throw new HttpError(400, ErrorCode.badRequest, "Only a reported message can be removed");
        const [removed] = await db
          .update(messages)
          .set({ text: null, attachments: [], deletedAt: new Date() })
          .where(and(eq(messages.id, report.targetId), isNull(messages.deletedAt)))
          .returning();
        if (removed) {
          const members = await db
            .select({ id: conversationMembers.accountId })
            .from(conversationMembers)
            .where(eq(conversationMembers.conversationId, removed.conversationId));
          for (const member of members)
            await publish(valkey, member.id, { type: "message.deleted", data: messageView(removed) });
        }
        await audit(c, "message.removed", report.targetId, { author: subject, report: report.id });
        break;
      }
      case "reset_avatar": {
        await db.update(profiles).set({ avatarUrl: null }).where(eq(profiles.accountId, subject));
        await db.delete(avatars).where(eq(avatars.accountId, subject));
        await audit(c, "profile.avatar_reset", subject, { report: report.id });
        break;
      }
      case "remove_post": {
        if (report.targetKind !== "lfg")
          throw new HttpError(400, ErrorCode.badRequest, "Only a reported post can be removed");
        const [post] = await db.select().from(lfgPosts).where(eq(lfgPosts.id, report.targetId));
        if (post) await board.close(post, "removed");
        await audit(c, "lfg.removed", report.targetId, { author: subject, report: report.id });
        break;
      }
      case "reset_bio": {
        await db.update(profiles).set({ bio: null }).where(eq(profiles.accountId, subject));
        await audit(c, "profile.bio_reset", subject, { report: report.id });
        break;
      }
    }

    // Every open report on the same thing is answered by this action.
    const others = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.status, "open"),
          or(
            eq(reports.id, report.id),
            and(eq(reports.targetKind, report.targetKind), eq(reports.targetId, report.targetId)),
          ),
        ),
      );
    for (const other of others) await handleReport(db, other.id, "actioned", by, actorId);
    const [fresh] = await db.select().from(reports).where(eq(reports.id, report.id));
    const [view] = await reportViews([fresh as Report]);
    return c.json({ report: view, closed: others.length });
  });

  /** Takes a looking-for-group post off the board without a report. */
  app.post("/admin/lfg/:id/remove", async (c) => {
    const id = c.req.param("id");
    const [post] = isId(id) ? await db.select().from(lfgPosts).where(eq(lfgPosts.id, id)) : [];
    if (!post) throw new HttpError(404, ErrorCode.notFound, "No such post");
    await board.close(post, "removed");
    await audit(c, "lfg.removed", post.id, { author: post.authorId });
    return c.body(null, 204);
  });

  const banViews = async (rows: Ban[]) => {
    const people = await accountRows(rows.flatMap((b) => (b.accountId ? [b.accountId] : [])));
    const now = Date.now();
    return rows.map((b) => {
      const person = b.accountId ? people.get(b.accountId) : undefined;
      return {
        id: b.id,
        account: person ? personView(person) : null,
        emailOnly: !b.accountId,
        reason: b.reason,
        createdBy: b.createdBy,
        createdAt: b.createdAt.toISOString(),
        expiresAt: iso(b.expiresAt),
        liftedAt: iso(b.liftedAt),
        live: !b.liftedAt && (!b.expiresAt || b.expiresAt.getTime() > now),
      };
    });
  };

  /** An account by @handle, email (its SHA-256 also finds bans on an address with no account) or
   *  ID: its sessions, bans and reports. */
  app.get("/admin/users", async (c) => {
    const term = (c.req.query("q") ?? "").trim().replace(/^@/, "");
    if (term.length < 2) throw new HttpError(400, ErrorCode.badRequest, "q: a handle, email or ID");
    const email = term.includes("@") ? term.toLowerCase() : null;
    const [found] = await db
      .select({ account: accounts, profile: profiles })
      .from(accounts)
      .leftJoin(profiles, eq(profiles.accountId, accounts.id))
      .where(
        isId(term) ? eq(accounts.id, term) : email ? eq(accounts.email, email) : eq(profiles.handle, term),
      );
    const hashes = [email ?? found?.account.email].filter((e): e is string => Boolean(e)).map(emailHash);
    const banRows = await db
      .select()
      .from(bans)
      .where(
        or(
          ...(found ? [eq(bans.accountId, found.account.id)] : []),
          ...hashes.map((h) => eq(bans.emailHash, h)),
          ...(!found && !hashes.length ? [eq(bans.id, uuidv7())] : []),
        ),
      )
      .orderBy(desc(bans.createdAt));
    await audit(c, "admin.lookup", found?.account.id ?? (email ? "email" : term));
    if (!found) return c.json({ user: null, bans: await banViews(banRows) });
    const id = found.account.id;
    const signIns = await db
      .select()
      .from(sessions)
      .where(eq(sessions.accountId, id))
      .orderBy(desc(sessions.createdAt))
      .limit(50);
    const [against] = await db
      .select({ n: count() })
      .from(reports)
      .where(or(and(eq(reports.targetKind, "user"), eq(reports.targetId, id))));
    const [made] = await db.select({ n: count() }).from(reports).where(eq(reports.reporterId, id));
    return c.json({
      user: {
        ...personView(found),
        email: found.account.email,
        createdAt: found.account.createdAt.toISOString(),
        deleteAfter: iso(found.account.deleteAfter),
        reportsAgainst: against?.n ?? 0,
        reportsMade: made?.n ?? 0,
      },
      sessions: signIns.map((s) => ({
        id: s.id,
        client: s.client,
        deviceName: s.deviceName,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: iso(s.lastSeenAt),
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: iso(s.revokedAt),
      })),
      bans: await banViews(banRows),
    });
  });

  app.post("/admin/users/:id/ban", async (c) => {
    const id = c.req.param("id");
    const input = await body(c, AdminBan);
    const [target] = isId(id) ? await db.select().from(accounts).where(eq(accounts.id, id)) : [];
    if (!target) throw new HttpError(404, ErrorCode.notFound, "No such account");
    if (target.role === "admin")
      throw new HttpError(409, ErrorCode.conflict, "Revoke their admin role first");
    const done = await ban({ db, valkey }, id, {
      reason: input.reason,
      days: input.days ?? undefined,
      by: c.get("adminHandle"),
      actorId: c.get("userId"),
    });
    return c.json({ expiresAt: iso(done.expiresAt) }, 201);
  });

  /** Bans, the ones in force first by default (all=1 for every one), newest first. */
  app.get("/admin/bans", async (c) => {
    const all = c.req.query("all") === "1";
    const before = c.req.query("before");
    const limit = page(c.req.query("limit"));
    const rows = await db
      .select()
      .from(bans)
      .where(and(all ? undefined : liveBan(), isId(before) ? lt(bans.id, before as string) : undefined))
      .orderBy(desc(bans.id))
      .limit(limit + 1);
    return c.json({ bans: await banViews(rows.slice(0, limit)), more: rows.length > limit });
  });

  /** Lifts one ban; with no other ban in force the account is active again. */
  app.post("/admin/bans/:id/lift", async (c) => {
    const id = c.req.param("id");
    const [lifted] = isId(id)
      ? await db
          .update(bans)
          .set({ liftedAt: new Date() })
          .where(and(eq(bans.id, id), isNull(bans.liftedAt)))
          .returning()
      : [];
    if (!lifted) throw new HttpError(404, ErrorCode.notFound, "No such ban in force");
    if (lifted.accountId) {
      const [account] = await db.select().from(accounts).where(eq(accounts.id, lifted.accountId));
      const matches = [
        eq(bans.accountId, lifted.accountId),
        ...(account?.email ? [eq(bans.emailHash, emailHash(account.email))] : []),
      ];
      const still = await db
        .select({ id: bans.id })
        .from(bans)
        .where(and(liveBan(), or(...matches)))
        .limit(1);
      if (!still.length && account?.status === "banned")
        await db.update(accounts).set({ status: "active" }).where(eq(accounts.id, account.id));
    }
    await audit(c, "unban", lifted.accountId ?? "email", { ban: lifted.id });
    const [view] = await banViews([lifted]);
    return c.json({ ban: view });
  });

  /** The audit log, newest first, 50 a page (before = the last ID). */
  app.get("/admin/audit", async (c) => {
    const before = c.req.query("before");
    const limit = page(c.req.query("limit") ?? "50", 100);
    const rows = await db
      .select()
      .from(auditLog)
      .where(isId(before) ? lt(auditLog.id, before as string) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const shown = rows.slice(0, limit);
    const cards = await who.cards(
      shown.flatMap((r) => [r.actorId ?? "", isId(r.target ?? "") ? (r.target as string) : ""]).filter(isId),
    );
    return c.json({
      entries: shown.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actorId ? (cards.get(r.actorId) ?? null) : null,
        target: r.target,
        targetUser: r.target ? (cards.get(r.target) ?? null) : null,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
      })),
      more: rows.length > limit,
    });
  });

  return app;
}
