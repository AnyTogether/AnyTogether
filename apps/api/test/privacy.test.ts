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
const v1 = "/api/v1";

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

describe("privacy", () => {
  it("shows friends everything and strangers only the card by default", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.privacy).toEqual({
      library: "friends",
      trophies: "friends",
      friends: "friends",
      presence: "friends",
      search: "everyone",
    });

    const seen = await h.call("GET", `${v1}/users/utku`, undefined, stranger.token);
    expect(seen.status).toBe(200);
    expect(seen.body.visible).toEqual({ library: false, trophies: false, friends: false, presence: false });
    expect(seen.body.presence).toBeUndefined();
    for (const part of ["library", "trophies", "friends"]) {
      const refused = await h.call("GET", `${v1}/users/utku/${part}`, undefined, stranger.token);
      expect(refused.status, part).toBe(403);
      expect(refused.body).toMatchObject({ code: "forbidden", section: part });
    }

    const friend = await h.call("GET", `${v1}/users/utku`, undefined, ayse.token);
    expect(friend.body.visible).toEqual({ library: true, trophies: true, friends: true, presence: true });
    expect(friend.body.presence).toEqual({ state: "offline" });
    for (const part of ["library", "trophies", "friends"])
      expect((await h.call("GET", `${v1}/users/utku/${part}`, undefined, ayse.token)).status, part).toBe(200);
    const list = await h.call("GET", `${v1}/users/utku/friends`, undefined, ayse.token);
    expect(list.body.friends.map((f: { handle: string }) => f.handle)).toEqual(["ayse"]);
  });

  it("opens a part to everyone, or closes it to friends while the owner still sees it", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    const changed = await setPrivacy(utku, { library: "everyone", trophies: "nobody" });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ library: "everyone", trophies: "nobody", friends: "friends" });

    expect((await h.call("GET", `${v1}/users/utku/library`, undefined, stranger.token)).status).toBe(200);
    await h.call(
      "POST",
      `${v1}/me/devices`,
      { id: "0192f0a0-0000-7000-8000-000000000001", platform: "macos", name: "Mac" },
      utku.token,
    );
    await h.call(
      "POST",
      `${v1}/me/sessions`,
      {
        sessions: [
          {
            id: "0192f0a0-0000-7000-8000-000000000002",
            titleId: "PPSA01234",
            deviceId: "0192f0a0-0000-7000-8000-000000000001",
            startedAt: new Date(Date.now() - 7_200_000).toISOString(),
            endedAt: new Date(Date.now() - 3_600_000).toISOString(),
          },
        ],
      },
      utku.token,
    );
    // With trophies closed, the open library leaves out what was earned.
    const games = (await h.call("GET", `${v1}/users/utku/library`, undefined, ayse.token)).body.games;
    expect(games[0]).toMatchObject({
      titleId: "PPSA01234",
      secondsPlayed: 3600,
      trophiesEarned: null,
      points: null,
    });
    const own = (await h.call("GET", `${v1}/users/utku/library`, undefined, utku.token)).body.games;
    expect(own[0]).toMatchObject({ trophiesEarned: 0, points: 0 });
    expect((await h.call("GET", `${v1}/users/utku/trophies`, undefined, ayse.token)).status).toBe(403);
    expect((await h.call("GET", `${v1}/users/utku/trophies`, undefined, utku.token)).status).toBe(200);
    const card = await h.call("GET", `${v1}/users/utku`, undefined, utku.token);
    expect(card.body.visible).toEqual({ library: true, trophies: true, friends: true, presence: true });

    expect((await setPrivacy(utku, { library: "public" })).status).toBe(400);
    expect((await setPrivacy(utku, { friends: "nobody" })).body.library).toBe("everyone");
  });

  it("leaves people out of a friends list whom the asker blocked", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const mert = await h.user("mert@example.com");
    await befriend(utku, ayse);
    await befriend(utku, mert);
    await h.call("POST", `${v1}/me/blocks`, { userId: mert.id }, ayse.token);
    const list = await h.call("GET", `${v1}/users/utku/friends`, undefined, ayse.token);
    expect(list.body.friends.map((f: { handle: string }) => f.handle)).toEqual(["ayse"]);
    const own = await h.call("GET", `${v1}/users/utku/friends`, undefined, utku.token);
    expect(own.body.friends).toHaveLength(2);
  });

  it("hides presence: friends see offline at once, the gateway is told, and back again", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await h.valkey.set(`presence:${utku.id}`, JSON.stringify({ state: "in_game", titleId: "PPSA01234" }));
    const playing = await h.call("GET", `${v1}/me/friends`, undefined, ayse.token);
    expect(playing.body.friends[0].presence.state).toBe("in_game");
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.presence.state).toBe(
      "in_game",
    );

    const ayseHears = await listen(ayse.id);
    await setPrivacy(utku, { presence: "nobody" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ayseHears.heard).toContainEqual(
      expect.objectContaining({ type: "presence.updated", data: { userId: utku.id, state: "offline" } }),
    );
    ayseHears.stop();
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");
    // Even if something kept a presence, the API does not show it.
    await h.valkey.set(`presence:${utku.id}`, JSON.stringify({ state: "online" }));
    expect((await h.call("GET", `${v1}/me/friends`, undefined, ayse.token)).body.friends[0].presence).toEqual(
      {
        state: "offline",
      },
    );
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.presence).toBeUndefined();

    // A Valkey that forgot is told again at the next refresh.
    await h.valkey.flushdb();
    await h.call("POST", `${v1}/auth/email/start`, { email: "utku@example.com" });
    await h.call("POST", `${v1}/auth/email/verify`, {
      email: "utku@example.com",
      code: h.mailer.lastCode("utku@example.com"),
    });
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");

    await setPrivacy(utku, { presence: "friends" });
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBeNull();
  });

  it("lets people choose who finds them by name", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    const find = async (who: User) =>
      (await h.call("GET", `${v1}/users/search?q=utk`, undefined, who.token)).body.users.length;
    expect(await find(stranger)).toBe(1);
    await setPrivacy(utku, { search: "friends" });
    expect(await find(stranger)).toBe(0);
    expect(await find(ayse)).toBe(1);
    await setPrivacy(utku, { search: "nobody" });
    expect(await find(ayse)).toBe(0);
    // The exact handle still works for a friend request.
    const asked = await h.call("POST", `${v1}/me/friends/requests`, { handle: "utku" }, stranger.token);
    expect(asked.status).toBe(201);
  });

  it("tells friends about new trophies only when trophies are not hidden", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await h.call(
      "PUT",
      `${v1}/trophy-sets/PPSA01234/abc123`,
      {
        trophies: [
          { id: 0, grade: "bronze", texts: { en: { name: "First" } } },
          { id: 1, grade: "silver", texts: { en: { name: "Second" } } },
        ],
      },
      utku.token,
    );
    const earn = (trophyId: number) =>
      h.call(
        "POST",
        `${v1}/me/trophies`,
        {
          trophies: [
            { titleId: "PPSA01234", setHash: "abc123", trophyId, earnedAt: new Date().toISOString() },
          ],
        },
        utku.token,
      );
    const ayseHears = await listen(ayse.id);
    await earn(0);
    await setPrivacy(utku, { trophies: "nobody" });
    await earn(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const told = ayseHears.heard
      .filter((event) => event.type === "trophy.earned")
      .map((e) => e.data.trophyId);
    expect(told).toEqual([0]);
    ayseHears.stop();
  });
});
