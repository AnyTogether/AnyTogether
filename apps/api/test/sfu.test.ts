import { jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { type SfuService, sfuService } from "../src/sfu.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h?.close();
});

type User = Awaited<ReturnType<typeof h.user>>;

const secret = "livekit-test-secret-that-is-long-enough";
/** What LiveKit's server API was asked, in order. */
let asked: { method: string; body: Record<string, unknown>; auth: string }[] = [];

function fakeSfu(overrides: Partial<Parameters<typeof sfuService>[0]> = {}): SfuService {
  return sfuService({
    url: "wss://media.anytogether.test",
    apiUrl: "http://livekit:7880",
    apiKey: "APIkey",
    apiSecret: secret,
    maxShareViewers: 10,
    maxPartySize: 12,
    fetch: async (input, init) => {
      asked.push({
        method: String(input).split("/").pop() ?? "",
        body: JSON.parse(String(init?.body ?? "{}")),
        auth: String((init?.headers as Record<string, string>)?.authorization ?? ""),
      });
      return new Response("{}", { status: 200 });
    },
    ...overrides,
  });
}

const claims = async (token: string) =>
  (await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "APIkey" })).payload as {
    sub: string;
    exp: number;
    video: Record<string, unknown>;
  };

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return {
    heard,
    stop: () => events.disconnect(),
    of: (type: string) => heard.filter((e) => e.type === type),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
  await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const game = { titleId: "PPSA01234", title: "Cat Quest III" };

describe("the media server's tokens", () => {
  it("let into one room, publishing only when granted, for ten minutes", async () => {
    asked = [];
    const sfu = fakeSfu();
    const now = Date.parse("2026-11-06T10:00:00Z");
    const viewer = await sfu.access("share-1", "user-1", { publish: false }, Date.now());
    expect(viewer).toMatchObject({
      url: "wss://media.anytogether.test",
      room: "share-1",
      identity: "user-1",
    });
    const seen = await claims(viewer.token);
    expect(seen.sub).toBe("user-1");
    expect(seen.video).toEqual({
      room: "share-1",
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    expect(
      (await claims((await sfu.access("call-1", "user-2", { publish: true })).token)).video.canPublish,
    ).toBe(true);
    expect((await sfu.access("r", "u", { publish: false }, now)).expiresAt).toBe("2026-11-06T10:10:00.000Z");
  });

  it("keep the limits between the mesh's and the hard cap", () => {
    expect(fakeSfu({ maxShareViewers: 2, maxPartySize: 500 }).limits).toEqual({
      sfu: true,
      maxShareViewers: 16,
      maxPartySize: 32,
    });
    expect(fakeSfu({ maxShareViewers: undefined, maxPartySize: undefined }).limits).toMatchObject({
      maxShareViewers: 16,
      maxPartySize: 24,
    });
  });

  it("close rooms and take people out through LiveKit's server API", async () => {
    asked = [];
    const sfu = fakeSfu();
    await sfu.remove("share-1", "user-1");
    await sfu.close("share-1");
    expect(asked.map((a) => [a.method, a.body])).toEqual([
      ["RemoveParticipant", { room: "share-1", identity: "user-1" }],
      ["DeleteRoom", { room: "share-1" }],
    ]);
    const admin = await claims(asked[0]?.auth.replace("Bearer ", "") ?? "");
    expect(admin.video).toMatchObject({ room: "share-1", roomAdmin: true });
  });

  it("never throw when LiveKit is away", async () => {
    const sfu = fakeSfu({
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    expect(await sfu.close("share-1")).toBe(false);
  });
});

describe("GET /media-server", () => {
  it("says the mesh limits without a media server", async () => {
    h = await harness();
    expect((await h.call("GET", "/api/v1/media-server")).body).toEqual({
      sfu: false,
      maxShareViewers: 4,
      maxPartySize: 8,
    });
  });

  it("says the media server's limits with one", async () => {
    h = await harness({ sfu: fakeSfu() });
    expect((await h.call("GET", "/api/v1/media-server")).body).toEqual({
      sfu: true,
      maxShareViewers: 10,
      maxPartySize: 12,
    });
  });
});

describe("share play through the media server", () => {
  it("is refused above four viewers without one", async () => {
    h = await harness();
    const host = await h.user("host@example.com");
    const started = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 6 }, host.token);
    expect(started.status).toBe(400);
    expect(started.body).toMatchObject({ code: "media_server_off", max: 4 });
    const small = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 4 }, host.token);
    expect(small.status).toBe(201);
    expect(small.body.sharePlay.media).toBe("mesh");
    expect(small.body.sfu).toBeNull();
    const raised = await h.call(
      "PATCH",
      `/api/v1/share-plays/${small.body.sharePlay.id}`,
      { maxViewers: 5 },
      host.token,
    );
    expect(raised.status).toBe(400);
    expect(raised.body.code).toBe("media_server_off");
  });

  it("stays on the mesh up to four viewers with one", async () => {
    asked = [];
    h = await harness({ sfu: fakeSfu() });
    const host = await h.user("host@example.com");
    const started = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 3 }, host.token);
    expect(started.body.sharePlay.media).toBe("mesh");
    expect(started.body.sfu).toBeNull();
    const id = started.body.sharePlay.id as string;
    expect((await h.call("GET", `/api/v1/share-plays/${id}/sfu`, undefined, host.token)).status).toBe(409);
    await h.call("DELETE", `/api/v1/share-plays/${id}`, undefined, host.token);
    expect(asked).toEqual([]);
  });

  it("goes through it above four: the host publishes, viewers watch, the room closes at the end", async () => {
    asked = [];
    h = await harness({ sfu: fakeSfu() });
    const host = await h.user("host@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(host, friend);
    expect(
      (await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 11 }, host.token)).body,
    ).toMatchObject({ code: "media_server_off", max: 10 });
    const started = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 10 }, host.token);
    expect(started.status).toBe(201);
    const id = started.body.sharePlay.id as string;
    expect(started.body.sharePlay.media).toBe("sfu");
    expect(started.body.sfu).toMatchObject({ room: `share-${id}`, identity: host.id });
    expect((await claims(started.body.sfu.token)).video.canPublish).toBe(true);

    const joined = await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token);
    expect(joined.status).toBe(201);
    expect(joined.body.sharePlay.media).toBe("sfu");
    expect(joined.body.sfu).toMatchObject({ room: `share-${id}`, identity: friend.id });
    expect((await claims(joined.body.sfu.token)).video.canPublish).toBe(false);

    const fresh = await h.call("GET", `/api/v1/share-plays/${id}/sfu`, undefined, friend.token);
    expect(fresh.status).toBe(200);
    expect((await claims(fresh.body.token)).sub).toBe(friend.id);
    const stranger = await h.user("stranger@example.com");
    expect((await h.call("GET", `/api/v1/share-plays/${id}/sfu`, undefined, stranger.token)).status).toBe(
      404,
    );

    await h.call("POST", `/api/v1/share-plays/${id}/leave`, {}, friend.token);
    expect(asked.map((a) => [a.method, a.body])).toEqual([
      ["RemoveParticipant", { room: `share-${id}`, identity: friend.id }],
    ]);
    await h.call("DELETE", `/api/v1/share-plays/${id}`, undefined, host.token);
    expect(asked.at(-1)).toMatchObject({ method: "DeleteRoom", body: { room: `share-${id}` } });
  });

  it("moves there for good when the host lets more than four in", async () => {
    h = await harness({ sfu: fakeSfu() });
    const host = await h.user("host@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(host, friend);
    const started = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 2 }, host.token);
    const id = started.body.sharePlay.id as string;
    await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token);
    const friendHears = await listen(friend.id);
    const raised = await h.call("PATCH", `/api/v1/share-plays/${id}`, { maxViewers: 8 }, host.token);
    expect(raised.status).toBe(200);
    expect(raised.body.media).toBe("sfu");
    await settle();
    expect(friendHears.of("share_play.updated").at(-1)?.data.media).toBe("sfu");
    const lowered = await h.call("PATCH", `/api/v1/share-plays/${id}`, { maxViewers: 3 }, host.token);
    expect(lowered.body.media).toBe("sfu");
    friendHears.stop();
  });
});

