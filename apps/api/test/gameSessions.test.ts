import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
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

const game = {
  titleId: "PPSA01234",
  gameVersion: "01.002",
  engineBuild: "0.2.13-4194",
  capacity: 4,
  properties: { lobby: "abc", region: "eu", nested: { slots: [1, 2] } },
};
const same = { gameVersion: game.gameVersion, engineBuild: game.engineBuild };

describe("game sessions", () => {
  it("open for a game, show joinable to friends, invite, and the joiner gets the details", async () => {
    const host = await h.user("host@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(host, friend);
    await h.valkey.set(
      `presence:${host.id}`,
      JSON.stringify({ state: "in_game", titleId: game.titleId }),
      "EX",
      60,
    );
    const friendHears = await listen(friend.id);
    const opened = await h.call("POST", "/api/v1/game-sessions", game, host.token);
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({
      titleId: game.titleId,
      joinable: true,
      capacity: 4,
      properties: game.properties,
    });
    expect(opened.body.players.map((p: { userId: string }) => p.userId)).toEqual([host.id]);
    const id = opened.body.id as string;
    await settle();
    expect(friendHears.heard.find((e) => e.type === "presence.updated")?.data).toMatchObject({
      userId: host.id,
      state: "in_game",
      game: { sessionId: id, titleId: game.titleId, joinable: true, players: 1, capacity: 4 },
    });

    await h.call("POST", `/api/v1/game-sessions/${id}/invites`, { userIds: [friend.id] }, host.token);
    await settle();
    expect(friendHears.heard.find((e) => e.type === "game_session.invite")?.data).toMatchObject({
      sessionId: id,
      from: { userId: host.id },
      ...same,
    });
    friendHears.stop();
    expect(
      (await h.call("GET", "/api/v1/me/game-session", undefined, friend.token)).body.invites,
    ).toHaveLength(1);

    const hostHears = await listen(host.id);
    const joined = await h.call("POST", `/api/v1/game-sessions/${id}/join`, same, friend.token);
    expect(joined.status).toBe(200);
    expect(joined.body.properties).toEqual(game.properties);
    expect(joined.body.players.map((p: { userId: string }) => p.userId)).toEqual([host.id, friend.id]);
    await settle();
    expect(hostHears.heard.find((e) => e.type === "game_session.updated")?.data).toMatchObject({ id });
    hostHears.stop();
    expect(JSON.parse((await h.valkey.get(`presence:${host.id}`)) ?? "{}").game.players).toBe(2);
    expect((await h.call("GET", "/api/v1/me/game-session", undefined, friend.token)).body).toMatchObject({
      session: { id },
      invites: [],
    });
  });

  it("only the same game version and engine build may join", async () => {
    const host = await h.user("v1@example.com");
    const friend = await h.user("v2@example.com");
    await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/game-sessions", game, host.token);
    const older = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, gameVersion: "01.001" },
      friend.token,
    );
    expect(older.status).toBe(409);
    expect(older.body.code).toBe("version_mismatch");
    const otherBuild = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, engineBuild: "0.2.12" },
      friend.token,
    );
    expect(otherBuild.body.code).toBe("version_mismatch");
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token)).status).toBe(
      200,
    );
  });

  it("keeps strangers out of a joinable game and friends out of a closed one unless invited", async () => {
    const host = await h.user("c1@example.com");
    const friend = await h.user("c2@example.com");
    const stranger = await h.user("c3@example.com");
    await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/game-sessions", { ...game, joinable: false }, host.token);
    expect((await h.call("GET", `/api/v1/game-sessions/${body.id}`, undefined, stranger.token)).status).toBe(
      404,
    );
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token)).status).toBe(
      404,
    );
    expect(
      (
        await h.call(
          "POST",
          `/api/v1/game-sessions/${body.id}/invites`,
          { userIds: [stranger.id] },
          host.token,
        )
      ).status,
    ).toBe(403);
    await h.call("POST", `/api/v1/game-sessions/${body.id}/invites`, { userIds: [friend.id] }, host.token);
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/decline`, {}, friend.token)).status).toBe(
      204,
    );
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token)).status).toBe(
      404,
    );
    await h.call("POST", `/api/v1/game-sessions/${body.id}/invites`, { userIds: [friend.id] }, host.token);
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token)).status).toBe(
      200,
    );
  });

  it("fills up, and the host closes it for everyone", async () => {
    const host = await h.user("f0@example.com");
    const a = await h.user("f1@example.com");
    const b = await h.user("f2@example.com");
    await befriend(host, a);
    await befriend(host, b);
    const { body } = await h.call("POST", "/api/v1/game-sessions", { ...game, capacity: 2 }, host.token);
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, a.token);
    // Full: no longer joinable in presence, and a third is refused.
    expect((await h.call("GET", `/api/v1/game-sessions/${body.id}`, undefined, b.token)).status).toBe(200);
    const third = await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, b.token);
    expect(third.body.code).toBe("full");
    expect(
      (
        await h.call(
          "PATCH",
          `/api/v1/game-sessions/${body.id}`,
          { capacity: 3, properties: { round: 2 } },
          a.token,
        )
      ).status,
    ).toBe(403);
    const grown = await h.call(
      "PATCH",
      `/api/v1/game-sessions/${body.id}`,
      { capacity: 3, properties: { round: 2 } },
      host.token,
    );
    expect(grown.body).toMatchObject({ capacity: 3, properties: { round: 2 } });

    const aHears = await listen(a.id);
    expect((await h.call("DELETE", `/api/v1/game-sessions/${body.id}`, undefined, host.token)).status).toBe(
      204,
    );
    await settle();
    expect(aHears.heard.some((e) => e.type === "game_session.ended")).toBe(true);
    aHears.stop();
    expect((await h.call("GET", "/api/v1/me/game-session", undefined, a.token)).body.session).toBeNull();
    expect(await h.valkey.hget(`presence-extra:${host.id}`, "game")).toBeNull();
  });

  it("opening another session ends the first; a player leaving keeps it going", async () => {
    const host = await h.user("o1@example.com");
    const a = await h.user("o2@example.com");
    await befriend(host, a);
    const first = await h.call("POST", "/api/v1/game-sessions", game, host.token);
    await h.call("POST", `/api/v1/game-sessions/${first.body.id}/join`, same, a.token);
    expect((await h.call("POST", `/api/v1/game-sessions/${first.body.id}/leave`, {}, a.token)).status).toBe(
      204,
    );
    expect(
      (await h.call("GET", `/api/v1/game-sessions/${first.body.id}`, undefined, host.token)).body.players,
    ).toHaveLength(1);
    const second = await h.call(
      "POST",
      "/api/v1/game-sessions",
      { ...game, titleId: "CUSA00001" },
      host.token,
    );
    expect(second.status).toBe(201);
    expect(
      (await h.call("GET", `/api/v1/game-sessions/${first.body.id}`, undefined, host.token)).status,
    ).toBe(404);
  });

  it("refuses bad input and oversized properties", async () => {
    const host = await h.user("bad@example.com");
    expect(
      (await h.call("POST", "/api/v1/game-sessions", { ...game, titleId: "nope" }, host.token)).status,
    ).toBe(400);
    expect((await h.call("POST", "/api/v1/game-sessions", { ...game, capacity: 1 }, host.token)).status).toBe(
      400,
    );
    expect(
      (
        await h.call(
          "POST",
          "/api/v1/game-sessions",
          { ...game, properties: { blob: "x".repeat(5000) } },
          host.token,
        )
      ).status,
    ).toBe(400);
  });
});

describe("online play between players", () => {
  /** The session ID inside an access token, which the gateway calls the device. */
  const deviceOf = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString()).sid as string;

  it("lets each player publish their own properties, seen only by the players, and signal", async () => {
    await h.close();
    h = await harness({ turn: { secret: "s", urls: ["stun:relay.test:3478", "turn:relay.test:3478"] } });
    const host = await h.user("oh@example.com");
    const guest = await h.user("og@example.com");
    const onlooker = await h.user("oo@example.com");
    await befriend(host, guest);
    await befriend(host, onlooker);
    const { body: opened } = await h.call("POST", "/api/v1/game-sessions", game, host.token);
    const id = opened.id as string;
    expect(opened.members).toEqual([
      { userId: host.id, device: null, properties: {}, joinedAt: expect.any(String), updatedAt: null },
    ]);
    expect(await h.valkey.smembers(`game-session:${id}:members`)).toEqual([host.id]);
    await h.call("POST", `/api/v1/game-sessions/${id}/join`, same, guest.token);
    expect((await h.valkey.smembers(`game-session:${id}:members`)).sort()).toEqual(
      [host.id, guest.id].sort(),
    );

    const guestHears = await listen(guest.id);
    const endpoint = { endpoints: ["192.0.2.10:49152"], key: "bm90LWEtcmVhbC1rZXk", v: 1 };
    const put = await h.call(
      "PUT",
      `/api/v1/game-sessions/${id}/members/me`,
      { properties: endpoint },
      host.token,
    );
    expect(put.status).toBe(200);
    expect(put.body.members[0]).toMatchObject({
      userId: host.id,
      device: deviceOf(host.token),
      properties: endpoint,
      updatedAt: expect.any(String),
    });
    await settle();
    const told = guestHears.heard.filter((e) => e.type === "game_session.updated").at(-1);
    expect((told?.data as { members: unknown[] }).members).toEqual([
      expect.objectContaining({ userId: host.id, properties: endpoint }),
      expect.objectContaining({ userId: guest.id, properties: {}, device: null }),
    ]);
    guestHears.stop();

    // The players see who published what; a friend who may only look does not.
    const seen = await h.call("GET", `/api/v1/game-sessions/${id}`, undefined, guest.token);
    expect(seen.body.members.map((m: { userId: string }) => m.userId)).toEqual([host.id, guest.id]);
    const looked = await h.call("GET", `/api/v1/game-sessions/${id}`, undefined, onlooker.token);
    expect(looked.status).toBe(200);
    expect(looked.body.members).toBeUndefined();
    expect(JSON.stringify(looked.body)).not.toContain("192.0.2.10");
    expect(
      (await h.call("PUT", `/api/v1/game-sessions/${id}/members/me`, { properties: {} }, onlooker.token))
        .status,
    ).toBe(403);
    const big = await h.call(
      "PUT",
      `/api/v1/game-sessions/${id}/members/me`,
      { properties: { blob: "x".repeat(2100) } },
      guest.token,
    );
    expect(big.status).toBe(400);
    expect((await h.call("PUT", `/api/v1/game-sessions/${id}/members/me`, {}, guest.token)).status).toBe(400);

    // Relay credentials for the players, as calls get them.
    const ice = await h.call("GET", `/api/v1/game-sessions/${id}/ice-servers`, undefined, guest.token);
    expect(ice.status).toBe(200);
    expect(ice.body.iceServers[1]).toMatchObject({ urls: ["turn:relay.test:3478"] });
    expect(ice.body.iceServers[1].username).toMatch(new RegExp(`:${guest.id}$`));
    expect(
      (await h.call("GET", `/api/v1/game-sessions/${id}/ice-servers`, undefined, onlooker.token)).status,
    ).toBe(403);

    // A player who leaves takes their properties along and can no longer signal.
    await h.call("PUT", `/api/v1/game-sessions/${id}/members/me`, { properties: { a: 1 } }, guest.token);
    await h.call("POST", `/api/v1/game-sessions/${id}/leave`, {}, guest.token);
    expect(await h.valkey.hexists(`game-session:${id}:properties`, guest.id)).toBe(0);
    expect(await h.valkey.smembers(`game-session:${id}:members`)).toEqual([host.id]);
    await h.call("DELETE", `/api/v1/game-sessions/${id}`, undefined, host.token);
    expect(await h.valkey.exists(`game-session:${id}:members`, `game-session:${id}:properties`)).toBe(0);
  });
});
