import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { iceServers } from "../src/calls.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
const turn = {
  secret: "test-secret",
  urls: ["stun:relay.test:3478", "turn:relay.test:3478", "turns:relay.test:5349?transport=tcp"],
};
afterEach(async () => {
  await h?.close();
});

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
  await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
  await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** The session ID inside an access token, which the gateway calls the device. */
const deviceOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString()).sid as string;

describe("ICE servers", () => {
  it("give TURN REST credentials for 12 hours beside the STUN URLs", () => {
    const now = Date.parse("2026-10-24T10:00:00Z");
    const { iceServers: servers, expiresAt } = iceServers(turn, "user-1", now);
    const expiry = now / 1000 + 12 * 3600;
    expect(servers).toEqual([
      { urls: ["stun:relay.test:3478"] },
      {
        urls: ["turn:relay.test:3478", "turns:relay.test:5349?transport=tcp"],
        username: `${expiry}:user-1`,
        credential: createHmac("sha1", "test-secret").update(`${expiry}:user-1`).digest("base64"),
      },
    ]);
    expect(expiresAt).toBe("2026-10-24T22:00:00.000Z");
  });

  it("give only what is configured, never a public fallback", () => {
    expect(iceServers(undefined, "u").iceServers).toEqual([]);
    expect(iceServers({ secret: "", urls: [] }, "u").iceServers).toEqual([]);
    // TURN without a secret cannot be used: only the STUN part is handed out.
    expect(iceServers({ secret: "", urls: turn.urls }, "u").iceServers).toEqual([
      { urls: ["stun:relay.test:3478"] },
    ]);
  });
});

describe("direct calls", () => {
  it("ring the friend, stop ringing on the other devices when one answers, and end", async () => {
    h = await harness({ turn });
    const caller = await h.user("caller@example.com");
    const callee = await h.user("callee@example.com");
    await befriend(caller, callee);
    const calleeHears = await listen(callee.id);
    const started = await h.call("POST", "/api/v1/calls", { userId: callee.id }, caller.token);
    expect(started.status).toBe(201);
    expect(started.body.call).toMatchObject({ kind: "direct", calleeId: callee.id, answeredAt: null });
    expect(started.body.call.in).toEqual([
      { userId: caller.id, device: deviceOf(caller.token), muted: false },
    ]);
    expect(started.body.iceServers[1].username).toMatch(new RegExp(`^\\d+:${caller.id}$`));
    const callId = started.body.call.id as string;
    expect(await h.valkey.smembers(`call:${callId}:members`)).toEqual(
      expect.arrayContaining([caller.id, callee.id]),
    );
    await settle();
    expect(calleeHears.heard.find((e) => e.type === "call.ringing")?.data).toMatchObject({
      callId,
      from: { userId: caller.id },
      device: deviceOf(caller.token),
    });

    const answered = await h.call("POST", `/api/v1/calls/${callId}/answer`, {}, callee.token);
    expect(answered.status).toBe(200);
    expect(answered.body.call.in).toHaveLength(2);
    await settle();
    // Every device of the callee hears which one answered, so the others stop ringing.
    expect(calleeHears.heard.find((e) => e.type === "call.answered")?.data).toMatchObject({
      userId: callee.id,
      device: deviceOf(callee.token),
    });
    // A second device answering too is refused.
    const other = await h.call("POST", `/api/v1/calls/${callId}/answer`, {}, callee.token);
    expect(other.status).toBe(409);

    await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, caller.token);
    await settle();
    expect(calleeHears.heard.find((e) => e.type === "call.ended")?.data).toMatchObject({ reason: "ended" });
    calleeHears.stop();
    expect(await h.valkey.exists(`call:${callId}:members`)).toBe(0);
    expect((await h.call("GET", `/api/v1/calls/${callId}`, undefined, caller.token)).status).toBe(404);
  });

  it("only friends can be called, and a declined call ends for both", async () => {
    h = await harness({ turn });
    const a = await h.user("c1@example.com");
    const b = await h.user("c2@example.com");
    expect((await h.call("POST", "/api/v1/calls", { userId: b.id }, a.token)).status).toBe(403);
    expect((await h.call("POST", "/api/v1/calls", { userId: a.id }, a.token)).status).toBe(400);
    expect((await h.call("POST", "/api/v1/calls", {}, a.token)).status).toBe(400);
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/calls", { userId: b.id }, a.token);
    const aHears = await listen(a.id);
    expect((await h.call("POST", `/api/v1/calls/${body.call.id}/decline`, {}, b.token)).status).toBe(204);
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.ended")?.data).toMatchObject({ reason: "declined" });
    aHears.stop();
    await h.call("POST", "/api/v1/me/blocks", { userId: a.id }, b.token);
    expect((await h.call("POST", "/api/v1/calls", { userId: b.id }, a.token)).status).toBe(403);
  });
});