describe("party voice through the media server", () => {
  it("holds at most eight in a party without one", async () => {
    h = await harness();
    const leader = await h.user("leader@example.com");
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, leader.token);
    expect(party.body.max).toBe(8);
  });

  it("holds more with one, and moves the call there when a ninth voice comes in", async () => {
    asked = [];
    h = await harness({ sfu: fakeSfu() });
    const leader = await h.user("leader@example.com");
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, leader.token);
    expect(party.body.max).toBe(12);
    const partyId = party.body.id as string;
    const others: User[] = [];
    for (let i = 1; i <= 11; i++) {
      const other = await h.user(`member${i}@example.com`);
      await befriend(leader, other);
      expect((await h.call("POST", `/api/v1/parties/${partyId}/join`, {}, other.token)).status).toBe(200);
      others.push(other);
    }
    const late = await h.user("late@example.com");
    await befriend(leader, late);
    expect((await h.call("POST", `/api/v1/parties/${partyId}/join`, {}, late.token)).status).toBe(409);

    const first = await h.call("POST", "/api/v1/calls", { partyId }, leader.token);
    expect(first.body.call.media).toBe("mesh");
    expect(first.body.sfu).toBeNull();
    const callId = first.body.call.id as string;
    for (const other of others.slice(0, 7))
      expect((await h.call("POST", "/api/v1/calls", { partyId }, other.token)).body.call.media).toBe("mesh");
    expect((await h.call("GET", `/api/v1/calls/${callId}/sfu`, undefined, leader.token)).status).toBe(409);

    const leaderHears = await listen(leader.id);
    const ninth = others[7] as User;
    const moved = await h.call("POST", "/api/v1/calls", { partyId }, ninth.token);
    expect(moved.body.call.media).toBe("sfu");
    expect(moved.body.sfu).toMatchObject({ room: `call-${callId}`, identity: ninth.id });
    expect((await claims(moved.body.sfu.token)).video.canPublish).toBe(true);
    await settle();
    expect(leaderHears.of("call.media")).toMatchObject([
      { type: "call.media", data: { callId, partyId, media: "sfu" } },
    ]);
    const mine = await h.call("GET", `/api/v1/calls/${callId}/sfu`, undefined, leader.token);
    expect(mine.status).toBe(200);
    expect(mine.body.identity).toBe(leader.id);
    expect((await h.call("GET", `/api/v1/parties/${partyId}`, undefined, leader.token)).body.call.media).toBe(
      "sfu",
    );

    await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, ninth.token);
    expect(asked.at(-1)).toMatchObject({
      method: "RemoveParticipant",
      body: { room: `call-${callId}`, identity: ninth.id },
    });
    // Fewer voices again: the call stays where it is.
    expect((await h.call("GET", `/api/v1/calls/${callId}`, undefined, leader.token)).body.media).toBe("sfu");
    for (const other of [leader, ...others.slice(0, 7)])
      await h.call("POST", `/api/v1/calls/${callId}/leave`, {}, other.token);
    expect(asked.at(-1)).toMatchObject({ method: "DeleteRoom", body: { room: `call-${callId}` } });
    leaderHears.stop();
  });

  it("keeps a ninth voice out of the mesh without one", async () => {
    h = await harness();
    // A party never holds a ninth person without a media server, so the mesh call never has one.
    const leader = await h.user("leader@example.com");
    const party = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, leader.token);
    const call = await h.call("POST", "/api/v1/calls", { partyId: party.body.id }, leader.token);
    expect(call.body.call.media).toBe("mesh");
    expect(call.body.sfu).toBeNull();
  });
});
