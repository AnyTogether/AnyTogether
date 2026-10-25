import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const admin = (...args: string[]) => run(args, h.deps);

async function moderator() {
  const mod = await h.user("boss@example.com");
  await admin("grant", "@boss");
  return mod;
}

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe("bans shown and appealed", () => {
  it("tells a banned person what, why and until when at sign-in, and lets them appeal once", async () => {
    const troll = await h.user("troll@example.com");
    const mod = await moderator();
    const live = await listen(troll.id);
    const banned = await h.call(
      "POST",
      `${v1}/admin/users/${troll.id}/ban`,
      { days: 7, reason: "three reports in chat", publicReason: "Insults in party chat" },
      mod.token,
    );
    expect(banned.status).toBe(201);
    await settle();
    expect(live.heard.map((e) => e.type)).toEqual(["account.restricted", "account.signed_out"]);
    expect(live.heard[0]?.data).toMatchObject({ kind: "suspended", reason: "Insults in party chat" });
    live.stop();

    // The address still gets a code; signing in with it is refused, saying why.
    const start = await h.call("POST", `${v1}/auth/email/start`, { email: "troll@example.com" });
    expect(start.status).toBe(403);
    expect(start.body).toMatchObject({ code: "account_banned", codeSent: true });
    expect(start.body.restriction).toBeUndefined();
    const refused = await h.call("POST", `${v1}/auth/email/verify`, {
      email: "troll@example.com",
      code: h.mailer.lastCode("troll@example.com"),
    });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: "account_banned",
      restriction: {
        id: banned.body.id,
        kind: "suspended",
        restricts: ["sign_in"],
        reason: "Insults in party chat",
        appealable: true,
      },
      appealTokenExpiresIn: 3600,
    });
    expect(Date.parse(refused.body.restriction.until)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // The moderators' own note is never shown.
    expect(JSON.stringify(refused.body)).not.toContain("three reports");
    const appealToken = refused.body.appealToken as string;

    // The appeal token reads the restriction and appeals, and does nothing else.
    const mine = await h.call("GET", `${v1}/me/restrictions`, undefined, appealToken);
    expect(mine.body.restrictions).toHaveLength(1);
    expect(mine.body.appeal).toBeNull();
    expect((await h.call("GET", `${v1}/me`, undefined, appealToken)).status).toBe(401);
    expect((await h.call("GET", `${v1}/me/restrictions`, undefined, "nonsense")).status).toBe(401);
    expect((await h.call("POST", `${v1}/me/appeals`, { text: "short" }, appealToken)).status).toBe(400);
    const appeal = await h.call(
      "POST",
      `${v1}/me/appeals`,
      { text: "It was a friend's joke, we were both laughing." },
      appealToken,
    );
    expect(appeal.status).toBe(201);
    expect(appeal.body.appeal).toMatchObject({ status: "open", restrictionId: banned.body.id, reply: null });
    const twice = await h.call("POST", `${v1}/me/appeals`, { text: "Please look at it again." }, appealToken);
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("appeal_open");
    const after = await h.call("GET", `${v1}/me/restrictions`, undefined, appealToken);
    expect(after.body.restrictions[0].appealable).toBe(false);
    expect(after.body.appeal.status).toBe("open");

    // The moderators see it, and accepting lifts the ban; the person is told.
    const queue = await h.call("GET", `${v1}/admin/appeals`, undefined, mod.token);
    expect(queue.body.open).toBe(1);
    expect(queue.body.appeals[0]).toMatchObject({
      id: appeal.body.appeal.id,
      account: { handle: "troll" },
      restriction: { kind: "suspended", note: "three reports in chat", live: true },
    });
    const accepted = await h.call(
      "POST",
      `${v1}/admin/appeals/${appeal.body.appeal.id}`,
      { decision: "accept", reply: "Fair enough, be kind." },
      mod.token,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.appeal).toMatchObject({ status: "accepted", reply: "Fair enough, be kind." });
    expect(
      (
        await h.call(
          "POST",
          `${v1}/admin/appeals/${appeal.body.appeal.id}`,
          { decision: "decline" },
          mod.token,
        )
      ).status,
    ).toBe(404);

    const back = await h.user("troll@example.com");
    expect(back.id).toBe(troll.id);
    const me = await h.call("GET", `${v1}/me`, undefined, back.token);
    expect(me.body.restrictions).toEqual([]);
    expect(me.body.appeal).toMatchObject({ status: "accepted", reply: "Fair enough, be kind." });
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, back.token);
    expect(notes.body.notifications[0]).toMatchObject({
      kind: "appeal",
      data: { decision: "accepted", reply: "Fair enough, be kind." },
    });
  });

  it("declines with an answer, and a ban without an end says banned", async () => {
    await h.user("troll@example.com");
    const mod = await moderator();
    await admin("ban", "@troll", "--public", "Spam links");
    await h.call("POST", `${v1}/auth/email/start`, { email: "troll@example.com" });
    const refused = await h.call("POST", `${v1}/auth/email/verify`, {
      email: "troll@example.com",
      code: h.mailer.lastCode("troll@example.com"),
    });
    expect(refused.body.restriction).toMatchObject({ kind: "banned", until: null, reason: "Spam links" });
    const token = refused.body.appealToken as string;
    const appeal = await h.call(
      "POST",
      `${v1}/me/appeals`,
      { text: "I never posted any links, check again." },
      token,
    );
    const declined = await h.call(
      "POST",
      `${v1}/admin/appeals/${appeal.body.appeal.id}`,
      { decision: "decline", reply: "The links are in the reports." },
      mod.token,
    );
    expect(declined.body.appeal.status).toBe("declined");
    const now = await h.call("GET", `${v1}/me/restrictions`, undefined, token);
    expect(now.body.restrictions[0].appealable).toBe(true);
    expect(now.body.appeal).toMatchObject({ status: "declined", reply: "The links are in the reports." });
    // Still banned: a provider sign-in is refused the same way.
    const google = await h.google.idToken(
      { sub: "g-troll", email: "troll@example.com", email_verified: true },
      "google-client",
    );
    const viaGoogle = await h.call("POST", `${v1}/auth/oidc/google`, { idToken: google });
    expect(viaGoogle.body).toMatchObject({ code: "account_banned", restriction: { kind: "banned" } });
    expect(viaGoogle.body.appealToken).toEqual(expect.any(String));
  });

  it("limits appeals per account", async () => {
    await h.close();
    h = await harness({ limits: { appeal: { max: 1, seconds: 86_400 } } });
    await h.user("troll@example.com");
    await admin("ban", "@troll");
    await h.call("POST", `${v1}/auth/email/start`, { email: "troll@example.com" });
    const refused = await h.call("POST", `${v1}/auth/email/verify`, {
      email: "troll@example.com",
      code: h.mailer.lastCode("troll@example.com"),
    });
    const token = refused.body.appealToken as string;
    expect(
      (await h.call("POST", `${v1}/me/appeals`, { text: "Please look at this again." }, token)).status,
    ).toBe(201);
    expect(
      (await h.call("POST", `${v1}/me/appeals`, { text: "Please look at this again." }, token)).status,
    ).toBe(429);
  });
});

