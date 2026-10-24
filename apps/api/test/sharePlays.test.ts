import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness({
    turn: { secret: "relay-secret", urls: ["stun:relay.test:3478", "turn:relay.test:3478"] },
  });
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

async function befriend(a: User, b: User) {
  await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
  await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const game = { titleId: "PPSA01234", title: "Cat Quest III", maxViewers: 3 };
const sessionOf = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).sid;

describe("share play", () => {
  it("starts, shows in presence, a friend watches, gets a pad and gives it back", async () => {
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
    const started = await h.call("POST", "/api/v1/share-plays", game, host.token);
    expect(started.status).toBe(201);
    expect(started.body.sharePlay).toMatchObject({
      titleId: game.titleId,
      title: game.title,
      open: true,
      maxViewers: 3,
      viewers: [],
      invited: [],
      host: { userId: host.id },
      hostDevice: sessionOf(host.token),
    });
    expect(started.body.iceServers).toHaveLength(2);
    expect(started.body.iceServers[1].username).toMatch(new RegExp(`:${host.id}$`));
    const id = started.body.sharePlay.id as string;
    await settle();
    expect(friendHears.of("presence.updated").at(-1)?.data).toMatchObject({
      userId: host.id,
      share: {
        sharePlayId: id,
        titleId: game.titleId,
        title: game.title,
        open: true,
        viewers: 0,
        maxViewers: 3,
      },
    });
    friendHears.stop();

    const hostHears = await listen(host.id);
    const joined = await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token);
    expect(joined.status).toBe(201);
    expect(joined.body.sharePlay.invited).toBeUndefined();
    expect(joined.body.sharePlay.viewers).toMatchObject([
      { user: { userId: friend.id }, device: sessionOf(friend.token), slot: null },
    ]);
    expect(joined.body.iceServers[1].username).toMatch(new RegExp(`:${friend.id}$`));
    await settle();
    expect(hostHears.of("share_play.updated").at(-1)?.data).toMatchObject({
      id,
      viewers: [{ user: { userId: friend.id }, slot: null }],
    });
    expect(JSON.parse((await h.valkey.get(`presence:${host.id}`)) ?? "{}").share.viewers).toBe(1);
    expect(await h.valkey.smembers(`share-play:${id}:members`)).toEqual(
      expect.arrayContaining([host.id, friend.id]),
    );

    const viewerHears = await listen(friend.id);
    const granted = await h.call(
      "PUT",
      `/api/v1/share-plays/${id}/viewers/${friend.id}/slot`,
      { slot: 2 },
      host.token,
    );
    expect(granted.status).toBe(200);
    expect(granted.body.viewers[0].slot).toBe(2);
    await settle();
    expect(viewerHears.of("share_play.updated").at(-1)?.data).toMatchObject({ viewers: [{ slot: 2 }] });
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body).toMatchObject({
      hosting: null,
      watching: { id, viewers: [{ slot: 2 }] },
      invites: [],
    });
    const revoked = await h.call(
      "PUT",
      `/api/v1/share-plays/${id}/viewers/${friend.id}/slot`,
      { slot: null },
      host.token,
    );
    expect(revoked.body.viewers[0].slot).toBeNull();
    // Only the host hands out pads, and only 2-4.
    expect(
      (await h.call("PUT", `/api/v1/share-plays/${id}/viewers/${friend.id}/slot`, { slot: 2 }, friend.token))
        .status,
    ).toBe(403);
    expect(
      (await h.call("PUT", `/api/v1/share-plays/${id}/viewers/${friend.id}/slot`, { slot: 1 }, host.token))
        .status,
    ).toBe(400);
    hostHears.stop();
    viewerHears.stop();

    const ice = await h.call("GET", `/api/v1/share-plays/${id}/ice-servers`, undefined, friend.token);
    expect(ice.status).toBe(200);
    expect(ice.body.expiresAt).toBeTruthy();

    const left = await h.call("POST", `/api/v1/share-plays/${id}/leave`, {}, friend.token);
    expect(left.status).toBe(204);
    expect(await h.valkey.sismember(`share-play:${id}:members`, friend.id)).toBe(0);
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body.watching).toBeNull();
  });

  it("one viewer per pad, the host's limit, and joining again moves the seat and keeps the pad", async () => {
    const host = await h.user("h2@example.com");
    const a = await h.user("a2@example.com");
    const b = await h.user("b2@example.com");
    const c = await h.user("c2@example.com");
    for (const friend of [a, b, c]) await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 2 }, host.token);
    const id = body.sharePlay.id as string;
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, a.token)).status).toBe(201);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, b.token)).status).toBe(201);
    const full = await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, c.token);
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("full");
    expect(
      (await h.call("GET", "/api/v1/me/share-play", undefined, host.token)).body.hosting.viewers,
    ).toHaveLength(2);

    await h.call("PUT", `/api/v1/share-plays/${id}/viewers/${a.id}/slot`, { slot: 3 }, host.token);
    const clash = await h.call(
      "PUT",
      `/api/v1/share-plays/${id}/viewers/${b.id}/slot`,
      { slot: 3 },
      host.token,
    );
    expect(clash.status).toBe(409);
    expect(
      (await h.call("PUT", `/api/v1/share-plays/${id}/viewers/${b.id}/slot`, { slot: 2 }, host.token)).status,
    ).toBe(200);
    // Fewer seats than viewers is refused; more is fine.
    expect((await h.call("PATCH", `/api/v1/share-plays/${id}`, { maxViewers: 1 }, host.token)).status).toBe(
      409,
    );
    expect(
      (await h.call("PATCH", `/api/v1/share-plays/${id}`, { maxViewers: 4 }, host.token)).body.maxViewers,
    ).toBe(4);

    // a joins again from another device: the seat moves, player 3 stays theirs.
    const aPhone = await h.user("a2@example.com");
    expect(sessionOf(aPhone.token)).not.toBe(sessionOf(a.token));
    const again = await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, aPhone.token);
    expect(again.status).toBe(200);
    const seat = again.body.sharePlay.viewers.find(
      (v: { user: { userId: string } }) => v.user.userId === a.id,
    );
    expect(seat).toMatchObject({ slot: 3, device: sessionOf(aPhone.token) });
    expect(await h.valkey.smembers(`device-shares:${sessionOf(a.token)}`)).toEqual([]);
  });

  it("strangers see nothing, a closed share play needs an invite, and a removed viewer stays out", async () => {
    const host = await h.user("h3@example.com");
    const friend = await h.user("f3@example.com");
    const stranger = await h.user("s3@example.com");
    await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/share-plays", { ...game, open: false }, host.token);
    const id = body.sharePlay.id as string;
    expect((await h.call("GET", `/api/v1/share-plays/${id}`, undefined, stranger.token)).status).toBe(404);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, stranger.token)).status).toBe(404);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token)).status).toBe(404);
    expect(
      (await h.call("POST", `/api/v1/share-plays/${id}/invites`, { userIds: [stranger.id] }, host.token))
        .status,
    ).toBe(403);

    const friendHears = await listen(friend.id);
    const invited = await h.call(
      "POST",
      `/api/v1/share-plays/${id}/invites`,
      { userIds: [friend.id] },
      host.token,
    );
    expect(invited.body.invited).toEqual([friend.id]);
    await settle();
    expect(friendHears.of("share_play.invite")[0]?.data).toMatchObject({
      sharePlayId: id,
      from: { userId: host.id },
      titleId: game.titleId,
      title: game.title,
    });
    expect(
      (await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body.invites,
    ).toMatchObject([{ sharePlayId: id, from: { userId: host.id }, title: game.title }]);
    expect(
      (await h.call("GET", `/api/v1/share-plays/${id}`, undefined, host.token)).body.invited,
    ).toMatchObject([{ userId: friend.id }]);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token)).status).toBe(201);
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body.invites).toEqual([]);

    // Only the host invites, takes people out, or changes it.
    expect(
      (await h.call("DELETE", `/api/v1/share-plays/${id}/viewers/${friend.id}`, undefined, friend.token))
        .status,
    ).toBe(403);
    expect((await h.call("PATCH", `/api/v1/share-plays/${id}`, { open: true }, friend.token)).status).toBe(
      403,
    );

    const removed = await h.call(
      "DELETE",
      `/api/v1/share-plays/${id}/viewers/${friend.id}`,
      undefined,
      host.token,
    );
    expect(removed.status).toBe(204);
    await settle();
    expect(friendHears.of("share_play.ended").at(-1)?.data).toEqual({ sharePlayId: id, reason: "removed" });
    await h.call("PATCH", `/api/v1/share-plays/${id}`, { open: true }, host.token);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token)).status).toBe(404);
    // Invited again: back in.
    await h.call("POST", `/api/v1/share-plays/${id}/invites`, { userIds: [friend.id] }, host.token);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token)).status).toBe(201);
    friendHears.stop();
  });

  it("a declined invite goes, and blocking keeps a friend-of-before out", async () => {
    const host = await h.user("h4@example.com");
    const friend = await h.user("f4@example.com");
    await befriend(host, friend);
    const { body } = await h.call("POST", "/api/v1/share-plays", { ...game, open: false }, host.token);
    const id = body.sharePlay.id as string;
    await h.call("POST", `/api/v1/share-plays/${id}/invites`, { userIds: [friend.id] }, host.token);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/decline`, {}, friend.token)).status).toBe(204);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/decline`, {}, friend.token)).status).toBe(404);
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body.invites).toEqual([]);
    await h.call("POST", `/api/v1/share-plays/${id}/invites`, { userIds: [friend.id] }, host.token);
    await h.call("POST", "/api/v1/me/blocks", { userId: friend.id }, host.token);
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token)).status).toBe(404);
  });

  it("stopping ends it for everyone; starting again ends the old one", async () => {
    const host = await h.user("h5@example.com");
    const friend = await h.user("f5@example.com");
    const invitee = await h.user("i5@example.com");
    await befriend(host, friend);
    await befriend(host, invitee);
    const first = (await h.call("POST", "/api/v1/share-plays", game, host.token)).body.sharePlay.id as string;
    await h.call("POST", `/api/v1/share-plays/${first}/join`, {}, friend.token);
    await h.call("POST", `/api/v1/share-plays/${first}/invites`, { userIds: [invitee.id] }, host.token);
    const friendHears = await listen(friend.id);
    const inviteeHears = await listen(invitee.id);
    const second = (
      await h.call("POST", "/api/v1/share-plays", { ...game, titleId: "PPSA05678" }, host.token)
    ).body.sharePlay.id as string;
    expect(second).not.toBe(first);
    await settle();
    expect(friendHears.of("share_play.ended")[0]?.data).toEqual({ sharePlayId: first, reason: "ended" });
    expect(inviteeHears.of("share_play.ended")[0]?.data).toEqual({ sharePlayId: first, reason: "ended" });
    expect((await h.call("GET", `/api/v1/share-plays/${first}`, undefined, host.token)).status).toBe(404);
    expect(await h.valkey.exists(`share-play:${first}:members`)).toBe(0);
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, friend.token)).body.watching).toBeNull();
    expect(JSON.parse((await h.valkey.get(`presence:${host.id}`)) ?? "null")).toBeNull();

    expect((await h.call("DELETE", `/api/v1/share-plays/${second}`, undefined, host.token)).status).toBe(204);
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, host.token)).body.hosting).toBeNull();
    expect(await h.valkey.hget(`presence-extra:${host.id}`, "share")).toBeNull();
    friendHears.stop();
    inviteeHears.stop();
  });

  it("a device whose socket went is taken out after the grace: a viewer's seat goes, a host's share play ends", async () => {
    const host = await h.user("h6@example.com");
    const friend = await h.user("f6@example.com");
    await befriend(host, friend);
    const id = (await h.call("POST", "/api/v1/share-plays", game, host.token)).body.sharePlay.id as string;
    await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token);
    const friendDevice = sessionOf(friend.token);
    const hostDevice = sessionOf(host.token);
    expect(await h.valkey.smembers(`device-shares:${friendDevice}`)).toEqual([id]);

    // The viewer's socket went (the gateway notes it); the grace has passed and it is not back.
    await h.valkey.zadd("share-departures", Date.now() - 1, `${friend.id}:${friendDevice}`);
    expect(await h.app.sweepShares()).toBe(1);
    expect((await h.call("GET", `/api/v1/share-plays/${id}`, undefined, host.token)).body.viewers).toEqual(
      [],
    );

    // A device that came back stays in.
    await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, friend.token);
    await h.valkey.set(`presence:${friend.id}:${friendDevice}`, '{"state":"online"}', "EX", 60);
    await h.valkey.zadd("share-departures", Date.now() - 1, `${friend.id}:${friendDevice}`);
    await h.app.sweepDepartures();
    expect(
      (await h.call("GET", `/api/v1/share-plays/${id}`, undefined, host.token)).body.viewers,
    ).toHaveLength(1);

    const friendHears = await listen(friend.id);
    await h.valkey.zadd("share-departures", Date.now() - 1, `${host.id}:${hostDevice}`);
    await h.app.sweepShares();
    await settle();
    expect(friendHears.of("share_play.ended")[0]?.data).toEqual({ sharePlayId: id, reason: "ended" });
    expect((await h.call("GET", "/api/v1/me/share-play", undefined, host.token)).body.hosting).toBeNull();
    friendHears.stop();
  });

  it("checks what it is given", async () => {
    const host = await h.user("h7@example.com");
    expect((await h.call("POST", "/api/v1/share-plays", { titleId: "nope" }, host.token)).status).toBe(400);
    expect((await h.call("POST", "/api/v1/share-plays", { ...game, maxViewers: 5 }, host.token)).status).toBe(
      400,
    );
    expect((await h.call("GET", "/api/v1/share-plays/not-a-uuid", undefined, host.token)).status).toBe(404);
    const id = (await h.call("POST", "/api/v1/share-plays", { titleId: game.titleId }, host.token)).body
      .sharePlay.id as string;
    expect((await h.call("GET", `/api/v1/share-plays/${id}`, undefined, host.token)).body).toMatchObject({
      title: null,
      open: true,
      maxViewers: 2,
    });
    expect((await h.call("POST", `/api/v1/share-plays/${id}/join`, {}, host.token)).status).toBe(400);
    expect((await h.call("PATCH", `/api/v1/share-plays/${id}`, {}, host.token)).status).toBe(400);
    expect((await h.call("POST", "/api/v1/share-plays", game, undefined)).status).toBe(401);
  });
});
