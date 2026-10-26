import { coverPresets, iconPresets } from "@anytogether/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness({ publicProfiles: true, gameIconHosts: ["image.api.playstation.com"] });
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const game = "PPSA01234";
const other = "CUSA00001";
const set = "a1b2c3d4e5f6";
const icon = "https://image.api.playstation.com/cat.png";
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** Bronze 0, silver 1, gold 2 (hidden), platinum 3. */
async function teachSet(user: User, titleId = game) {
  await h.call(
    "PUT",
    `${v1}/games/${titleId}`,
    { names: { en: "Cat Quest III" }, iconUrl: icon },
    user.token,
  );
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${titleId}/${set}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "First steps" } } },
        { id: 1, grade: "silver", texts: { en: { name: "Halfway" } } },
        { id: 2, grade: "gold", hidden: true, texts: { en: { name: "The twist" } } },
        { id: 3, grade: "platinum", texts: { en: { name: "Everything" } } },
      ],
    },
    user.token,
  );
}

const earn = (user: User, ids: number[], titleId = game, earnedAt = ago(30)) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    { trophies: ids.map((trophyId) => ({ titleId, setHash: set, trophyId, earnedAt })) },
    user.token,
  );

describe("art", () => {
  it("draws every cover and icon preset as SVG for anyone, and nothing else", async () => {
    for (const id of [coverPresets[0], coverPresets[coverPresets.length - 1]]) {
      const response = await h.app.request(`${v1}/art/covers/${id}.svg`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/svg+xml");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      const text = await response.text();
      expect(text.startsWith("<svg")).toBe(true);
      // The same name draws the same picture.
      expect(await (await h.app.request(`${v1}/art/covers/${id}.svg`)).text()).toBe(text);
    }
    expect((await h.app.request(`${v1}/art/icons/${iconPresets[5]}.svg`)).status).toBe(200);
    expect((await h.app.request(`${v1}/art/covers/cosmic-nothing.svg`)).status).toBe(404);
    expect((await h.app.request(`${v1}/art/icons/Pad-cosmic.svg`)).status).toBe(404);
  });
});

describe("look", () => {
  it("takes a preset cover, a game's artwork it knows and an accent; shows them on the profile", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    await teachSet(ana);

    const preset = await h.call(
      "PATCH",
      `${v1}/me/look`,
      { cover: { kind: "preset", id: "sunset-grid" }, accent: "coral" },
      ana.token,
    );
    expect(preset.status).toBe(200);
    expect(preset.body).toEqual({
      cover: {
        kind: "preset",
        id: "sunset-grid",
        url: "https://anytogether.test/api/v1/art/covers/sunset-grid.svg",
      },
      accent: "coral",
    });
    const seen = await h.call("GET", `${v1}/users/${ana.handle}`, undefined, ben.token);
    expect(seen.body).toMatchObject({ cover: { id: "sunset-grid" }, accent: "coral" });

    const art = await h.call("PATCH", `${v1}/me/look`, { cover: { kind: "game", titleId: game } }, ana.token);
    expect(art.body.cover).toEqual({ kind: "game", id: game, url: icon });
    expect(art.body.accent).toBe("coral");
    // A game without artwork here, an unknown preset or accent: refused.
    await h.call("PUT", `${v1}/games/${other}`, { names: { en: "No art" } }, ana.token);
    expect(
      (await h.call("PATCH", `${v1}/me/look`, { cover: { kind: "game", titleId: other } }, ana.token)).status,
    ).toBe(400);
    expect(
      (await h.call("PATCH", `${v1}/me/look`, { cover: { kind: "preset", id: "cosmic-x" } }, ana.token))
        .status,
    ).toBe(400);
    expect((await h.call("PATCH", `${v1}/me/look`, { accent: "pink" }, ana.token)).status).toBe(400);

    const reset = await h.call("PATCH", `${v1}/me/look`, { cover: null, accent: null }, ana.token);
    expect(reset.body).toEqual({ cover: null, accent: null });
    const me = await h.call("GET", `${v1}/me`, undefined, ana.token);
    expect(me.body.profile).toMatchObject({ cover: null, accent: null, rememberMet: true });
  });
});

describe("showcase", () => {
  it("pins earned trophies and games from the library, shown as the privacy settings allow", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    await befriend(ana, ben);
    await teachSet(ana);
    await earn(ana, [0, 2, 3]);

    // Only trophies she earned, only games she has.
    expect(
      (await h.call("PUT", `${v1}/me/showcase`, { trophies: [{ titleId: game, trophyId: 1 }] }, ana.token))
        .status,
    ).toBe(400);
    expect((await h.call("PUT", `${v1}/me/showcase`, { games: [other] }, ana.token)).status).toBe(400);
    const tooMany = Array.from({ length: 7 }, (_, i) => ({ titleId: game, trophyId: i }));
    expect((await h.call("PUT", `${v1}/me/showcase`, { trophies: tooMany }, ana.token)).status).toBe(400);

    const saved = await h.call(
      "PUT",
      `${v1}/me/showcase`,
      {
        trophies: [
          { titleId: game, trophyId: 3 },
          { titleId: game, trophyId: 2 },
        ],
        games: [game],
      },
      ana.token,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.trophies.map((t: { trophyId: number }) => t.trophyId)).toEqual([3, 2]);
    expect(saved.body.trophies[1].texts).toEqual({ en: { name: "The twist" } });

    // A friend sees it, but not the hidden trophy's name they have not earned.
    const friend = await h.call("GET", `${v1}/users/${ana.handle}/showcase`, undefined, ben.token);
    expect(friend.body.trophies[0]).toMatchObject({
      trophyId: 3,
      grade: "platinum",
      gameNames: { en: "Cat Quest III" },
    });
    expect(friend.body.trophies[1]).toMatchObject({ trophyId: 2, hidden: true, texts: null });
    expect(friend.body.games).toEqual([
      expect.objectContaining({ titleId: game, trophiesEarned: 3, trophiesTotal: 4, progress: 75 }),
    ]);
    // Trophies and library are friends-only by default.
    const stranger = await h.call("GET", `${v1}/users/${ana.handle}/showcase`, undefined, cem.token);
    expect(stranger.body).toEqual({ trophies: null, games: null });
    // A public library with private trophies shows the games without trophy counts.
    await h.call("PATCH", `${v1}/me/privacy`, { library: "everyone" }, ana.token);
    const open = await h.call("GET", `${v1}/users/${ana.handle}/showcase`, undefined, cem.token);
    expect(open.body.trophies).toBeNull();
    expect(open.body.games[0]).toMatchObject({ titleId: game, trophiesEarned: null, progress: null });
  });
});