describe("party calls", () => {
  it("are one call per party that members join and leave; the last one out ends it", async () => {
    h = await harness({ turn: { secret: "", urls: [] } });
    const a = await h.user("pa@example.com");
    const b = await h.user("pb@example.com");
    const outsider = await h.user("px@example.com");
    await befriend(a, b);
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    const partyId = party.body.id as string;
    await h.call("POST", `/api/v1/parties/${partyId}/join`, {}, b.token);
    expect((await h.call("POST", "/api/v1/calls", { partyId }, outsider.token)).status).toBe(404);

    const first = await h.call("POST", "/api/v1/calls", { partyId }, a.token);
    expect(first.status).toBe(201);
    expect(first.body.iceServers).toEqual([]);
    const callId = first.body.call.id as string;
    const aHears = await listen(a.id);
    const second = await h.call("POST", "/api/v1/calls", { partyId }, b.token);
    expect(second.body.call.id).toBe(callId);
    expect(second.body.call.in.map((p: { userId: string }) => p.userId).sort()).toEqual([a.id, b.id].sort());
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.joined")?.data).toMatchObject({
      callId,
      userId: b.id,
      device: deviceOf(b.token),
    });
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, a.token)).body.call).toMatchObject({
      id: callId,
    });

    // Leaving the party leaves its call.
    await h.call("POST", `/api/v1/parties/${partyId}/leave`, {}, b.token);
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.left")?.data).toMatchObject({ userId: b.id });
    expect(await h.valkey.sismember(`call:${callId}:members`, b.id)).toBe(0);
    await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, a.token);
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.ended")?.data).toMatchObject({ callId, partyId });
    aHears.stop();
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, a.token)).body.call).toBeNull();
    const again = await h.call("POST", "/api/v1/calls", { partyId }, a.token);
    expect(again.body.call.id).not.toBe(callId);
  });

  it("hands out fresh credentials", async () => {
    h = await harness({ turn });
    const a = await h.user("ice@example.com");
    const fresh = await h.call("GET", "/api/v1/ice-servers", undefined, a.token);
    expect(fresh.body.iceServers).toHaveLength(2);
    expect(fresh.body.expiresAt).not.toBeNull();
  });
});

describe("devices that go away", () => {
  /** What the gateway notes when a device's socket closes, due now. */
  const departed = (user: User) =>
    h.valkey.zadd("call-departures", Date.now() - 1, `${user.id}:${deviceOf(user.token)}`);

  it("leave the party call when the device does not come back, and the last one out ends it", async () => {
    h = await harness();
    const a = await h.user("da@example.com");
    const b = await h.user("db@example.com");
    await befriend(a, b);
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    const partyId = party.body.id as string;
    await h.call("POST", `/api/v1/parties/${partyId}/join`, {}, b.token);
    const callId = (await h.call("POST", "/api/v1/calls", { partyId }, a.token)).body.call.id as string;
    await h.call("POST", "/api/v1/calls", { partyId }, b.token);
    expect(await h.valkey.smembers(`device-calls:${deviceOf(b.token)}`)).toEqual([callId]);
    const aHears = await listen(a.id);

    // Back on the gateway within the grace: still in the call.
    await h.valkey.set(`presence:${b.id}:${deviceOf(b.token)}`, '{"state":"online"}');
    await departed(b);
    expect(await h.app.sweepDepartures()).toBe(0);
    expect((await h.call("GET", `/api/v1/calls/${callId}`, undefined, a.token)).body.in).toHaveLength(2);

    await h.valkey.del(`presence:${b.id}:${deviceOf(b.token)}`);
    await departed(b);
    expect(await h.app.sweepDepartures()).toBe(1);
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.left")?.data).toMatchObject({ callId, userId: b.id });
    const now = await h.call("GET", `/api/v1/calls/${callId}`, undefined, a.token);
    expect(now.body.in.map((p: { userId: string }) => p.userId)).toEqual([a.id]);
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, a.token)).body.call.in).toEqual([
      a.id,
    ]);
    expect(await h.valkey.exists(`device-calls:${deviceOf(b.token)}`)).toBe(0);
    // Still in the party, so they may join its call again.
    expect((await h.call("POST", "/api/v1/calls", { partyId }, b.token)).body.call.id).toBe(callId);
    await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, b.token);

    await departed(a);
    expect(await h.app.sweepDepartures()).toBe(1);
    await settle();
    expect(aHears.heard.find((e) => e.type === "call.ended")?.data).toMatchObject({ callId, partyId });
    aHears.stop();
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, a.token)).body.call).toBeNull();
    expect(await h.valkey.zcard("call-departures")).toBe(0);
  });

  it("end a direct call that is still ringing when the caller's device goes", async () => {
    h = await harness();
    const caller = await h.user("dc1@example.com");
    const callee = await h.user("dc2@example.com");
    await befriend(caller, callee);
    const started = await h.call("POST", "/api/v1/calls", { userId: callee.id }, caller.token);
    const calleeHears = await listen(callee.id);
    // Not due yet: nothing happens.
    await h.valkey.zadd("call-departures", Date.now() + 60_000, `${caller.id}:${deviceOf(caller.token)}`);
    expect(await h.app.sweepDepartures()).toBe(0);
    expect(await h.app.sweepDepartures(Date.now() + 61_000)).toBe(1);
    await settle();
    expect(calleeHears.heard.find((e) => e.type === "call.ended")?.data).toMatchObject({
      callId: started.body.call.id,
      reason: "ended",
    });
    calleeHears.stop();
    expect(
      (await h.call("GET", `/api/v1/calls/${started.body.call.id}`, undefined, callee.token)).status,
    ).toBe(404);
  });
});

