import { readFileSync } from "node:fs";
import { profiles } from "@anytogether/db";
import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
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
const game = "PPSA01234";
const set = "a1b2c3d4e5f6";
const everything = {
  library: "everyone",
  trophies: "everyone",
  friends: "everyone",
  presence: "everyone",
  gallery: "everyone",
};

const signedOut = async (path: string) => {
  const response = await h.app.request(`${v1}${path}`, { headers: { "cf-connecting-ip": "203.0.113.9" } });
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("cache-control"),
  };
};
const as = (user: User | undefined, path: string) =>
  user ? h.call("GET", `${v1}${path}`, undefined, user.token) : signedOut(path);
const setPublic = (user: User, publicProfile: boolean) =>
  h.call("PATCH", `${v1}/me/public-profile`, { publicProfile }, user.token);

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** Someone who opened every part to everyone, wrote a bio, plays a game and earned a trophy. */
async function openBook(email: string) {
  const user = await h.user(email);
  await h.call("PATCH", `${v1}/me/profile`, { bio: "Speedruns on weekends", country: "TR" }, user.token);
  await h.call("PATCH", `${v1}/me/privacy`, everything, user.token);
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
    { trophies: [{ id: 0, grade: "gold", texts: { en: { name: "First steps" } } }] },
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
          startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          endedAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    },
    user.token,
  );
  await h.call(
    "POST",
    `${v1}/me/trophies`,
    { trophies: [{ titleId: game, setHash: set, trophyId: 0, earnedAt: new Date().toISOString() }] },
    user.token,
  );
  return user;
}

const parts = ["library", "trophies", "friends", "activity", "showcase"];