describe("comparing trophies", () => {
  it("lists games either has, then one game side by side with who earned what and when", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    await befriend(ana, ben);
    await teachSet(ana);
    await earn(ana, [0, 3], game, ago(48));
    await earn(ben, [0, 1, 2], game, ago(2));

    const games = await h.call("GET", `${v1}/users/${ben.handle}/trophies/compare`, undefined, ana.token);
    expect(games.status).toBe(200);
    expect(games.body.games).toEqual([
      expect.objectContaining({
        titleId: game,
        mine: expect.objectContaining({ earned: 2, total: 4, progress: 50, points: 315 }),
        theirs: expect.objectContaining({ earned: 3, total: 4, progress: 75, points: 135 }),
      }),
    ]);

    const one = await h.call(
      "GET",
      `${v1}/users/${ben.handle}/trophies/compare?titleId=${game}`,
      undefined,
      ana.token,
    );
    expect(one.status).toBe(200);
    expect(one.body.totals).toEqual({ mine: 2, theirs: 3, both: 1, total: 4 });
    expect(one.body.me).toMatchObject({ userId: ana.id, level: { level: 6 } });
    expect(one.body.them).toMatchObject({ userId: ben.id, level: { level: 3 } });
    const byId = new Map(one.body.trophies.map((t: { id: number }) => [t.id, t]));
    expect(byId.get(0)).toMatchObject({ mine: expect.any(String), theirs: expect.any(String) });
    expect(byId.get(3)).toMatchObject({ mine: expect.any(String), theirs: null, grade: "platinum" });
    // Ben earned the hidden gold, Ana did not: its name stays hidden from her.
    expect(byId.get(2)).toMatchObject({ hidden: true, texts: null, mine: null, theirs: expect.any(String) });
  });

  it("respects privacy and blocks, and is not for oneself", async () => {
    const ana = await h.user("ana@example.com");
    const cem = await h.user("cem@example.com");
    await teachSet(ana);
    const privateOne = await h.call(
      "GET",
      `${v1}/users/${cem.handle}/trophies/compare`,
      undefined,
      ana.token,
    );
    expect(privateOne.status).toBe(403);
    expect(privateOne.body.section).toBe("trophies");
    await h.call("PATCH", `${v1}/me/privacy`, { trophies: "everyone" }, cem.token);
    expect(
      (await h.call("GET", `${v1}/users/${cem.handle}/trophies/compare`, undefined, ana.token)).status,
    ).toBe(200);
    expect(
      (await h.call("GET", `${v1}/users/${cem.handle}/trophies/compare?titleId=nope`, undefined, ana.token))
        .status,
    ).toBe(400);
    expect(
      (await h.call("GET", `${v1}/users/${ana.handle}/trophies/compare`, undefined, ana.token)).status,
    ).toBe(400);
    await h.call("POST", `${v1}/me/blocks`, { userId: ana.id }, cem.token);
    expect(
      (await h.call("GET", `${v1}/users/${cem.handle}/trophies/compare`, undefined, ana.token)).status,
    ).toBe(404);
  });
});

describe("signed out", () => {
  it("shows the level, look and showcase only where the person opened their trophies and library", async () => {
    const ana = await h.user("ana@example.com");
    await teachSet(ana);
    await earn(ana, [3]);
    await h.call(
      "PATCH",
      `${v1}/me/look`,
      { cover: { kind: "preset", id: "aurora-glow" }, accent: "mint" },
      ana.token,
    );
    await h.call(
      "PUT",
      `${v1}/me/showcase`,
      { trophies: [{ titleId: game, trophyId: 3 }], games: [game] },
      ana.token,
    );
    const closed = await h.call("GET", `${v1}/users/${ana.handle}`);
    expect(closed.body).toMatchObject({ trophyLevel: null, cover: { id: "aurora-glow" }, accent: "mint" });
    expect((await h.call("GET", `${v1}/users/${ana.handle}/showcase`)).body).toEqual({
      trophies: null,
      games: null,
    });
    await h.call("PATCH", `${v1}/me/privacy`, { trophies: "everyone", library: "everyone" }, ana.token);
    const open = await h.call("GET", `${v1}/users/${ana.handle}`);
    expect(open.body.trophyLevel).toMatchObject({ level: 6 });
    const showcase = await h.call("GET", `${v1}/users/${ana.handle}/showcase`);
    expect(showcase.body.trophies[0]).toMatchObject({ trophyId: 3, grade: "platinum" });
    expect(showcase.body.games[0]).toMatchObject({ titleId: game });
  });
});
