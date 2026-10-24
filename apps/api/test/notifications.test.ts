import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { PushSender } from "../src/notifications.js";
import { pushPayload, sendDigests } from "../src/notifications.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
type User = Awaited<ReturnType<typeof h.user>>;

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A device of the user with its gateway socket open, as the gateway keeps it. */
const connect = (user: User, device = "laptop") =>
  h.valkey
    .multi()
    .set(`presence:${user.id}:${device}`, JSON.stringify({ state: "online" }), "EX", 60)
    .set(`presence:${user.id}`, JSON.stringify({ state: "online" }), "EX", 60)
    .exec();
const disconnect = (user: User, device = "laptop") =>
  h.valkey.del(`presence:${user.id}:${device}`, `presence:${user.id}`);

const list = (user: User, query = "") =>
  h.call("GET", `${v1}/me/notifications${query}`, undefined, user.token);

/** A push service that keeps what it was sent; an endpoint containing "gone" answers 410. */
function fakePush() {
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = {
    publicKey: "BPublicKeyForTests",
    async send(subscription, payload) {
      if (subscription.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    },
  };
  return { sender, sent };
}
const subscription = (name: string, lang?: "en" | "tr") => ({
  endpoint: `https://push.example.com/send/${name}`,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
  ...(lang ? { lang } : {}),
});

describe("notifications", () => {
  it("a friend request and its acceptance, listed, counted, told live and read", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const ayseHears = await listen(ayse.id);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: "ayse" }, utku.token);
    await settle();
    const told = ayseHears.heard.find((e) => e.type === "notification");
    expect(told?.data).toMatchObject({
      notification: { kind: "friend_request", actor: { handle: "utku" }, subjectId: utku.id, read: false },
      unread: 1,
    });
    ayseHears.stop();
    const listed = await list(ayse);
    expect(listed.body).toMatchObject({ unread: 1, more: false });
    expect(listed.body.notifications).toHaveLength(1);
    expect((await h.call("GET", `${v1}/me/notifications/unread`, undefined, ayse.token)).body).toEqual({
      unread: 1,
    });

    // Accepting settles the request and tells the asker.
    await h.call("POST", `${v1}/me/friends/requests/${utku.id}/accept`, {}, ayse.token);
    expect((await list(ayse)).body).toMatchObject({ unread: 0, notifications: [{ read: true }] });
    const utkus = await list(utku);
    expect(utkus.body).toMatchObject({
      unread: 1,
      notifications: [{ kind: "friend_accepted", actor: { handle: "ayse" } }],
    });
    const id = utkus.body.notifications[0].id;
    expect((await h.call("POST", `${v1}/me/notifications/${id}/read`, {}, ayse.token)).body).toEqual({
      unread: 0,
    });
    expect((await list(utku)).body.unread).toBe(1);
    const utkuHears = await listen(utku.id);
    expect((await h.call("POST", `${v1}/me/notifications/${id}/read`, {}, utku.token)).body).toEqual({
      unread: 0,
    });
    await settle();
    expect(utkuHears.heard.find((e) => e.type === "notification.read")?.data).toEqual({
      ids: [id],
      unread: 0,
    });
    utkuHears.stop();
    expect((await h.call("POST", `${v1}/me/notifications/nope/read`, {}, utku.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/me/notifications`)).status).toBe(401);
  });

  it("a withdrawn request takes its notification back", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await h.call("POST", `${v1}/me/friends/requests`, { handle: "ayse" }, utku.token);
    expect((await list(ayse)).body.unread).toBe(1);
    await h.call("DELETE", `${v1}/me/friends/${ayse.id}`, undefined, utku.token);
    expect((await list(ayse)).body).toMatchObject({ unread: 0, notifications: [] });
  });

  it("messages notify only while no device is connected, gather per conversation, and reading clears them", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = await h.call("POST", `${v1}/conversations`, { members: [ayse.id] }, utku.token);
    const conversation = made.body.id as string;
    const send = (text: string, from = utku) =>
      h.call(
        "POST",
        `${v1}/conversations/${conversation}/messages`,
        { clientId: crypto.randomUUID(), text },
        from.token,
      );

    await connect(ayse);
    await send("online, so no notification");
    expect(
      (await list(ayse)).body.notifications.filter((n: { kind: string }) => n.kind === "message"),
    ).toEqual([]);
    await disconnect(ayse);
    await send("first");
    await send("second");
    const gathered = (await list(ayse)).body.notifications.filter(
      (n: { kind: string }) => n.kind === "message",
    );
    expect(gathered).toHaveLength(1);
    expect(gathered[0]).toMatchObject({
      subjectId: conversation,
      actor: { handle: "utku" },
      data: { conversationId: conversation, group: false, count: 2, text: "second" },
    });
    // Reading up to the end settles it; the next message makes a new one.
    await h.call("POST", `${v1}/conversations/${conversation}/read`, { upToSeq: 3 }, ayse.token);
    expect((await list(ayse)).body.unread).toBe(0);
    await send("third");
    expect((await list(ayse)).body.unread).toBe(1);
    // Answering means reading it.
    await send("back", ayse);
    expect((await list(ayse)).body.unread).toBe(0);

    // Hidden presence keeps no merged key: the device's own key still counts.
    await h.call("PATCH", `${v1}/me/privacy`, { presence: "nobody" }, ayse.token);
    await h.valkey
      .multi()
      .set(`presence:${ayse.id}:phone`, JSON.stringify({ state: "online" }), "EX", 60)
      .sadd(`presence-devices:${ayse.id}`, "phone")
      .exec();
    await send("hidden but here");
    expect((await list(ayse)).body.unread).toBe(0);
  });

  it("each kind can be turned off; a warning cannot", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const settings = await h.call("GET", `${v1}/me/notifications/settings`, undefined, ayse.token);
    expect(settings.body).toEqual({
      settings: {
        friend_request: true,
        friend_accepted: true,
        message: true,
        party_invite: true,
        game_invite: true,
        missed_call: true,
        digest: false,
      },
      push: null,
      canMail: true,
    });
    const changed = await h.call(
      "PATCH",
      `${v1}/me/notifications/settings`,
      { friend_request: false },
      ayse.token,
    );
    expect(changed.body.settings).toMatchObject({ friend_request: false, message: true });
    expect(
      (await h.call("PATCH", `${v1}/me/notifications/settings`, { warning: false }, ayse.token)).status,
    ).toBe(400);
    expect(
      (await h.call("PATCH", `${v1}/me/notifications/settings`, { message: "no" }, ayse.token)).status,
    ).toBe(400);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: "ayse" }, utku.token);
    expect((await list(ayse)).body.notifications).toEqual([]);
    await h.app.notes.notify(ayse.id, { kind: "warning", subjectId: "w1", data: { reason: "spam" } });
    expect((await list(ayse)).body.notifications).toMatchObject([
      { kind: "warning", data: { reason: "spam" } },
    ]);
    const exported = await h.call("GET", `${v1}/me/export`, undefined, ayse.token);
    expect(exported.body.profile.notificationSettings.friend_request).toBe(false);
    expect(exported.body.notifications).toHaveLength(1);
  });

  it("party and game invites, settled by joining or declining, taken back when it ends; missed calls", async () => {
    h = await harness();
    const lead = await h.user("lead@example.com");
    const ayse = await h.user("ayse@example.com");
    const cem = await h.user("cem@example.com");
    await befriend(lead, ayse);
    await befriend(lead, cem);
    await h.call("POST", `${v1}/me/notifications/read-all`, {}, lead.token);
    await h.call("POST", `${v1}/me/notifications/read-all`, {}, ayse.token);
    await h.call("POST", `${v1}/me/notifications/read-all`, {}, cem.token);

    const party = (await h.call("POST", `${v1}/parties`, {}, lead.token)).body.id as string;
    await h.call("POST", `${v1}/parties/${party}/invites`, { userIds: [ayse.id, cem.id] }, lead.token);
    expect((await list(ayse)).body.notifications[0]).toMatchObject({
      kind: "party_invite",
      subjectId: party,
      read: false,
      data: { partyId: party, size: 1 },
    });
    await h.call("POST", `${v1}/parties/${party}/join`, {}, ayse.token);
    expect((await list(ayse)).body.unread).toBe(0);
    // Everyone leaves: cem's invite to a party that is over goes.
    await h.call("POST", `${v1}/parties/${party}/leave`, {}, ayse.token);
    expect((await list(cem)).body.unread).toBe(1);
    await h.call("POST", `${v1}/parties/${party}/leave`, {}, lead.token);
    expect((await list(cem)).body.unread).toBe(0);

    const session = await h.call(
      "POST",
      `${v1}/game-sessions`,
      { titleId: "PPSA01234", gameVersion: "01.000", engineBuild: "1", capacity: 4 },
      lead.token,
    );
    await h.call(
      "POST",
      `${v1}/game-sessions/${session.body.id}/invites`,
      { userIds: [ayse.id] },
      lead.token,
    );
    expect((await list(ayse)).body.notifications[0]).toMatchObject({
      kind: "game_invite",
      data: { sessionId: session.body.id, titleId: "PPSA01234" },
    });
    await h.call("POST", `${v1}/game-sessions/${session.body.id}/decline`, {}, ayse.token);
    expect((await list(ayse)).body.unread).toBe(0);

    // Rung and hung up before an answer: missed. Declined: not missed.
    const call = await h.call("POST", `${v1}/calls`, { userId: ayse.id }, lead.token);
    await h.call("POST", `${v1}/calls/${call.body.call.id}/leave`, {}, lead.token);
    expect((await list(ayse)).body.notifications[0]).toMatchObject({
      kind: "missed_call",
      actor: { handle: "lead" },
      subjectId: call.body.call.id,
    });
    const declined = await h.call("POST", `${v1}/calls`, { userId: ayse.id }, lead.token);
    await h.call("POST", `${v1}/calls/${declined.body.call.id}/decline`, {}, ayse.token);
    expect((await list(ayse)).body.notifications[0].subjectId).toBe(call.body.call.id);

    // read-all, and paging.
    expect((await h.call("POST", `${v1}/me/notifications/read-all`, {}, ayse.token)).body).toEqual({
      unread: 0,
    });
    const first = await list(ayse, "?limit=2");
    expect(first.body).toMatchObject({ more: true });
    const next = await list(ayse, `?limit=2&before=${first.body.notifications[1].id}`);
    expect(next.body.notifications[0].id < first.body.notifications[1].id).toBe(true);
    expect((await list(ayse, "?before=x")).status).toBe(400);
  });
});

describe("web push", () => {
  it("is off without VAPID keys", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    expect((await h.call("POST", `${v1}/me/push`, subscription("a"), utku.token)).status).toBe(404);
  });

  it("pushes to subscribed browsers when no socket is open, forgets 410 Gone and signed-out browsers", async () => {
    const push = fakePush();
    h = await harness({ push: push.sender });
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const phone = await h.user("ayse@example.com");
    expect((await h.call("GET", `${v1}/me/notifications/settings`, undefined, ayse.token)).body.push).toEqual(
      {
        publicKey: "BPublicKeyForTests",
      },
    );
    expect((await h.call("POST", `${v1}/me/push`, subscription("laptop"), ayse.token)).status).toBe(201);
    // Subscribing again updates it in place.
    expect((await h.call("POST", `${v1}/me/push`, subscription("laptop", "tr"), ayse.token)).status).toBe(
      201,
    );
    await h.call("POST", `${v1}/me/push`, subscription("phone"), phone.token);
    await h.call("POST", `${v1}/me/push`, subscription("gone"), phone.token);
    expect(
      (
        await h.call(
          "POST",
          `${v1}/me/push`,
          { ...subscription("x"), endpoint: "http://insecure" },
          ayse.token,
        )
      ).status,
    ).toBe(400);

    await connect(ayse);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: "ayse" }, utku.token);
    await h.app.notes.flush();
    expect(push.sent).toEqual([]);
    await h.call("DELETE", `${v1}/me/friends/${ayse.id}`, undefined, utku.token);

    await disconnect(ayse);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: "ayse" }, utku.token);
    await h.app.notes.flush();
    expect(push.sent.map((p) => p.endpoint).sort()).toEqual([
      "https://push.example.com/send/laptop",
      "https://push.example.com/send/phone",
    ]);
    expect(push.sent.find((p) => p.endpoint.endsWith("laptop"))?.payload).toEqual({
      title: "utku",
      body: "arkadaşın olmak istiyor.",
      url: "/friends",
      tag: `friend_request:${utku.id}`,
      unread: 1,
    });
    expect(push.sent.find((p) => p.endpoint.endsWith("phone"))?.payload.body).toBe(
      "wants to be your friend.",
    );
    const left = async () =>
      (await h.deps.db.execute(sql`select endpoint from push_subscriptions order by endpoint`)).map((r) =>
        (r as { endpoint: string }).endpoint.split("/").pop(),
      );
    expect(await left()).toEqual(["laptop", "phone"]);

    // Signing out ends the browser's subscription; so does unsubscribing.
    await h.call("POST", `${v1}/auth/logout`, {}, phone.token);
    expect(await left()).toEqual(["laptop"]);
    expect(
      (await h.call("DELETE", `${v1}/me/push`, { endpoint: subscription("laptop").endpoint }, ayse.token))
        .status,
    ).toBe(204);
    expect(await left()).toEqual([]);
  });

  it("writes each kind's push in the device's language", () => {
    const actor = { userId: "u", handle: "utku", displayName: "Utku", avatar: null };
    const base = { id: "n", actor, read: false, createdAt: "", updatedAt: "" };
    expect(
      pushPayload(
        {
          ...base,
          kind: "message",
          subjectId: "c1",
          data: { count: 3, text: "hey", group: true, title: "Squad" },
        },
        "en",
        4,
      ),
    ).toMatchObject({
      title: "Squad · Utku",
      body: "3 new messages · hey",
      url: "/messages?c=c1",
      unread: 4,
    });
    expect(
      pushPayload(
        {
          ...base,
          kind: "game_invite",
          subjectId: "s",
          data: { titleId: "PPSA01234", gameNames: { en: "Astro" } },
        },
        "tr",
        1,
      ).body,
    ).toBe("seni Astro oynamaya çağırdı.");
    expect(pushPayload({ ...base, kind: "missed_call", subjectId: "c", data: {} }, "tr", 1)).toMatchObject({
      body: "Cevapsız arama.",
      url: "/u/utku",
    });
  });
});

describe("mail digest", () => {
  it("only when turned on, after a quiet while, at most once per 6 hours, each notification once", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const conversation = (await h.call("POST", `${v1}/conversations`, { members: [ayse.id] }, utku.token))
      .body.id;
    const send = (text: string) =>
      h.call(
        "POST",
        `${v1}/conversations/${conversation}/messages`,
        { clientId: crypto.randomUUID(), text },
        utku.token,
      );
    await send("one");
    await send("two");
    const digests = (now = Date.now() + 20 * 60_000) =>
      sendDigests({ ...h.deps, publicUrl: "https://anytogether.test" }, now);
    const mailed = () => h.mailer.sent.filter((m) => m.kind === "digest");

    expect(await digests()).toBe(0);
    await h.call("PATCH", `${v1}/me/notifications/settings`, { digest: true }, ayse.token);
    // Too soon after the message: she may still see it herself.
    expect(await digests(Date.now())).toBe(0);
    // Connected: nothing mailed.
    await connect(ayse);
    expect(await digests()).toBe(0);
    await disconnect(ayse);
    expect(await digests()).toBe(1);
    expect(mailed()).toHaveLength(1);
    expect(mailed()[0]?.to).toBe("ayse@example.com");
    expect(mailed()[0]?.text).toContain("2 new messages · AnyTogether");
    expect(mailed()[0]?.text).toContain("2 messages from utku");
    expect(mailed()[0]?.text).not.toContain("two");
    expect(await digests()).toBe(0);

    // A new one within 6 hours waits; after them it goes, alone.
    await h.call("POST", `${v1}/conversations/${conversation}/read`, { upToSeq: 2 }, ayse.token);
    await send("three");
    expect(await digests()).toBe(0);
    await h.deps.db.execute(sql`update notifications set mailed_at = mailed_at - interval '7 hours'`);
    expect(await digests()).toBe(1);
    expect(mailed()[1]?.text).toContain("1 message from utku");
  });
});
