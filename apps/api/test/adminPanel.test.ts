import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
type User = Awaited<ReturnType<typeof h.user>>;
const cli = (...args: string[]) => run(args, h.deps);

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** An admin, a reporter and a troll who sent the reporter a message, with both reported. */
async function scene() {
  const boss = await h.user("boss@example.com");
  const utku = await h.user("utku@example.com");
  const troll = await h.user("troll@example.com");
  await befriend(troll, utku);
  const conversation = (await h.call("POST", `${v1}/conversations`, { members: [utku.id] }, troll.token)).body
    .id;
  const sent = await h.call(
    "POST",
    `${v1}/conversations/${conversation}/messages`,
    { clientId: crypto.randomUUID(), text: "free gems at my profile" },
    troll.token,
  );
  await h.call(
    "POST",
    `${v1}/reports`,
    { targetKind: "user", targetId: troll.id, reason: "spam", note: "links" },
    utku.token,
  );
  await h.call(
    "POST",
    `${v1}/reports`,
    { targetKind: "message", targetId: sent.body.id, reason: "spam" },
    utku.token,
  );
  expect(await cli("grant", "@boss")).toBe("@boss is an admin now; the admin page is at /admin");
  return { boss, utku, troll, conversation, message: sent.body };
}

const queue = (token: string, query = "") => h.call("GET", `${v1}/admin/reports${query}`, undefined, token);
const act = (token: string, id: string, input: Record<string, unknown>) =>
  h.call("POST", `${v1}/admin/reports/${id}`, input, token);

