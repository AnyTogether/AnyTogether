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
  return {
    heard,
    stop: () => events.disconnect(),
    of: (type: string) => heard.filter((e) => e.type === type),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const sessionOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).sid as string;

async function befriend(a: User, b: User) {
  await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
  await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A party led by the first, with the others in it. */
async function party(leader: User, ...others: User[]) {
  const made = await h.call("POST", "/api/v1/parties", {}, leader.token);
  const id = made.body.id as string;
  for (const other of others) {
    await befriend(leader, other);
    await h.call("POST", `/api/v1/parties/${id}/invites`, { userIds: [other.id] }, leader.token);
    await h.call("POST", `/api/v1/parties/${id}/join`, {}, other.token);
  }
  return id;
}

const lan = {
  kind: "lan",
  titleId: "PPSA17221",
  gameVersion: "01.044.000",
  engineBuild: "0.2.21-4194",
  capacity: 4,
};
const same = { gameVersion: lan.gameVersion, engineBuild: lan.engineBuild };

describe("play together", () => {
  it("the host starts a LAN game in the party, the party hears it and a member joins", async () => {
    const host = await h.user("host@example.com");
    const member = await h.user("member@example.com");
    const outsider = await h.user("outsider@example.com");
    const partyId = await party(host, member);
    await befriend(host, outsider);
    for (const user of [host, member])
      await h.valkey.set(`presence:${user.id}`, JSON.stringify({ state: "in_game" }), "EX", 60);

    const memberHears = await listen(member.id);
    const started = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      kind: "lan",
      partyId,
      titleId: lan.titleId,
      gameVersion: lan.gameVersion,
      engineBuild: lan.engineBuild,
      versionRule: "exact",
    });
    const id = started.body.id as string;
    await settle();
    expect(memberHears.of("game_session.started")[0]?.data).toMatchObject({
      partyId,
      session: { id, kind: "lan", host: { userId: host.id }, titleId: lan.titleId, ...same },
    });
    const partyView = memberHears.of("party.updated").at(-1)?.data as { together: unknown };
    expect(partyView.together).toMatchObject({
      sessionId: id,
      hostId: host.id,
      titleId: lan.titleId,
      players: [host.id],
      capacity: 4,
      ...same,
    });
    memberHears.stop();

    // Friends outside the party see "playing together" but cannot walk in.
    expect(JSON.parse((await h.valkey.get(`presence:${host.id}`)) ?? "{}").game).toMatchObject({
      sessionId: id,
      kind: "lan",
      hostId: host.id,
      joinable: false,
      players: 1,
      capacity: 4,
    });
    expect((await h.call("POST", `/api/v1/game-sessions/${id}/join`, same, outsider.token)).status).toBe(404);
    expect(
      (await h.call("POST", `/api/v1/game-sessions/${id}/invites`, { userIds: [outsider.id] }, host.token))
        .status,
    ).toBe(403);

    const hostHears = await listen(host.id);
    const joined = await h.call("POST", `/api/v1/game-sessions/${id}/join`, same, member.token);
    expect(joined.status).toBe(200);
    expect(joined.body.players.map((p: { userId: string }) => p.userId)).toEqual([host.id, member.id]);
    await settle();
    expect(hostHears.of("game_session.member_joined")[0]?.data).toMatchObject({
      sessionId: id,
      member: { userId: member.id },
    });
    hostHears.stop();
    // Both players show the session in their presence.
    expect(JSON.parse((await h.valkey.get(`presence:${member.id}`)) ?? "{}").game).toMatchObject({
      sessionId: id,
      kind: "lan",
      hostId: host.id,
      players: 2,
    });
    const mine = await h.call("GET", "/api/v1/me/party", undefined, member.token);
    expect(mine.body.party.together.players).toEqual([host.id, member.id]);
  });

  it("a different game version or engine is refused with the reason and who should update", async () => {
    const host = await h.user("v1@example.com");
    const member = await h.user("v2@example.com");
    await party(host, member);
    const { body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    const older = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, gameVersion: "01.008.000" },
      member.token,
    );
    expect(older.status).toBe(409);
    expect(older.body).toMatchObject({
      code: "version_mismatch",
      reason: "game_version",
      expected: "01.044.000",
      actual: "01.008.000",
      update: "you",
    });
    const newer = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, gameVersion: "01.050.000" },
      member.token,
    );
    expect(newer.body).toMatchObject({ reason: "game_version", update: "host" });
    const engine = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, engineBuild: "0.2.20-4100" },
      member.token,
    );
    expect(engine.body).toMatchObject({
      code: "version_mismatch",
      reason: "engine",
      expected: lan.engineBuild,
      actual: "0.2.20-4100",
    });
  });

  it("a major version rule lets patches of the same major version play together", async () => {
    const host = await h.user("m1@example.com");
    const member = await h.user("m2@example.com");
    await party(host, member);
    const { body } = await h.call(
      "POST",
      "/api/v1/game-sessions",
      { ...lan, versionRule: "major" },
      host.token,
    );
    expect(body.versionRule).toBe("major");
    const otherMajor = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, gameVersion: "02.000.000" },
      member.token,
    );
    expect(otherMajor.body.reason).toBe("game_version");
    const patch = await h.call(
      "POST",
      `/api/v1/game-sessions/${body.id}/join`,
      { ...same, gameVersion: "01.050.000" },
      member.token,
    );
    expect(patch.status).toBe(200);
  });

  it("one LAN game per party at a time", async () => {
    const host = await h.user("p1@example.com");
    const member = await h.user("p2@example.com");
    await party(host, member);
    const first = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    const second = await h.call("POST", "/api/v1/game-sessions", lan, member.token);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "conflict", sessionId: first.body.id });
  });

  it("ends with its host: leaving, the game exiting, or leaving the party", async () => {
    const host = await h.user("e1@example.com");
    const member = await h.user("e2@example.com");
    const partyId = await party(host, member);
    for (const user of [host, member])
      await h.valkey.set(`presence:${user.id}`, JSON.stringify({ state: "in_game" }), "EX", 60);

    // The host leaves: over for everyone.
    let { body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, member.token);
    let memberHears = await listen(member.id);
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/leave`, {}, host.token)).status).toBe(204);
    await settle();
    expect(memberHears.of("game_session.ended")[0]?.data).toEqual({
      sessionId: body.id,
      reason: "host_left",
    });
    memberHears.stop();
    expect(await h.valkey.hget(`presence-extra:${member.id}`, "game")).toBeNull();
    expect((await h.call("GET", "/api/v1/me/party", undefined, member.token)).body.party.together).toBeNull();

    // The host's game exits.
    ({ body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token));
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, member.token);
    memberHears = await listen(member.id);
    expect(
      (await h.call("DELETE", `/api/v1/game-sessions/${body.id}?reason=game_exited`, undefined, host.token))
        .status,
    ).toBe(204);
    await settle();
    expect(memberHears.of("game_session.ended")[0]?.data).toEqual({
      sessionId: body.id,
      reason: "game_exited",
    });
    memberHears.stop();

    // A member leaving the party leaves the game; the host leaving the party ends it.
    ({ body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token));
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, member.token);
    const hostHears = await listen(host.id);
    await h.call("POST", `/api/v1/parties/${partyId}/leave`, {}, member.token);
    await settle();
    expect(hostHears.of("game_session.member_left")[0]?.data).toEqual({
      sessionId: body.id,
      userId: member.id,
      reason: "left_party",
    });
    hostHears.stop();
    expect(await h.valkey.hget(`presence-extra:${member.id}`, "game")).toBeNull();
    await h.call("POST", `/api/v1/parties/${partyId}/leave`, {}, host.token);
    expect((await h.call("GET", "/api/v1/me/game-session", undefined, host.token)).body.session).toBeNull();
  });

  it("a host whose launcher went away past the grace ends the LAN game; a member's departure leaves it", async () => {
    const host = await h.user("g1@example.com");
    const member = await h.user("g2@example.com");
    await party(host, member);
    const { body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, member.token);
    const hostDevice = sessionOf(host.token);
    const memberDevice = sessionOf(member.token);
    expect(await h.valkey.smembers(`device-games:${memberDevice}`)).toEqual([body.id]);

    await h.valkey.zadd("game-departures", Date.now() - 1, `${member.id}:${memberDevice}`);
    expect(await h.app.sweepGames()).toBe(1);
    expect(
      (await h.call("GET", `/api/v1/game-sessions/${body.id}`, undefined, host.token)).body.players,
    ).toHaveLength(1);

    const memberHears = await listen(member.id);
    await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, member.token);
    await h.valkey.zadd("game-departures", Date.now() - 1, `${host.id}:${hostDevice}`);
    await h.app.sweepDepartures();
    await settle();
    expect(memberHears.of("game_session.ended")[0]?.data).toEqual({
      sessionId: body.id,
      reason: "host_gone",
    });
    memberHears.stop();
  });

  it("a join code lets someone outside the party in", async () => {
    const host = await h.user("j1@example.com");
    const member = await h.user("j2@example.com");
    const stranger = await h.user("j3@example.com");
    await party(host, member);
    const { body } = await h.call("POST", "/api/v1/game-sessions", lan, host.token);
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/code`, {}, member.token)).status).toBe(
      403,
    );
    const code = await h.call("POST", `/api/v1/game-sessions/${body.id}/code`, {}, host.token);
    expect(code.status).toBe(201);
    const looked = await h.call("GET", `/api/v1/join/${code.body.code}`, undefined, stranger.token);
    expect(looked.body).toMatchObject({
      kind: "game_session",
      id: body.id,
      host: { userId: host.id },
      size: 1,
      max: 4,
      state: "none",
    });
    const redeemed = await h.call("POST", `/api/v1/join/${code.body.code}`, {}, stranger.token);
    expect(redeemed.body).toMatchObject({ kind: "game_session", id: body.id, state: "invited" });
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, stranger.token)).status).toBe(
      200,
    );
    expect(
      (await h.call("GET", `/api/v1/game-sessions/${body.id}`, undefined, host.token)).body.joinCode.code,
    ).toBe(code.body.code);
    await h.call("DELETE", `/api/v1/game-sessions/${body.id}`, undefined, host.token);
    expect((await h.call("GET", `/api/v1/join/${code.body.code}`, undefined, stranger.token)).status).toBe(
      404,
    );
  });

  it("a local game shows in presence but nobody joins it over the network", async () => {
    const host = await h.user("l1@example.com");
    const friend = await h.user("l2@example.com");
    await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/game-sessions", { ...lan, kind: "local" }, host.token);
    expect(body.kind).toBe("local");
    const refused = await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token);
    expect(refused.status).toBe(404);
    expect(await h.valkey.hget(`presence-extra:${host.id}`, "game")).toContain('"kind":"local"');
  });

  it("online sessions keep working as before, kind online by default", async () => {
    const host = await h.user("o1@example.com");
    const friend = await h.user("o2@example.com");
    await befriend(host, friend);
    const { kind: _, ...online } = lan;
    const { body } = await h.call("POST", "/api/v1/game-sessions", online, host.token);
    expect(body).toMatchObject({ kind: "online", partyId: null });
    expect((await h.call("POST", `/api/v1/game-sessions/${body.id}/join`, same, friend.token)).status).toBe(
      200,
    );
  });

  it("answers 401 signed out", async () => {
    expect((await h.call("POST", "/api/v1/game-sessions", lan)).status).toBe(401);
    expect(
      (await h.call("POST", "/api/v1/game-sessions/00000000-0000-0000-0000-000000000000/code", {})).status,
    ).toBe(401);
  });
});
