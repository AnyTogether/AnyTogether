import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness({ publicProfiles: true });
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const game = "PPSA01234";
const set = "a1b2c3d4e5f6";
/** No Authorization header: a link preview, or someone who is not signed in. */
const signedOut = async (path: string, ip = "203.0.113.7") => {
  const response = await h.app.request(`${v1}${path}`, { headers: { "cf-connecting-ip": ip } });
  return { status: response.status, body: await response.json() };
};

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

async function playAndEarn(user: User) {
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "First steps" } } },
        { id: 1, grade: "gold", hidden: true, texts: { en: { name: "The twist" } } },
        { id: 2, grade: "platinum", texts: { en: { name: "Everything" } } },
      ],
    },
    user.token,
  );
  const deviceId = uuidv7();
  await h.call("POST", `${v1}/me/devices`, { id: deviceId, platform: "macos", name: "MacBook" }, user.token);
  await h.call(
    "POST",
    `${v1}/me/sessions`,
    {
      sessions: [
        {
          id: uuidv7(),
          titleId: game,
          deviceId,
          startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          endedAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    },
    user.token,
  );
  await h.call(
    "POST",
    `${v1}/me/trophies`,
    {
      trophies: [0, 1].map((trophyId) => ({
        titleId: game,
        setHash: set,
        trophyId,
        earnedAt: new Date().toISOString(),
      })),
    },
    user.token,
  );
}

describe("public profiles", () => {
  it("shows the card to anyone, and nothing that is not open to everyone", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await playAndEarn(utku);
    await h.call("PATCH", `${v1}/me/profile`, { bio: "Platinums only", country: "TR" }, utku.token);

    const card = await signedOut("/users/utku");
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({
      handle: "utku",
      bio: "Platinums only",
      country: "TR",
      friendship: "none",
      signedIn: false,
      visible: { library: false, trophies: false, friends: false, presence: false },
    });
    expect(card.body.trophyCounts).toBeUndefined();
    expect(card.body.presence).toBeUndefined();
    // Nothing that tells who the account is beyond its handle.
    expect(JSON.stringify(card.body)).not.toContain(utku.id);
    expect(JSON.stringify(card.body)).not.toContain("@example.com");

    for (const part of ["library", "trophies"]) {
      const refused = await signedOut(`/users/utku/${part}`);
      expect(refused.status, part).toBe(403);
      expect(refused.body).toMatchObject({ code: "forbidden", section: part });
    }
    // Friends-only items stay out of the activity; the friends list needs a sign-in.
    expect((await signedOut("/users/utku/activity")).body.items).toEqual([]);
    expect((await signedOut("/users/utku/friends")).status).toBe(401);
    expect((await signedOut("/users/search?q=ut")).status).toBe(401);
    expect((await signedOut("/users/nobody-here")).status).toBe(404);
  });

  it("opens the library, trophies and activity once they are open to everyone", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await playAndEarn(utku);
    await h.call("PATCH", `${v1}/me/privacy`, { library: "everyone", trophies: "everyone" }, utku.token);

    const card = await signedOut("/users/utku");
    expect(card.body.visible).toEqual({ library: true, trophies: true, friends: false, presence: false });
    expect(card.body.trophyCounts).toEqual({
      bronze: 1,
      silver: 0,
      gold: 1,
      platinum: 0,
      total: 2,
      points: 105,
    });

    const library = await signedOut("/users/utku/library");
    expect(library.status).toBe(200);
    expect(library.body.games).toHaveLength(1);
    expect(library.body.games[0]).toMatchObject({ titleId: game, trophiesEarned: 2, points: 105 });
    // The computers a game was played on are the owner's alone.
    expect(library.body.games[0].devices).toBeUndefined();

    const trophies = await signedOut("/users/utku/trophies");
    expect(trophies.body.trophies).toHaveLength(2);
    // A hidden trophy keeps its texts from a reader who has not earned it.
    expect(trophies.body.trophies.find((t: { trophyId: number }) => t.trophyId === 1).texts).toBeNull();
    expect((await signedOut(`/users/utku/trophies?titleId=${game}`)).body.trophies).toHaveLength(3);
    expect((await signedOut("/users/utku/trophies?titleId=nope")).status).toBe(400);

    const activity = await signedOut("/users/utku/activity");
    expect(activity.body.items.length).toBeGreaterThan(0);
    expect(activity.body.items.map((i: { kind: string }) => i.kind)).not.toContain("friendship");
    expect(JSON.stringify(activity.body)).not.toContain(utku.id);
    expect(activity.body.items[0].actor).toMatchObject({ handle: "utku" });

    // Ayşe opens her friends list to everyone: the friendship item shows, still without IDs.
    await h.call("PATCH", `${v1}/me/privacy`, { friends: "everyone" }, utku.token);
    await h.call("PATCH", `${v1}/me/privacy`, { friends: "everyone" }, ayse.token);
    const both = await signedOut("/users/utku/activity");
    const friendship = both.body.items.find((i: { kind: string }) => i.kind === "friendship");
    expect(friendship.friend).toEqual({ handle: "ayse", displayName: expect.any(String), avatar: null });
  });

  it("leaves signed-in reads as they were, hides banned accounts and limits each address", async () => {
    await h.close();
    h = await harness({ publicProfiles: true, limits: { publicProfile: { max: 3, seconds: 60 } } });
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const seen = await h.call("GET", `${v1}/users/utku`, undefined, ayse.token);
    expect(seen.body).toMatchObject({ userId: utku.id, friendship: "none" });
    expect(seen.body.signedIn).toBeUndefined();
    // A bad token is still refused, not read as signed out.
    expect((await h.call("GET", `${v1}/users/utku`, undefined, "not-a-token")).status).toBe(401);

    expect((await signedOut("/users/utku", "198.51.100.1")).status).toBe(200);
    expect((await signedOut("/users/utku", "198.51.100.1")).status).toBe(200);
    expect((await signedOut("/users/utku", "198.51.100.1")).status).toBe(200);
    expect((await signedOut("/users/utku", "198.51.100.1")).status).toBe(429);
    expect((await signedOut("/users/utku", "198.51.100.2")).status).toBe(200);

    await run(["ban", "@utku"], h.deps);
    expect((await signedOut("/users/utku", "198.51.100.3")).status).toBe(404);
  });
});