describe("mutes", () => {
  it("lets a muted person sign in and play but not write, shows why in /me, and lifts", async () => {
    const troll = await h.user("troll@example.com");
    const ayse = await h.user("ayse@example.com");
    const mod = await moderator();
    await befriend(troll, ayse);
    const conversation = await h.call("POST", `${v1}/conversations`, { members: [ayse.id] }, troll.token);
    const live = await listen(troll.id);
    const muted = await h.call(
      "POST",
      `${v1}/admin/users/${troll.id}/mute`,
      { days: 3, publicReason: "Spamming invites" },
      mod.token,
    );
    expect(muted.status).toBe(201);
    await settle();
    expect(live.heard.map((e) => e.type)).toEqual(["account.restricted"]);

    const me = await h.call("GET", `${v1}/me`, undefined, troll.token);
    expect(me.status).toBe(200);
    expect(me.body.restrictions).toEqual([
      expect.objectContaining({
        kind: "muted",
        reason: "Spamming invites",
        restricts: ["messages", "posts", "friend_requests", "profile", "themes"],
        appealable: true,
      }),
    ]);
    const send = await h.call(
      "POST",
      `${v1}/conversations/${conversation.body.id ?? conversation.body.conversation?.id}/messages`,
      { id: crypto.randomUUID(), text: "hello" },
      troll.token,
    );
    expect(send.status).toBe(403);
    expect(send.body).toMatchObject({ code: "account_muted", restriction: { kind: "muted" } });
    expect((await h.call("PATCH", `${v1}/me/profile`, { bio: "buy now" }, troll.token)).body.code).toBe(
      "account_muted",
    );
    expect((await h.call("PATCH", `${v1}/me/profile`, { country: "DE" }, troll.token)).status).toBe(200);
    expect(
      (await h.call("POST", `${v1}/me/friends/requests`, { handle: "boss" }, troll.token)).body.code,
    ).toBe("account_muted");

    // Lifting it tells the person, and writing works again.
    const listed = await h.call("GET", `${v1}/admin/bans`, undefined, mod.token);
    expect(listed.body.bans[0]).toMatchObject({ kind: "mute", publicReason: "Spamming invites", live: true });
    const lifted = await h.call("POST", `${v1}/admin/bans/${muted.body.id}/lift`, {}, mod.token);
    expect(lifted.status).toBe(200);
    await settle();
    expect(live.heard.map((e) => e.type)).toEqual(["account.restricted", "account.restored"]);
    expect(live.heard[1]?.data).toEqual({ id: muted.body.id, kind: "muted" });
    live.stop();
    expect((await h.call("PATCH", `${v1}/me/profile`, { bio: "sorry" }, troll.token)).status).toBe(200);
    expect((await h.call("GET", `${v1}/me`, undefined, troll.token)).body.restrictions).toEqual([]);
  });

  it("mutes from a report, and from the command line", async () => {
    const troll = await h.user("troll@example.com");
    const ayse = await h.user("ayse@example.com");
    const mod = await moderator();
    await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "user", targetId: troll.id, reason: "spam" },
      ayse.token,
    );
    const [report] = (await h.call("GET", `${v1}/admin/reports`, undefined, mod.token)).body.reports;
    const done = await h.call(
      "POST",
      `${v1}/admin/reports/${report.id}`,
      { action: "mute", days: 1, publicReason: "Spam" },
      mod.token,
    );
    expect(done.status).toBe(200);
    expect((await h.call("GET", `${v1}/me`, undefined, troll.token)).body.restrictions[0].kind).toBe("muted");
    expect(await admin("unmute", "@troll")).toBe("lifted 1 mute(s) on @troll");
    expect(await admin("mute", "@troll", "--days", "2", "--public", "Spam")).toContain("muted @troll until");
    expect((await h.call("GET", `${v1}/me`, undefined, troll.token)).body.restrictions[0]).toMatchObject({
      kind: "muted",
      reason: "Spam",
    });
  });
});