describe("muting", () => {
  it("tells the others and shows in the call and the party", async () => {
    h = await harness();
    const a = await h.user("ma@example.com");
    const b = await h.user("mb@example.com");
    await befriend(a, b);
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    const partyId = party.body.id as string;
    await h.call("POST", `/api/v1/parties/${partyId}/join`, {}, b.token);
    const callId = (await h.call("POST", "/api/v1/calls", { partyId }, a.token)).body.call.id as string;
    // In the party but not in its call yet: nothing to mute.
    expect((await h.call("POST", `/api/v1/calls/${callId}/mute`, { muted: true }, b.token)).status).toBe(404);
    await h.call("POST", "/api/v1/calls", { partyId }, b.token);
    const bHears = await listen(b.id);
    expect((await h.call("POST", `/api/v1/calls/${callId}/mute`, {}, a.token)).status).toBe(400);
    const muted = await h.call("POST", `/api/v1/calls/${callId}/mute`, { muted: true }, a.token);
    expect(muted.status).toBe(200);
    expect(muted.body.in.find((p: { userId: string }) => p.userId === a.id).muted).toBe(true);
    await settle();
    expect(bHears.heard.find((e) => e.type === "call.updated")?.data).toEqual({
      callId,
      partyId,
      userId: a.id,
      muted: true,
    });
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, b.token)).body.call.muted).toEqual([
      a.id,
    ]);
    // Saying it again changes nothing and tells no one.
    const before = bHears.heard.filter((e) => e.type === "call.updated").length;
    await h.call("POST", `/api/v1/calls/${callId}/mute`, { muted: true }, a.token);
    await settle();
    expect(bHears.heard.filter((e) => e.type === "call.updated")).toHaveLength(before);
    await h.call("POST", `/api/v1/calls/${callId}/mute`, { muted: false }, a.token);
    expect(
      (await h.call("GET", `/api/v1/calls/${callId}`, undefined, b.token)).body.in.every(
        (p: { muted: boolean }) => !p.muted,
      ),
    ).toBe(true);
    // Leaving forgets it.
    await h.call("POST", `/api/v1/calls/${callId}/mute`, { muted: true }, a.token);
    await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, a.token);
    expect(await h.valkey.sismember(`call:${callId}:muted`, a.id)).toBe(0);
    bHears.stop();
  });
});

describe("gateway tickets", () => {
  it("are made for a signed-in user, kept 30 seconds by their hash", async () => {
    h = await harness();
    const a = await h.user("ticket@example.com");
    const made = await h.call("POST", "/api/v1/realtime/ticket", {}, a.token);
    expect(made.status).toBe(201);
    expect(made.body.expiresIn).toBe(30);
    const { createHash } = await import("node:crypto");
    const key = `rt-ticket:${createHash("sha256").update(made.body.ticket).digest("hex")}`;
    expect(JSON.parse((await h.valkey.get(key)) ?? "{}")).toEqual({
      userId: a.id,
      sessionId: deviceOf(a.token),
    });
    expect(await h.valkey.ttl(key)).toBeGreaterThan(25);
    expect((await h.call("POST", "/api/v1/realtime/ticket", {})).status).toBe(401);
  });
});
