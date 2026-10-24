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

describe("parties", () => {
  it("invite a friend, who is told, joins, and both see the party", async () => {
    const leader = await h.user("lead@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(leader, friend);
    const made = await h.call("POST", "/api/v1/parties", {}, leader.token);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ leaderId: leader.id, privacy: "invite", call: null });
    const id = made.body.id as string;

    const friendHears = await listen(friend.id);
    const invited = await h.call(
      "POST",
      `/api/v1/parties/${id}/invites`,
      { userIds: [friend.id] },
      leader.token,
    );
    expect(invited.body.invited.map((p: { userId: string }) => p.userId)).toEqual([friend.id]);
    await settle();
    expect(friendHears.heard.find((e) => e.type === "party.invite")?.data).toMatchObject({
      partyId: id,
      size: 1,
      from: { handle: "lead" },
    });
    friendHears.stop();
    const waiting = await h.call("GET", "/api/v1/me/party", undefined, friend.token);
    expect(waiting.body).toMatchObject({ party: null, invites: [{ partyId: id, size: 1 }] });

    const leaderHears = await listen(leader.id);
    const joined = await h.call("POST", `/api/v1/parties/${id}/join`, {}, friend.token);
    expect(joined.status).toBe(200);
    expect(joined.body.members.map((m: { userId: string }) => m.userId)).toEqual([leader.id, friend.id]);
    expect(joined.body.invited).toEqual([]);
    await settle();
    expect(leaderHears.heard.find((e) => e.type === "party.member_joined")?.data).toMatchObject({
      partyId: id,
      member: { userId: friend.id },
    });
    leaderHears.stop();
    expect(
      (await h.call("GET", "/api/v1/me/party", undefined, leader.token)).body.party.members,
    ).toHaveLength(2);
  });

  it("refuse strangers: no invite for non-friends, no walking into an invite-only party", async () => {
    const leader = await h.user("l2@example.com");
    const stranger = await h.user("s2@example.com");
    const { body } = await h.call("POST", "/api/v1/parties", {}, leader.token);
    expect(
      (await h.call("POST", `/api/v1/parties/${body.id}/invites`, { userIds: [stranger.id] }, leader.token))
        .status,
    ).toBe(403);
    expect((await h.call("POST", `/api/v1/parties/${body.id}/join`, {}, stranger.token)).status).toBe(404);
    expect((await h.call("GET", `/api/v1/parties/${body.id}`, undefined, stranger.token)).status).toBe(404);
  });

  it("an open party lets the leader's friends in, up to eight", async () => {
    const leader = await h.user("open@example.com");
    const { body } = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, leader.token);
    const friends: User[] = [];
    for (let i = 0; i < 8; i++) {
      const friend = await h.user(`f${i}@example.com`);
      await befriend(leader, friend);
      friends.push(friend);
    }
    for (const friend of friends.slice(0, 7))
      expect((await h.call("POST", `/api/v1/parties/${body.id}/join`, {}, friend.token)).status).toBe(200);
    const ninth = await h.call("POST", `/api/v1/parties/${body.id}/join`, {}, (friends[7] as User).token);
    expect(ninth.status).toBe(409);
    expect(ninth.body.code).toBe("full");
  });

  it("the leader kicks and hands over; the last one out ends it", async () => {
    const a = await h.user("k1@example.com");
    const b = await h.user("k2@example.com");
    const c = await h.user("k3@example.com");
    await befriend(a, b);
    await befriend(a, c);
    const { body } = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    const id = body.id as string;
    await h.call("POST", `/api/v1/parties/${id}/join`, {}, b.token);
    await h.call("POST", `/api/v1/parties/${id}/join`, {}, c.token);

    expect((await h.call("POST", `/api/v1/parties/${id}/kick`, { userId: c.id }, b.token)).status).toBe(403);
    const cHears = await listen(c.id);
    expect((await h.call("POST", `/api/v1/parties/${id}/kick`, { userId: c.id }, a.token)).status).toBe(204);
    await settle();
    expect(cHears.heard.find((e) => e.type === "party.member_left")?.data).toMatchObject({
      userId: c.id,
      reason: "kicked",
    });
    cHears.stop();
    expect((await h.call("GET", "/api/v1/me/party", undefined, c.token)).body.party).toBeNull();

    const handed = await h.call("POST", `/api/v1/parties/${id}/leader`, { userId: b.id }, a.token);
    expect(handed.body.leaderId).toBe(b.id);
    // The leader leaves: the next member leads.
    await h.call("POST", `/api/v1/parties/${id}/leave`, {}, b.token);
    expect((await h.call("GET", `/api/v1/parties/${id}`, undefined, a.token)).body.leaderId).toBe(a.id);
    const aHears = await listen(a.id);
    await h.call("POST", `/api/v1/parties/${id}/leave`, {}, a.token);
    await settle();
    expect(aHears.heard.some((e) => e.type === "party.ended")).toBe(true);
    aHears.stop();
    expect((await h.call("GET", `/api/v1/parties/${id}`, undefined, a.token)).status).toBe(404);
  });

  it("joining another party leaves the first", async () => {
    const a = await h.user("m1@example.com");
    const b = await h.user("m2@example.com");
    await befriend(a, b);
    const first = await h.call("POST", "/api/v1/parties", {}, a.token);
    await h.call("POST", `/api/v1/parties/${first.body.id}/invites`, { userIds: [b.id] }, a.token);
    await h.call("POST", `/api/v1/parties/${first.body.id}/join`, {}, b.token);
    const second = await h.call("POST", "/api/v1/parties", {}, b.token);
    expect((await h.call("GET", "/api/v1/me/party", undefined, b.token)).body.party.id).toBe(second.body.id);
    expect(
      (await h.call("GET", `/api/v1/parties/${first.body.id}`, undefined, a.token)).body.members,
    ).toHaveLength(1);
  });

  it("someone blocked by a member cannot join", async () => {
    const a = await h.user("bl1@example.com");
    const b = await h.user("bl2@example.com");
    const c = await h.user("bl3@example.com");
    await befriend(a, b);
    await befriend(a, c);
    const { body } = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    await h.call("POST", `/api/v1/parties/${body.id}/join`, {}, b.token);
    await h.call("POST", "/api/v1/me/blocks", { userId: c.id }, b.token);
    expect((await h.call("POST", `/api/v1/parties/${body.id}/join`, {}, c.token)).status).toBe(403);
  });

  it("friends see the party in presence while its members are online", async () => {
    const a = await h.user("pr1@example.com");
    const b = await h.user("pr2@example.com");
    await befriend(a, b);
    await h.valkey.set(`presence:${a.id}`, JSON.stringify({ state: "online" }), "EX", 60);
    const bHears = await listen(b.id);
    const { body } = await h.call("POST", "/api/v1/parties", { privacy: "friends" }, a.token);
    await settle();
    const told = bHears.heard.find((e) => e.type === "presence.updated");
    expect(told?.data).toMatchObject({
      userId: a.id,
      state: "online",
      party: { id: body.id, size: 1, open: true },
    });
    const friends = await h.call("GET", "/api/v1/me/friends", undefined, b.token);
    expect(friends.body.friends[0].presence.party).toMatchObject({ id: body.id, max: 8 });
    expect(await h.valkey.ttl(`presence:${a.id}`)).toBeGreaterThan(50);
    await h.call("POST", `/api/v1/parties/${body.id}/leave`, {}, a.token);
    await settle();
    expect(JSON.parse((await h.valkey.get(`presence:${a.id}`)) ?? "{}")).toEqual({ state: "online" });
    bHears.stop();
  });
});
