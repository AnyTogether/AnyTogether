import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { type NativePush, type PhoneDevice, type PhoneMessage, PushGone } from "../src/nativePush.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h?.close();
});

const v1 = "/api/v1";
const phoneClient = "phone/1.23.0 (iOS 18.6)";
const app = "org.anyps5.anyps5Remote";
type User = Awaited<ReturnType<typeof h.user>>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const deviceOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString()).sid as string;

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A sign-in with its gateway socket open, as the gateway keeps it. */
const online = (user: User, token: string) =>
  h.valkey
    .multi()
    .set(`presence:${user.id}:${deviceOf(token)}`, JSON.stringify({ state: "online" }), "EX", 60)
    .set(`presence:${user.id}`, JSON.stringify({ state: "online" }), "EX", 60)
    .exec();
const offline = (user: User, token: string) =>
  h.valkey.del(`presence:${user.id}:${deviceOf(token)}`, `presence:${user.id}`);

/** APNs and FCM that keep what they were sent; a token with "gone" in it is unknown to them. */
function fakePhones(fcm = true) {
  const sent: { device: PhoneDevice; message: PhoneMessage }[] = [];
  const push: NativePush = {
    apns: [app],
    fcm,
    async send(device, message) {
      if (device.token.includes("gone")) throw new PushGone("Unregistered");
      sent.push({ device, message });
    },
  };
  return { push, sent };
}

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown>; device?: string }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

const iphone = (token: string, extra: Record<string, unknown> = {}) => ({
  platform: "apns",
  token,
  app,
  lang: "en",
  ...extra,
});

