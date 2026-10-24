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
