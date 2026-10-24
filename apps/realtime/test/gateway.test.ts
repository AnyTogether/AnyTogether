import type { AddressInfo } from "node:net";
import { Redis } from "ioredis";
import { SignJWT, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createGateway } from "../src/gateway.js";

const issuer = "https://anytogether.test";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let valkey: Redis;
let gateway: Awaited<ReturnType<typeof createGateway>>;
let url: string;

const token = (userId: string, sessionId: string) =>
  new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience("anytogether")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(keys.privateKey);

/** A client socket that keeps every frame it gets and can wait for one. */
function client() {
  const socket = new WebSocket(url);
  const frames: Record<string, unknown>[] = [];
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  socket.on("message", (data) => frames.push(JSON.parse(String(data))));
  const opened = new Promise((resolve) => socket.on("open", resolve));
  const waitFor = async (match: (frame: Record<string, unknown>) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = frames.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no such frame; got ${JSON.stringify(frames)}`);
  };
  return {
    socket,
    frames,
    closed,
    opened,
    waitFor,
    send: (frame: unknown) => socket.send(JSON.stringify(frame)),
  };
}

async function signedIn(userId: string, sessionId: string, resume?: string) {
  const c = client();
  await c.opened;
  c.send({
    op: "hello",
    token: await token(userId, sessionId),
    client: "launcher-macos/0.2.13",
    ...(resume ? { resume } : {}),
  });
  await c.waitFor((frame) => frame.op === "ready");
  return c;
}

const publish = (userId: string, event: Record<string, unknown>) => {
  const message = JSON.stringify({ id: `${Date.now()}-${Math.random()}`, ...event });
  return valkey
    .multi()
    .xadd(`events:${userId}`, "*", "event", message)
    .publish(`user:${userId}`, message)
    .exec()
    .then(() => JSON.parse(message).id as string);
};

beforeEach(async () => {
  keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  valkey = new Redis(process.env.TEST_VALKEY_URL ?? "redis://127.0.0.1:63799/2");
  await valkey.flushdb();
  gateway = await createGateway({
    keys: keys.publicKey,
    issuer,
    valkeyUrl: process.env.TEST_VALKEY_URL ?? "redis://127.0.0.1:63799/2",
    helloTimeoutMs: 300,
    heartbeatSeconds: 25,
  });
  await new Promise<void>((resolve) => gateway.server.listen(0, "127.0.0.1", resolve));
  url = `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}/rt`;
});

afterEach(async () => {
  await gateway.close();
  valkey.disconnect();
});

describe("the gateway", () => {
  it("is ready after a hello with a valid token", async () => {
    const c = await signedIn("u1", "s1");
    const ready = c.frames.find((frame) => frame.op === "ready");
    expect(ready).toMatchObject({ op: "ready", session: "s1", heartbeat: 25 });
    c.socket.close();
  });

  it("closes a socket with a bad token", async () => {
    const c = client();
    await c.opened;
    c.send({ op: "hello", token: "nonsense" });
    expect(await c.closed).toBe(4001);
  });

  it("takes a one-time ticket instead of a token, once", async () => {
    const { createHash } = await import("node:crypto");
    const ticket = "a-ticket-from-the-api-0123456789";
    const key = `rt-ticket:${createHash("sha256").update(ticket).digest("hex")}`;
    await valkey.set(key, JSON.stringify({ userId: "u1", sessionId: "web1" }), "EX", 30);
    const c = client();
    await c.opened;
    c.send({ op: "hello", ticket, client: "web/0.1" });
    expect(await c.waitFor((frame) => frame.op === "ready")).toMatchObject({ session: "web1" });
    expect(await valkey.exists(key)).toBe(0);
    const again = client();
    await again.opened;
    again.send({ op: "hello", ticket });
    expect(await again.closed).toBe(4001);
    c.socket.close();
  });

  it("closes a socket that never says hello", async () => {
    const c = client();
    await c.opened;
    expect(await c.closed).toBe(4001);
  });

  it("delivers the user's events, and only theirs", async () => {
    const mine = await signedIn("u1", "s1");
    const other = await signedIn("u2", "s2");
    await publish("u1", { type: "presence.updated", data: { userId: "u9", state: "online" } });
    const event = await mine.waitFor((frame) => frame.op === "event");
    expect(event).toMatchObject({ type: "presence.updated", data: { userId: "u9" } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(other.frames.filter((frame) => frame.op === "event")).toHaveLength(0);
    mine.socket.close();
    other.socket.close();
  });

  it("closes the signed-out session's socket and keeps the others", async () => {
    const mac = await signedIn("u1", "mac");
    const phone = await signedIn("u1", "phone");
    await publish("u1", { type: "account.signed_out", data: { sessionId: "mac" } });
    expect(await mac.closed).toBe(4003);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(phone.socket.readyState).toBe(WebSocket.OPEN);
    phone.socket.close();
  });

  it("refuses a session already signed out", async () => {
    await valkey.set("revoked:old", "1");
    const c = client();
    await c.opened;
    c.send({ op: "hello", token: await token("u1", "old") });
    expect(await c.closed).toBe(4003);
  });

  it("replays what a reconnecting socket missed", async () => {
    const first = await signedIn("u1", "s1");
    const seen = await publish("u1", { type: "presence.updated", data: { userId: "a", state: "online" } });
    await first.waitFor((frame) => frame.op === "event");
    first.socket.close();
    await first.closed;
    await publish("u1", { type: "presence.updated", data: { userId: "b", state: "online" } });
    await publish("u1", { type: "presence.updated", data: { userId: "c", state: "online" } });
    const again = await signedIn("u1", "s1", seen);
    await again.waitFor((frame) => (frame.data as { userId?: string })?.userId === "c");
    const replayed = again.frames
      .filter((frame) => frame.op === "event")
      .map((frame) => (frame.data as { userId: string }).userId);
    expect(replayed).toEqual(["b", "c"]);
    again.socket.close();
  });

  it("tells friends when a friend comes online, plays and leaves", async () => {
    await valkey.sadd("friends:u1", "u2");
    await valkey.sadd("friends:u2", "u1");
    const friend = await signedIn("u2", "s2");
    const me = await signedIn("u1", "s1");
    await friend.waitFor(
      (frame) => frame.type === "presence.updated" && (frame.data as { state: string }).state === "online",
    );
    me.send({
      op: "heartbeat",
      presence: { state: "in_game", titleId: "PPSA01234", since: "2026-10-24T10:00:00Z" },
    });
    await friend.waitFor(
      (frame) => frame.type === "presence.updated" && (frame.data as { state: string }).state === "in_game",
    );
    expect(JSON.parse((await valkey.get("presence:u1")) ?? "{}")).toMatchObject({
      state: "in_game",
      titleId: "PPSA01234",
    });
    me.socket.close();
    await friend.waitFor(
      (frame) => frame.type === "presence.updated" && (frame.data as { state: string }).state === "offline",
    );
    expect(await valkey.get("presence:u1")).toBeNull();
    friend.socket.close();
  });

  it("closes a socket that sends a flood of frames", async () => {
    const c = await signedIn("u1", "s1");
    for (let i = 0; i < 40; i++) c.send({ op: "heartbeat" });
    expect(await c.closed).toBe(4029);
  });

  it("tells no one about a user who hides their presence", async () => {
    await valkey.sadd("friends:u1", "u2");
    await valkey.set("presence-hidden:u1", "1");
    const friend = await signedIn("u2", "s2");
    const me = await signedIn("u1", "s1");
    me.send({ op: "heartbeat", presence: { state: "in_game", titleId: "PPSA01234" } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(friend.frames.filter((frame) => frame.type === "presence.updated")).toEqual([]);
    expect(await valkey.get("presence:u1")).toBeNull();
    me.socket.close();
    friend.socket.close();
  });

  it("merges a user's devices: playing on one wins over online on another", async () => {
    await valkey.sadd("friends:u1", "u2");
    const friend = await signedIn("u2", "s2");
    const mac = await signedIn("u1", "mac");
    const phone = await signedIn("u1", "phone");
    mac.send({
      op: "heartbeat",
      presence: { state: "in_game", titleId: "PPSA09999", since: "2026-10-24T10:00:00Z" },
    });
    await friend.waitFor((frame) => (frame.data as { state?: string })?.state === "in_game");
    phone.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(JSON.parse((await valkey.get("presence:u1")) ?? "{}").state).toBe("in_game");
    mac.socket.close();
    friend.socket.close();
  });

  it("adds the API's extras to presence and keeps devices from claiming them", async () => {
    await valkey.sadd("friends:u1", "u2");
    await valkey.hset(
      "presence-extra:u1",
      "party",
      JSON.stringify({ id: "p1", size: 2, max: 8, open: false }),
    );
    const friend = await signedIn("u2", "s2");
    const me = await signedIn("u1", "s1");
    const told = await friend.waitFor((frame) => frame.type === "presence.updated");
    expect(told.data).toMatchObject({ userId: "u1", state: "online", party: { id: "p1", size: 2 } });
    me.send({ op: "heartbeat", presence: { state: "in_game", titleId: "PPSA01234", party: { id: "fake" } } });
    await friend.waitFor((frame) => (frame.data as { state?: string })?.state === "in_game");
    expect(JSON.parse((await valkey.get("presence:u1")) ?? "{}")).toEqual({
      state: "in_game",
      titleId: "PPSA01234",
      party: { id: "p1", size: 2, max: 8, open: false },
    });
    me.socket.close();
    const gone = await friend.waitFor((frame) => (frame.data as { state?: string })?.state === "offline");
    expect((gone.data as { party?: unknown }).party).toBeUndefined();
    friend.socket.close();
  });

  it("relays signals only between members of the call, to one device or all", async () => {
    await valkey.sadd("call:c1:members", "u1", "u2");
    const caller = await signedIn("u1", "mac");
    const phone = await signedIn("u2", "phone");
    const laptop = await signedIn("u2", "laptop");
    const outsider = await signedIn("u3", "s3");

    caller.send({
      op: "signal",
      to: "u2",
      device: "laptop",
      call: "c1",
      kind: "offer",
      data: { sdp: "v=0" },
    });
    const offer = await laptop.waitFor((frame) => frame.type === "signal");
    expect(offer.data).toEqual({
      call: "c1",
      from: "u1",
      device: "mac",
      kind: "offer",
      data: { sdp: "v=0" },
    });
    caller.send({ op: "signal", to: "u2", call: "c1", kind: "candidate", data: { candidate: "x" } });
    await phone.waitFor((frame) => (frame.data as { kind?: string })?.kind === "candidate");
    expect(phone.frames.filter((frame) => frame.type === "signal")).toHaveLength(1);

    outsider.send({ op: "signal", to: "u1", call: "c1", kind: "offer", data: {} });
    expect(await outsider.waitFor((frame) => frame.op === "error")).toMatchObject({ code: "not_in_call" });
    caller.send({ op: "signal", to: "u3", call: "c1", kind: "offer", data: {} });
    expect(await caller.waitFor((frame) => frame.op === "error")).toMatchObject({ code: "not_in_call" });
    caller.send({ op: "signal", to: "u2", call: "c1", kind: "shout", data: {} });
    expect(await caller.waitFor((frame) => frame.code === "bad_signal")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(caller.frames.filter((frame) => frame.type === "signal")).toHaveLength(0);
    // A call's setup sends many candidates at once: more than the socket's frame limit, still fine.
    for (let i = 0; i < 60; i++)
      caller.send({ op: "signal", to: "u2", device: "laptop", call: "c1", kind: "candidate", data: { i } });
    await laptop.waitFor((frame) => (frame.data as { data?: { i?: number } })?.data?.i === 59);
    expect(caller.socket.readyState).toBe(WebSocket.OPEN);
    // Signals are passed on, never kept for a replay.
    expect(await valkey.xlen("events:u2")).toBe(0);
    for (const c of [caller, phone, laptop, outsider]) c.socket.close();
  });

  it("notes a device that goes while in a call, unless another tab of it is still here", async () => {
    await valkey.sadd("device-calls:web1", "c1");
    const tab = await signedIn("u1", "web1");
    const other = await signedIn("u1", "web1");
    const phone = await signedIn("u1", "phone");
    other.socket.close();
    phone.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await valkey.zcard("call-departures")).toBe(0);
    expect(await valkey.exists("presence:u1:web1")).toBe(1);
    const before = Date.now();
    tab.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const due = Number(await valkey.zscore("call-departures", "u1:web1"));
    expect(due).toBeGreaterThanOrEqual(before + 20_000);
    expect(due).toBeLessThan(before + 21_000);
    expect(await valkey.exists("presence:u1:web1")).toBe(0);
  });

  it("passes typing on to the conversation's other members, at most every two seconds", async () => {
    await valkey.sadd("conversation:k1:members", "u1", "u2", "u3");
    const me = await signedIn("u1", "s1");
    const myPhone = await signedIn("u1", "s1b");
    const friend = await signedIn("u2", "s2");
    const other = await signedIn("u3", "s3");
    const outsider = await signedIn("u4", "s4");
    me.send({ op: "typing", conversation: "k1" });
    expect((await friend.waitFor((frame) => frame.type === "typing")).data).toEqual({
      conversationId: "k1",
      userId: "u1",
    });
    await other.waitFor((frame) => frame.type === "typing");
    // Again at once: dropped.
    me.send({ op: "typing", conversation: "k1" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(friend.frames.filter((frame) => frame.type === "typing")).toHaveLength(1);
    expect(myPhone.frames.filter((frame) => frame.type === "typing")).toHaveLength(0);
    outsider.send({ op: "typing", conversation: "k1" });
    expect(await outsider.waitFor((frame) => frame.op === "error")).toMatchObject({
      code: "not_in_conversation",
    });
    expect(await valkey.xlen("events:u2")).toBe(0);
    for (const c of [me, myPhone, friend, other, outsider]) c.socket.close();
  });

  it("relays signals between players of a game session only", async () => {
    await valkey.sadd("game-session:g1:members", "u1", "u2");
    await valkey.sadd("call:c9:members", "u1", "u3");
    const host = await signedIn("u1", "mac");
    const guest = await signedIn("u2", "mac2");
    const caller = await signedIn("u3", "s3");
    host.send({ op: "signal", to: "u2", session: "g1", kind: "candidate", data: "192.0.2.10:49152" });
    const got = await guest.waitFor((frame) => frame.type === "game_session.signal");
    expect(got.data).toEqual({
      sessionId: "g1",
      from: "u1",
      device: "mac",
      kind: "candidate",
      data: "192.0.2.10:49152",
    });
    guest.send({ op: "signal", to: "u1", device: "mac", session: "g1", kind: "message", data: { hi: 1 } });
    expect((await host.waitFor((frame) => frame.type === "game_session.signal")).data).toMatchObject({
      kind: "message",
      data: { hi: 1 },
    });
    // A call member is not a player, and "message" is for game sessions only.
    caller.send({ op: "signal", to: "u1", session: "g1", kind: "offer", data: {} });
    expect(await caller.waitFor((frame) => frame.op === "error")).toMatchObject({ code: "not_in_session" });
    caller.send({ op: "signal", to: "u1", call: "c9", kind: "message", data: {} });
    expect(await caller.waitFor((frame) => frame.code === "bad_signal")).toBeTruthy();
    host.send({ op: "signal", to: "u2", kind: "offer", data: {} });
    expect(await host.waitFor((frame) => frame.code === "bad_signal")).toBeTruthy();
    expect(await valkey.xlen("events:u2")).toBe(0);
    for (const c of [host, guest, caller]) c.socket.close();
  });

  it("relays signals between a share play's host and viewers only, and notes a departing device", async () => {
    await valkey.sadd("share-play:sp1:members", "u1", "u2");
    await valkey.sadd("game-session:g1:members", "u1", "u3");
    const host = await signedIn("u1", "mac");
    const viewer = await signedIn("u2", "web");
    const player = await signedIn("u3", "s3");
    host.send({ op: "signal", to: "u2", device: "web", share: "sp1", kind: "offer", data: { sdp: "v=0" } });
    const got = await viewer.waitFor((frame) => frame.type === "share_play.signal");
    expect(got.data).toEqual({
      sharePlayId: "sp1",
      from: "u1",
      device: "mac",
      kind: "offer",
      data: { sdp: "v=0" },
    });
    viewer.send({ op: "signal", to: "u1", device: "mac", share: "sp1", kind: "renegotiate", data: null });
    expect((await host.waitFor((frame) => frame.type === "share_play.signal")).data).toMatchObject({
      kind: "renegotiate",
      from: "u2",
    });
    // A game session's player is not a viewer.
    player.send({ op: "signal", to: "u1", share: "sp1", kind: "offer", data: {} });
    expect(await player.waitFor((frame) => frame.op === "error")).toMatchObject({
      code: "not_in_share_play",
    });
    host.send({ op: "signal", to: "u2", share: "sp1", kind: "shout", data: {} });
    expect(await host.waitFor((frame) => frame.code === "bad_signal")).toBeTruthy();
    expect(await valkey.xlen("events:u2")).toBe(0);

    // The viewer's device watches; when its socket closes the API is told to take it out later.
    await valkey.sadd("device-shares:web", "sp1");
    viewer.socket.close();
    await viewer.closed;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const [entry, score] = await valkey.zrange("share-departures", 0, -1, "WITHSCORES");
    expect(entry).toBe("u2:web");
    expect(Number(score)).toBeGreaterThan(Date.now());
    expect(await valkey.zcard("call-departures")).toBe(0);
    for (const c of [host, player]) c.socket.close();
  });

  it("keeps presence from heartbeats", async () => {
    const c = await signedIn("u1", "s1");
    c.send({
      op: "heartbeat",
      presence: { state: "in_game", titleId: "PPSA01234", since: "2026-10-24T10:00:00Z" },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stored = JSON.parse((await valkey.get("presence:u1:s1")) ?? "{}");
    expect(stored).toMatchObject({ state: "in_game", titleId: "PPSA01234" });
    expect(await valkey.ttl("presence:u1:s1")).toBeGreaterThan(50);
    c.socket.close();
  });
});