describe("phone push", { timeout: 60_000 }, () => {
  it("is off without APNs or FCM set up", async () => {
    h = await harness();
    const ayse = await h.user("ayse@example.com", phoneClient);
    expect(
      (await h.call("GET", `${v1}/me/notifications/settings`, undefined, ayse.token)).body.native,
    ).toBeNull();
    expect((await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111"), ayse.token)).status).toBe(404);
  });

  it("takes a phone's token only for a platform and an app the server pushes to", async () => {
    const phones = fakePhones(false);
    h = await harness({ nativePush: phones.push });
    const ayse = await h.user("ayse@example.com", phoneClient);
    const settings = await h.call("GET", `${v1}/me/notifications/settings`, undefined, ayse.token);
    expect(settings.body.native).toEqual({ apns: [app], fcm: false });
    expect(settings.body.settings).toMatchObject({ pushPreview: true, pushCalls: true });
    expect(
      (await h.call("POST", `${v1}/me/push/device`, { platform: "fcm", token: "fcm-token-1" }, ayse.token))
        .status,
    ).toBe(404);
    expect(
      (await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111", { app: "com.other.app" }), ayse.token))
        .status,
    ).toBe(400);
    expect(
      (await h.call("POST", `${v1}/me/push/device`, { platform: "apns", token: "bad token!" }, ayse.token))
        .status,
    ).toBe(400);
    expect((await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111"), ayse.token)).status).toBe(201);
    // The same token again (the app started again, or signed in as someone else) is one device.
    const again = await h.user("ayse@example.com", phoneClient);
    expect(
      (
        await h.call(
          "POST",
          `${v1}/me/push/device`,
          iphone("aaaa1111", { lang: "tr", sandbox: true }),
          again.token,
        )
      ).status,
    ).toBe(201);
    const rows = await h.deps.db.execute(sql`select session_id, lang, sandbox from push_devices`);
    expect(rows).toEqual([{ session_id: deviceOf(again.token), lang: "tr", sandbox: true }]);
    expect((await h.call("DELETE", `${v1}/me/push/device`, { token: "aaaa1111" }, again.token)).status).toBe(
      204,
    );
    expect(await h.deps.db.execute(sql`select id from push_devices`)).toEqual([]);
  });

  it("sends what the bell shows to the phones while no socket is open, and forgets unknown tokens", async () => {
    const phones = fakePhones();
    h = await harness({ nativePush: phones.push });
    const ayse = await h.user("ayse@example.com", phoneClient);
    const android = await h.user("ayse@example.com", "phone/1.23.0 (Android 15)");
    const deniz = await h.user("deniz@example.com");
    const ece = await h.user("ece@example.com");
    await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111"), ayse.token);
    await h.call(
      "POST",
      `${v1}/me/push/device`,
      { platform: "fcm", token: "fcm-token-1", lang: "tr" },
      android.token,
    );
    await h.call("POST", `${v1}/me/push/device`, iphone("gone2222"), ayse.token);

    // A socket open anywhere: the bell there tells it, no push.
    await online(ayse, ayse.token);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: ayse.handle }, deniz.token);
    await h.app.notes.flush();
    expect(phones.sent).toEqual([]);
    await offline(ayse, ayse.token);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: ayse.handle }, ece.token);
    await h.app.notes.flush();
    expect(phones.sent.map((s) => s.device.token).sort()).toEqual(["aaaa1111", "fcm-token-1"]);
    const toIphone = phones.sent.find((s) => s.device.token === "aaaa1111")?.message;
    expect(toIphone).toMatchObject({
      type: "notice",
      body: "wants to be your friend.",
      tag: expect.stringMatching(/^friend_request:/),
      // Deniz's request, stored while a socket was open, and Ece's.
      badge: 2,
      data: { kind: "friend_request", url: "/friends" },
    });
    const notice = JSON.parse(String(toIphone?.data.notice));
    expect(notice).toMatchObject({ kind: "friend_request", actor: { userId: ece.id, handle: ece.handle } });
    expect(phones.sent.find((s) => s.device.token === "fcm-token-1")?.message).toMatchObject({
      body: "arkadaşın olmak istiyor.",
    });
    // The unknown token is gone.
    expect(
      (await h.deps.db.execute(sql`select token from push_devices order by token`)).map((r) => r.token),
    ).toEqual(["aaaa1111", "fcm-token-1"]);
    // Signing the phone out ends its push.
    await h.call("POST", `${v1}/auth/logout`, {}, android.token);
    expect((await h.deps.db.execute(sql`select token from push_devices`)).map((r) => r.token)).toEqual([
      "aaaa1111",
    ]);
  });

  it("keeps what was written out of a push when the person turned previews off", async () => {
    const phones = fakePhones();
    h = await harness({ nativePush: phones.push });
    const ayse = await h.user("ayse@example.com", phoneClient);
    const deniz = await h.user("deniz@example.com");
    await befriend(ayse, deniz);
    await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111"), ayse.token);
    const conversation = await h.call("POST", `${v1}/conversations`, { members: [ayse.id] }, deniz.token);
    const write = (text: string) =>
      h.call(
        "POST",
        `${v1}/conversations/${conversation.body.id}/messages`,
        { clientId: crypto.randomUUID(), text },
        deniz.token,
      );
    await write("The secret plan");
    await h.app.notes.flush();
    expect(phones.sent.at(-1)?.message).toMatchObject({ body: "The secret plan" });
    expect(
      (await h.call("PATCH", `${v1}/me/notifications/settings`, { pushPreview: false }, ayse.token)).body
        .settings.pushPreview,
    ).toBe(false);
    await write("Another secret");
    await h.app.notes.flush();
    const last = phones.sent.at(-1)?.message as Extract<PhoneMessage, { type: "notice" }>;
    // The same conversation: the same tag, so the phone shows one notification for it.
    expect(last.tag).toBe(phones.sent[0]?.message.tag);
    expect(last.body).toBe("2 new messages.");
    expect(JSON.stringify(last)).not.toContain("secret");
  });

  it("rings the phones whose app is closed, and ends the ringing as the call ends", async () => {
    const phones = fakePhones();
    h = await harness({ nativePush: phones.push });
    const ayse = await h.user("ayse@example.com", phoneClient);
    const openApp = await h.user("ayse@example.com", "phone/1.23.0 (Android 15)");
    const mac = await h.user("ayse@example.com");
    const deniz = await h.user("deniz@example.com");
    await befriend(ayse, deniz);
    await h.call("POST", `${v1}/me/push/device`, iphone("aaaa1111"), ayse.token);
    await h.call("POST", `${v1}/me/push/device`, { platform: "fcm", token: "fcm-open-app" }, openApp.token);
    // The Mac and the Android app are open: they ring by themselves. The iPhone's app is closed.
    await online(ayse, mac.token);
    await online(ayse, openApp.token);
    const first = await h.call("POST", `${v1}/calls`, { userId: ayse.id }, deniz.token);
    await settle();
    expect(phones.sent).toHaveLength(1);
    expect(phones.sent[0]).toMatchObject({
      device: { token: "aaaa1111" },
      message: {
        type: "call",
        title: expect.any(String),
        body: "is calling you.",
        tag: `missed_call:${first.body.call.id}`,
        data: { kind: "call", callId: first.body.call.id },
      },
    });
    // Answered on the Mac: the iPhone stops ringing, quietly.
    await h.call("POST", `${v1}/calls/${first.body.call.id}/answer`, {}, mac.token);
    await settle();
    expect(phones.sent[1]?.message).toMatchObject({
      type: "call_over",
      missed: null,
      data: { callId: first.body.call.id },
    });
    await h.call("POST", `${v1}/calls/${first.body.call.id}/leave`, {}, mac.token);

    // Nobody answers, and nothing else is open: the ringing becomes the missed call, once.
    await offline(ayse, mac.token);
    await offline(ayse, openApp.token);
    phones.sent.length = 0;
    const second = await h.call("POST", `${v1}/calls`, { userId: ayse.id }, deniz.token);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    await settle();
    expect(phones.sent.map((s) => s.message.type)).toEqual(["call", "call"]);
    await h.call("POST", `${v1}/calls/${second.body.call.id}/leave`, {}, deniz.token);
    await settle();
    const after = phones.sent.slice(2);
    expect(after.map((s) => s.message.type).sort()).toEqual(["call_over", "call_over"]);
    expect(after[0]?.message).toMatchObject({
      tag: `missed_call:${second.body.call.id}`,
      missed: { body: "Missed call.", badge: 2 },
    });

    // Calls on the phone turned off: it does not ring.
    await h.call("PATCH", `${v1}/me/notifications/settings`, { pushCalls: false }, ayse.token);
    phones.sent.length = 0;
    await h.call("POST", `${v1}/calls`, { userId: ayse.id }, deniz.token);
    await settle();
    expect(phones.sent).toEqual([]);
  });
});

describe("the party's voice on the phone", { timeout: 60_000 }, () => {
  it("moves from the computer to the phone: the computer is told alone and can no longer leave for it", async () => {
    h = await harness();
    const mac = await h.user("ayse@example.com");
    const phone = await h.user("ayse@example.com", phoneClient);
    const deniz = await h.user("deniz@example.com");
    await befriend(mac, deniz);
    const party = await h.call("POST", `${v1}/parties`, { privacy: "friends" }, mac.token);
    const partyId = party.body.id as string;
    await h.call("POST", `${v1}/parties/${partyId}/join`, {}, deniz.token);
    const joined = await h.call("POST", `${v1}/calls`, { partyId }, mac.token);
    const callId = joined.body.call.id as string;
    await h.call("POST", `${v1}/calls`, { partyId }, deniz.token);
    const ayseHears = await listen(mac.id);
    const denizHears = await listen(deniz.id);

    const moved = await h.call("POST", `${v1}/calls`, { partyId }, phone.token);
    expect(moved.status).toBe(200);
    expect(moved.body.call.in).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: mac.id, device: deviceOf(phone.token) })]),
    );
    await settle();
    const told = ayseHears.heard.filter((e) => e.type === "call.moved");
    expect(told).toEqual([
      expect.objectContaining({
        device: deviceOf(mac.token),
        data: { callId, partyId, userId: mac.id, device: deviceOf(phone.token), client: "phone" },
      }),
    ]);
    // Nobody else hears of it: the same person is in the voice.
    expect(denizHears.heard.filter((e) => e.type.startsWith("call."))).toEqual([]);
    expect(await h.valkey.smembers(`device-calls:${deviceOf(mac.token)}`)).toEqual([]);

    // The computer stopping its voice changes nothing for the phone.
    expect((await h.call("POST", `${v1}/calls/${callId}/leave`, {}, mac.token)).status).toBe(204);
    expect((await h.call("POST", `${v1}/calls/${callId}/mute`, { muted: true }, mac.token)).status).toBe(409);
    expect(await h.valkey.hget(`call:${callId}:in`, mac.id)).toBe(deviceOf(phone.token));
    // The phone leaving does leave.
    expect((await h.call("POST", `${v1}/calls/${callId}/leave`, {}, phone.token)).status).toBe(204);
    expect(await h.valkey.hget(`call:${callId}:in`, mac.id)).toBeNull();
    ayseHears.stop();
    denizHears.stop();
  });
});