describe("admin page", () => {
  it("refuses everyone but admins on every route, and a revoked admin at once", async () => {
    h = await harness();
    const { boss, utku } = await scene();
    const routes: [string, string, unknown?][] = [
      ["GET", "/admin/reports"],
      ["POST", `/admin/reports/${crypto.randomUUID()}`, { action: "dismiss" }],
      ["GET", "/admin/users?q=troll"],
      ["POST", `/admin/users/${boss.id}/ban`, {}],
      ["GET", "/admin/bans"],
      ["POST", `/admin/bans/${crypto.randomUUID()}/lift`, {}],
      ["GET", "/admin/audit"],
    ];
    for (const [method, path, input] of routes) {
      expect((await h.call(method, `${v1}${path}`, input)).status).toBe(401);
      const refused = await h.call(method, `${v1}${path}`, input, utku.token);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("forbidden");
    }
    expect((await queue(boss.token)).status).toBe(200);
    expect((await h.call("GET", `${v1}/me`, undefined, boss.token)).body.account.role).toBe("admin");
    expect(await cli("grant", "@boss")).toBe("@boss is already an admin");
    expect(await cli("revoke", "@boss")).toBe("@boss is no longer an admin");
    expect((await queue(boss.token)).status).toBe(403);
    expect(await cli("revoke", "@boss")).toBe("@boss is not an admin");
    expect(await cli("grant", "@nobody")).toBe("no account for @nobody");
  });

  it("lists the queue with reporter, target and the message's text; dismiss closes one report", async () => {
    h = await harness();
    const { boss, troll } = await scene();
    const listed = await queue(boss.token);
    expect(listed.body).toMatchObject({ open: 2, more: false });
    const [onMessage, onUser] = listed.body.reports;
    expect(onMessage).toMatchObject({
      targetKind: "message",
      reason: "spam",
      message: { text: "free gems at my profile", removed: false },
      reporter: { handle: "utku" },
      target: { handle: "troll", userId: troll.id, status: "active" },
    });
    expect(onUser).toMatchObject({ targetKind: "user", note: "links", target: { handle: "troll" } });
    expect((await queue(boss.token, "?status=nope")).status).toBe(400);
    expect((await queue(boss.token, "?limit=1")).body).toMatchObject({ more: true });

    const dismissed = await act(boss.token, onUser.id, { action: "dismiss" });
    expect(dismissed.body).toMatchObject({ closed: 1, report: { status: "dismissed", handledBy: "boss" } });
    expect((await queue(boss.token)).body.open).toBe(1);
    expect((await queue(boss.token, "?status=dismissed")).body.reports).toHaveLength(1);
    expect((await act(boss.token, onUser.id, { action: "explode" })).status).toBe(400);
    expect((await act(boss.token, crypto.randomUUID(), { action: "dismiss" })).status).toBe(404);
  });

  it("warns (the person is told), removes the message, resets avatar and bio; each closes the target's reports", async () => {
    h = await harness();
    const { boss, utku, troll, message } = await scene();
    await h.call("PATCH", `${v1}/me/profile`, { bio: "best deals, dm me" }, troll.token);
    await h.deps.db.execute(
      sql`update profiles set avatar_url = '/api/v1/avatars/x.jpg' where account_id = ${troll.id}`,
    );
    const [onMessage, onUser] = (await queue(boss.token)).body.reports;

    const warned = await act(boss.token, onUser.id, { action: "warn", reason: "No spam links, please" });
    expect(warned.body).toMatchObject({ closed: 1, report: { status: "actioned" } });
    const told = await h.call("GET", `${v1}/me/notifications`, undefined, troll.token);
    expect(told.body.notifications[0]).toMatchObject({
      kind: "warning",
      actor: null,
      data: { reason: "No spam links, please" },
    });

    const removed = await act(boss.token, onMessage.id, { action: "remove_message" });
    expect(removed.body.report).toMatchObject({ status: "actioned", message: { removed: true } });
    const thread = await h.call(
      "GET",
      `${v1}/conversations/${message.conversationId}/messages`,
      undefined,
      utku.token,
    );
    expect(thread.body.messages.at(-1)).toMatchObject({ id: message.id, text: null });
    expect(thread.body.messages.at(-1).deletedAt).not.toBeNull();
    // A user report has no message to remove.
    expect((await act(boss.token, onUser.id, { action: "remove_message" })).status).toBe(400);

    await act(boss.token, onUser.id, { action: "reset_bio" });
    await act(boss.token, onUser.id, { action: "reset_avatar" });
    const profile = await h.call("GET", `${v1}/users/troll`, undefined, utku.token);
    expect(profile.body).toMatchObject({ bio: null, avatar: null });

    const log = (await h.call("GET", `${v1}/admin/audit`, undefined, boss.token)).body.entries;
    const actions = log.map((e: { action: string }) => e.action);
    for (const action of [
      "warn",
      "message.removed",
      "profile.bio_reset",
      "profile.avatar_reset",
      "report.actioned",
      "role.grant",
    ])
      expect(actions).toContain(action);
    expect(log.find((e: { action: string }) => e.action === "warn")).toMatchObject({
      actor: { handle: "boss" },
      targetUser: { handle: "troll" },
      data: { by: "boss", reason: "No spam links, please" },
    });
  });

  it("bans for days or for good, finds the account with its sessions and bans, and lifts a ban", async () => {
    h = await harness();
    const { boss, utku, troll } = await scene();
    const [, onUser] = (await queue(boss.token)).body.reports;
    const banned = await act(boss.token, onUser.id, { action: "ban", days: 7, reason: "spam" });
    // Only reports on the same target close: the one on troll's message stays open.
    expect(banned.body).toMatchObject({
      closed: 1,
      report: { status: "actioned", target: { status: "banned" } },
    });
    expect((await h.call("GET", `${v1}/me`, undefined, troll.token)).body.code).toBe("session_revoked");

    const found = await h.call("GET", `${v1}/admin/users?q=@troll`, undefined, boss.token);
    expect(found.body.user).toMatchObject({
      handle: "troll",
      email: "troll@example.com",
      status: "banned",
      reportsAgainst: 1,
    });
    expect(found.body.sessions[0].revokedAt).not.toBeNull();
    expect(found.body.bans).toMatchObject([{ live: true, reason: "spam", createdBy: "boss" }]);
    expect(Date.parse(found.body.bans[0].expiresAt) - Date.now()).toBeGreaterThan(6 * 86_400_000);
    const byEmail = await h.call("GET", `${v1}/admin/users?q=Troll@Example.com`, undefined, boss.token);
    expect(byEmail.body.user.userId).toBe(troll.id);
    expect((await h.call("GET", `${v1}/admin/users?q=x`, undefined, boss.token)).status).toBe(400);

    // An address banned before it has an account is found by its hash.
    await cli("ban", "later@example.com");
    const emailOnly = await h.call("GET", `${v1}/admin/users?q=later@example.com`, undefined, boss.token);
    expect(emailOnly.body).toMatchObject({ user: null, bans: [{ emailOnly: true, live: true }] });

    // Admins cannot be banned from the page.
    expect((await h.call("POST", `${v1}/admin/users/${boss.id}/ban`, {}, boss.token)).status).toBe(409);
    const forGood = await h.call("POST", `${v1}/admin/users/${utku.id}/ban`, { reason: "test" }, boss.token);
    expect(forGood.status).toBe(201);
    expect(forGood.body.expiresAt).toBeNull();
    expect((await h.call("POST", `${v1}/admin/users/${utku.id}/ban`, { days: 0 }, boss.token)).status).toBe(
      400,
    );

    const list = await h.call("GET", `${v1}/admin/bans`, undefined, boss.token);
    expect(
      list.body.bans.map((b: { account: { handle: string } | null }) => b.account?.handle ?? null),
    ).toEqual(["utku", null, "troll"]);
    const trollBan = list.body.bans[2].id;
    const lifted = await h.call("POST", `${v1}/admin/bans/${trollBan}/lift`, {}, boss.token);
    expect(lifted.body.ban).toMatchObject({ live: false });
    expect((await h.call("POST", `${v1}/admin/bans/${trollBan}/lift`, {}, boss.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/admin/bans`, undefined, boss.token)).body.bans).toHaveLength(2);
    expect((await h.call("GET", `${v1}/admin/bans?all=1`, undefined, boss.token)).body.bans).toHaveLength(3);
    expect(await cli("user", "@troll")).toContain("status active");
    const back = await h.user("troll@example.com");
    expect(back.id).toBe(troll.id);

    const actions = (await h.call("GET", `${v1}/admin/audit`, undefined, boss.token)).body.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(actions.filter((a: string) => a === "ban")).toHaveLength(3);
    expect(actions).toContain("unban");
    expect(actions).toContain("admin.lookup");
  });
});