describe("the public profile switch", () => {
  it("starts off for a new account, is shown on /me and in the export, and is set with a boolean", async () => {
    const mira = await h.user("mira@example.com");
    expect((await h.call("GET", `${v1}/me`, undefined, mira.token)).body.profile.publicProfile).toBe(false);
    expect((await setPublic(mira, true)).body).toEqual({ publicProfile: true });
    expect((await h.call("GET", `${v1}/me`, undefined, mira.token)).body.profile.publicProfile).toBe(true);
    const exported = await h.call("GET", `${v1}/me/export`, undefined, mira.token);
    if (exported.status === 200) expect(exported.body.profile.publicProfile).toBe(true);
    expect(
      (await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: "yes" }, mira.token)).status,
    ).toBe(400);
    expect((await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: true })).status).toBe(401);
    expect((await setPublic(mira, false)).body).toEqual({ publicProfile: false });
  });

  it("off: a signed-out visitor gets the minimal card and no part, even ones set to everyone", async () => {
    const utku = await openBook("utku@example.com");
    const card = await signedOut(`/users/${utku.handle}`);
    expect(card.status).toBe(200);
    expect(card.body).toEqual({
      handle: utku.handle,
      displayName: expect.any(String),
      avatar: null,
      friendship: "none",
      signedIn: false,
      bio: null,
      country: null,
      publicProfile: false,
      visible: { library: false, trophies: false, friends: false, presence: false },
      connections: [],
      trophyLevel: null,
      cover: null,
      accent: null,
    });
    expect(card.cache).toBe("private, no-store");
    for (const part of parts) {
      const answer = await signedOut(`/users/${utku.handle}/${part}`);
      // The friends list is never read signed out (401); a part set to everyone counts as
      // friends-only (403 for that part); the rest are closed with the profile.
      if (part === "friends") {
        expect(answer.status, part).toBe(401);
        continue;
      }
      expect(answer.status, part).toBe(403);
      expect(["profile", part], part).toContain(answer.body.section);
    }
  });

  it("on: a signed-out visitor sees what is open to everyone, as before", async () => {
    const utku = await openBook("utku@example.com");
    await setPublic(utku, true);
    const card = await signedOut(`/users/${utku.handle}`);
    expect(card.body).toMatchObject({ bio: "Speedruns on weekends", country: "TR", publicProfile: true });
    expect(card.body.visible).toMatchObject({ library: true, trophies: true });
    expect(card.body.trophyCounts.total).toBe(1);
    const library = await signedOut(`/users/${utku.handle}/library`);
    expect(library.status).toBe(200);
    expect(library.body.games.map((g: { titleId: string }) => g.titleId)).toEqual([game]);
    expect((await signedOut(`/users/${utku.handle}/trophies`)).status).toBe(200);
  });

  it("off: a signed-in stranger and a pending request get the minimal card; a friend and the owner get it all", async () => {
    const utku = await openBook("utku@example.com");
    const stranger = await h.user("stranger@example.com");
    const asking = await h.user("asking@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(utku, friend);
    await h.call("POST", `${v1}/me/friends/requests`, { handle: utku.handle }, asking.token);

    for (const [who, friendship] of [
      [stranger, "none"],
      [asking, "pending_out"],
    ] as const) {
      const card = await as(who, `/users/${utku.handle}`);
      expect(card.status).toBe(200);
      expect(card.body).toMatchObject({
        userId: utku.id,
        handle: utku.handle,
        friendship,
        publicProfile: false,
      });
      expect(card.body.bio).toBeNull();
      expect(card.body.presence).toBeUndefined();
      expect(card.body.visible).toEqual({ library: false, trophies: false, friends: false, presence: false });
      for (const part of [...parts, "gallery", "trophies/compare"]) {
        const answer = await as(who, `/users/${utku.handle}/${part}`);
        expect(answer.status, part).toBe(403);
      }
    }

    const theirs = await as(friend, `/users/${utku.handle}`);
    expect(theirs.body).toMatchObject({
      friendship: "friends",
      bio: "Speedruns on weekends",
      publicProfile: false,
    });
    expect(theirs.body.visible).toMatchObject({ library: true, trophies: true, friends: true });
    expect((await as(friend, `/users/${utku.handle}/library`)).status).toBe(200);
    const mine = await as(utku, `/users/${utku.handle}`);
    expect(mine.body).toMatchObject({ friendship: "me", bio: "Speedruns on weekends" });
    expect((await as(utku, `/users/${utku.handle}/trophies`)).status).toBe(200);
  });

  it("a block either way is a 404, switch on or off, signed in", async () => {
    const utku = await openBook("utku@example.com");
    const blocked = await h.user("blocked@example.com");
    await h.call("POST", `${v1}/me/blocks`, { userId: blocked.id }, utku.token);
    for (const on of [false, true]) {
      await setPublic(utku, on);
      expect((await as(blocked, `/users/${utku.handle}`)).status).toBe(404);
      expect((await as(blocked, `/users/${utku.handle}/library`)).status).toBe(404);
    }
  });

  it("off: no list shows the profile's parts to strangers (leaderboard, discovery, levels, feed)", async () => {
    const utku = await openBook("utku@example.com");
    const viewer = await h.user("viewer@example.com");
    const board = async () =>
      (
        await h.call("GET", `${v1}/leaderboards/points?scope=global`, undefined, viewer.token)
      ).body.entries.map((e: { user: { userId: string } }) => e.user.userId);
    const players = async () =>
      (
        await h.call("GET", `${v1}/discover/players?titleId=${game}`, undefined, viewer.token)
      ).body.players.map((p: { user: { userId: string } }) => p.user.userId);
    expect(await board()).not.toContain(utku.id);
    expect(await players()).not.toContain(utku.id);

    await setPublic(utku, true);
    await h.valkey.flushdb();
    expect(await board()).toContain(utku.id);
    expect(await players()).toContain(utku.id);

    // A public third party's friends list: utku's level shows only while utku is public.
    const hub = await h.user("hub@example.com");
    await h.call("PATCH", `${v1}/me/privacy`, { friends: "everyone" }, hub.token);
    await setPublic(hub, true);
    await befriend(hub, utku);
    const levelOf = async () =>
      (
        (await as(viewer, `/users/${hub.handle}/friends`)).body.friends as {
          userId: string;
          level: unknown;
        }[]
      ).find((f) => f.userId === utku.id)?.level;
    expect(await levelOf()).not.toBeNull();
    await setPublic(utku, false);
    expect(await levelOf()).toBeNull();
    await h.valkey.flushdb();
    expect(await board()).not.toContain(utku.id);
  });

  it("a child in a family cannot turn it on, and a family's limit turns it off", async () => {
    const mom = await h.user("mom@example.com");
    await h.call("POST", `${v1}/families`, { name: "Home" }, mom.token);
    const kid = await h.user("kid@example.com");
    await setPublic(kid, true);
    const { body } = await h.call("POST", `${v1}/me/family/link-codes`, {}, mom.token);
    await h.call("POST", `${v1}/me/family/join`, { code: body.code, timeZone: "Europe/Istanbul" }, kid.token);
    const [row] = await h.deps.db.select().from(profiles).where(eq(profiles.accountId, kid.id));
    expect(row?.publicProfile).toBe(false);
    const refused = await setPublic(kid, true);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("restricted_by_family");
  });

  it("migration 0023 keeps a public page for those who showed something to everyone, and no one else", async () => {
    const shown = await h.user("shown@example.com");
    await h.call("PATCH", `${v1}/me/privacy`, { trophies: "everyone" }, shown.token);
    const found = await h.user("found@example.com");
    await h.call("PATCH", `${v1}/me/discovery`, { discoverable: true }, found.token);
    const quiet = await h.user("quiet@example.com");
    await h.call("PATCH", `${v1}/me/privacy`, { library: "nobody", search: "everyone" }, quiet.token);
    const plain = await h.user("plain@example.com");
    await h.deps.db.update(profiles).set({ publicProfile: false });

    const file = readFileSync(
      new URL("../../../packages/db/drizzle/0023_public_profile.sql", import.meta.url),
      "utf8",
    );
    const update = file.split("--> statement-breakpoint").find((part) => part.includes("UPDATE"));
    expect(update).toBeDefined();
    await h.deps.db.execute(sql.raw(update as string));

    const rows = await h.deps.db.select().from(profiles);
    const on = new Map(rows.map((r) => [r.accountId, r.publicProfile]));
    expect(on.get(shown.id)).toBe(true);
    expect(on.get(found.id)).toBe(true);
    expect(on.get(quiet.id)).toBe(false);
    expect(on.get(plain.id)).toBe(false);
  });
});
