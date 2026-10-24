import { sql } from "drizzle-orm";
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
const hours = (count: number) => new Date(Date.now() - count * 3_600_000).toISOString();

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

async function device(user: User, name = "MacBook Pro") {
  const id = uuidv7();
  const registered = await h.call(
    "POST",
    `${v1}/me/devices`,
    { id, platform: "macos", name, model: "Mac15,9" },
    user.token,
  );
  expect(registered.status).toBe(201);
  return id;
}

/** Bronze 0, silver 1, gold 2 (hidden), platinum 3. */
async function teachSet(user: User, titleId = game, hash = set) {
  return h.call(
    "PUT",
    `${v1}/trophy-sets/${titleId}/${hash}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "First steps", detail: "Start the game" } } },
        { id: 1, grade: "silver", texts: { en: { name: "Halfway", detail: "Reach chapter 5" } } },
        {
          id: 2,
          grade: "gold",
          hidden: true,
          texts: { en: { name: "The twist", detail: "Learn who you are" } },
        },
        { id: 3, grade: "platinum", texts: { en: { name: "Everything" } } },
      ],
    },
    user.token,
  );
}

const earn = (user: User, ids: number[], earnedAt = hours(0)) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    { trophies: ids.map((trophyId) => ({ titleId: game, setHash: set, trophyId, earnedAt })) },
    user.token,
  );

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

describe("catalogue", () => {
  it("is taught a game once; later launchers only add languages it lacks", async () => {
    await h.close();
    h = await harness({ gameIconHosts: ["cdn.example.com"] });
    const a = await h.user("teach1@example.com");
    const b = await h.user("teach2@example.com");
    const taught = await h.call(
      "PUT",
      `${v1}/games/${game}`,
      { names: { en: "Hollow Knight: Silksong" }, iconUrl: "https://cdn.example.com/icon.webp" },
      a.token,
    );
    expect(taught.status).toBe(201);
    expect(taught.body).toMatchObject({ titleId: game, stored: true });

    const again = await h.call(
      "PUT",
      `${v1}/games/${game}`,
      { names: { en: "Wrong name", tr: "Hollow Knight: Silksong (TR)" } },
      b.token,
    );
    expect(again.status).toBe(200);
    const shown = await h.call("GET", `${v1}/games/${game}`, undefined, b.token);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({
      titleId: game,
      names: { en: "Hollow Knight: Silksong", tr: "Hollow Knight: Silksong (TR)" },
      iconUrl: "https://cdn.example.com/icon.webp",
      locked: false,
      players: 0,
    });
  });

  it("keeps no icon from a host that is not on the list: every viewer would load it", async () => {
    await h.close();
    h = await harness({ gameIconHosts: ["cdn.example.com"] });
    const a = await h.user("icon@example.com");
    for (const iconUrl of [
      "https://tracker.example.net/pixel.png",
      "https://cdn.example.com.evil.net/i.png",
    ]) {
      const taught = await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Stray" }, iconUrl }, a.token);
      expect(taught.status).toBeLessThan(300);
      expect(taught.body.iconUrl).toBeNull();
    }
    expect((await h.call("GET", `${v1}/games/${game}`, undefined, a.token)).body).toMatchObject({
      names: { en: "Stray" },
      iconUrl: null,
    });
    // Without a list nobody's icon is kept.
    await h.close();
    h = await harness();
    const b = await h.user("icon2@example.com");
    const taught = await h.call(
      "PUT",
      `${v1}/games/PPSA05678`,
      { names: { en: "Other" }, iconUrl: "https://cdn.example.com/icon.webp" },
      b.token,
    );
    expect(taught.body.iconUrl).toBeNull();
  });

  it("leaves a locked game alone", async () => {
    const a = await h.user("locked@example.com");
    await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Right" } }, a.token);
    await h.deps.db.execute(sql`update games set locked = true where title_id = ${game}`);
    const tried = await h.call("PUT", `${v1}/games/${game}`, { names: { tr: "Yanlış" } }, a.token);
    expect(tried.body.stored).toBe(false);
    expect((await h.call("GET", `${v1}/games/${game}`, undefined, a.token)).body.names).toEqual({
      en: "Right",
    });
  });

  it("refuses bad title IDs and needs a sign-in", async () => {
    const a = await h.user("badid@example.com");
    for (const bad of ["ppsa01234", "PPSA1234", "PPSA012345", "CUSA0123X"]) {
      const response = await h.call("PUT", `${v1}/games/${bad}`, { names: { en: "x" } }, a.token);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("bad_request");
    }
    expect((await h.call("GET", `${v1}/games/CUSA00001`, undefined, a.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/games/${game}`)).status).toBe(401);
    expect((await h.call("PUT", `${v1}/games/${game}`, { names: {} }, a.token)).status).toBe(400);
  });
});

describe("devices", () => {
  it("registers this computer and updates it; another account cannot take its ID", async () => {
    const a = await h.user("dev1@example.com");
    const b = await h.user("dev2@example.com");
    const id = await device(a);
    const renamed = await h.call(
      "POST",
      `${v1}/me/devices`,
      { id, platform: "macos", name: "Studio" },
      a.token,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id, platform: "macos", name: "Studio" });
    const stolen = await h.call("POST", `${v1}/me/devices`, { id, platform: "linux", name: "x" }, b.token);
    expect(stolen.status).toBe(409);
    const bad = await h.call("POST", `${v1}/me/devices`, { id, platform: "amiga", name: "x" }, a.token);
    expect(bad.status).toBe(400);
  });
});

describe("sessions", () => {
  it("stores a batch once, however often it is sent, and adds play time across two computers", async () => {
    const a = await h.user("play@example.com");
    const mac = await device(a, "MacBook");
    const pc = await device(a, "Gaming PC");
    const sessions = [
      { id: uuidv7(), titleId: game, deviceId: mac, startedAt: hours(5), endedAt: hours(4), exit: "normal" },
      { id: uuidv7(), titleId: game, deviceId: pc, startedAt: hours(3), endedAt: hours(1.5) },
    ];
    const first = await h.call("POST", `${v1}/me/sessions`, { sessions }, a.token);
    expect(first.status).toBe(200);
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual(["stored", "stored"]);
    const resent = await h.call("POST", `${v1}/me/sessions`, { sessions }, a.token);
    expect(resent.body.results.map((r: { status: string }) => r.status)).toEqual(["duplicate", "duplicate"]);

    const library = await h.call("GET", `${v1}/users/${a.handle}/library`, undefined, a.token);
    expect(library.status).toBe(200);
    expect(library.body.games).toHaveLength(1);
    const entry = library.body.games[0];
    expect(entry.titleId).toBe(game);
    expect(entry.secondsPlayed).toBe(2.5 * 3600);
    expect(Date.parse(entry.firstPlayedAt)).toBe(Date.parse(sessions[0]?.startedAt as string));
    expect(Date.parse(entry.lastPlayedAt)).toBe(Date.parse(sessions[1]?.endedAt as string));
    expect(entry.devices.map((d: { name: string }) => d.name).sort()).toEqual(["Gaming PC", "MacBook"]);
  });

  it("rejects bad items one by one and keeps the good ones", async () => {
    const a = await h.user("rej@example.com");
    const b = await h.user("rej2@example.com");
    const mine = await device(a);
    const theirs = await device(b);
    const good = { id: uuidv7(), titleId: game, deviceId: mine, startedAt: hours(2), endedAt: hours(1) };
    const response = await h.call(
      "POST",
      `${v1}/me/sessions`,
      {
        sessions: [
          good,
          { ...good, id: uuidv7(), titleId: "ppsa01234" },
          { ...good, id: uuidv7(), startedAt: hours(1), endedAt: hours(2) },
          { ...good, id: uuidv7(), deviceId: theirs },
          { ...good, id: uuidv7(), deviceId: uuidv7() },
          good,
        ],
      },
      a.token,
    );
    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { status: string; code?: string }) => r.code ?? r.status)).toEqual([
      "stored",
      "bad_request",
      "bad_request",
      "unknown_device",
      "unknown_device",
      "duplicate",
    ]);
    const library = await h.call("GET", `${v1}/users/${a.handle}/library`, undefined, a.token);
    expect(library.body.games[0].secondsPlayed).toBe(3600);
  });

  it("refuses an empty batch or one over 200", async () => {
    const a = await h.user("big@example.com");
    expect((await h.call("POST", `${v1}/me/sessions`, { sessions: [] }, a.token)).status).toBe(400);
    const many = Array.from({ length: 201 }, () => ({}));
    expect((await h.call("POST", `${v1}/me/sessions`, { sessions: many }, a.token)).status).toBe(400);
  });
});

describe("trophies", () => {
  it("is taught a set once; the same set again only adds languages", async () => {
    const a = await h.user("set1@example.com");
    const taught = await teachSet(a);
    expect(taught.status).toBe(201);
    expect(taught.body).toMatchObject({ stored: true, trophies: 4 });
    const again = await teachSet(a);
    expect(again.status).toBe(200);
    expect(again.body.stored).toBe(false);
    const turkish = await h.call(
      "PUT",
      `${v1}/trophy-sets/${game}/${set}`,
      {
        trophies: [
          { id: 0, grade: "platinum", texts: { en: { name: "Changed" }, tr: { name: "İlk adımlar" } } },
          { id: 42, grade: "gold", texts: { en: { name: "Not in the file" } } },
        ],
      },
      a.token,
    );
    expect(turkish.body).toMatchObject({ stored: false, trophies: 4 });
    const listed = await h.call(
      "GET",
      `${v1}/users/${a.handle}/trophies?titleId=${game}`,
      undefined,
      a.token,
    );
    expect(listed.body.trophies).toHaveLength(4);
    expect(listed.body.trophies[0]).toMatchObject({
      grade: "bronze",
      texts: { en: { name: "First steps" }, tr: { name: "İlk adımlar" } },
    });
    const other = await teachSet(a, game, "ffff0000");
    expect(other.status).toBe(201);
    const shown = await h.call("GET", `${v1}/games/${game}`, undefined, a.token);
    expect(shown.body.trophySets.map((s: { setHash: string }) => s.setHash).sort()).toEqual([
      set,
      "ffff0000",
    ]);
    expect((await h.call("PUT", `${v1}/trophy-sets/BAD/${set}`, { trophies: [] }, a.token)).status).toBe(400);
  });

  it("stores earned trophies once and counts progress and points", async () => {
    const a = await h.user("earn@example.com");
    await teachSet(a);
    const first = await earn(a, [0, 1, 2]);
    expect(first.status).toBe(200);
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual([
      "stored",
      "stored",
      "stored",
    ]);
    const again = await earn(a, [0, 1, 2, 3]);
    expect(again.body.results.map((r: { status: string }) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "stored",
    ]);
    const library = await h.call("GET", `${v1}/users/${a.handle}/library`, undefined, a.token);
    expect(library.body.games[0]).toMatchObject({
      titleId: game,
      trophiesEarned: 4,
      trophiesTotal: 4,
      progress: 100,
      points: 15 + 30 + 90 + 300,
    });
  });

  it("rejects trophies of a set it does not know and times in the future", async () => {
    const a = await h.user("unknown@example.com");
    await teachSet(a);
    const response = await h.call(
      "POST",
      `${v1}/me/trophies`,
      {
        trophies: [
          { titleId: game, setHash: "nope", trophyId: 0, earnedAt: hours(0) },
          { titleId: game, setHash: set, trophyId: 99, earnedAt: hours(0) },
          { titleId: game, setHash: set, trophyId: 0, earnedAt: hours(-2) },
          { titleId: "XX", setHash: set, trophyId: 0, earnedAt: hours(0) },
        ],
      },
      a.token,
    );
    expect(response.body.results.map((r: { code?: string }) => r.code)).toEqual([
      "unknown_trophy",
      "unknown_trophy",
      "bad_request",
      "bad_request",
    ]);
  });

  it("works out rarity from the players who have the game", async () => {
    const people = await Promise.all(["r1", "r2", "r3", "r4"].map((n) => h.user(`${n}@example.com`)));
    const [a, b, c, d] = people as [User, User, User, User];
    await teachSet(a);
    for (const person of people) {
      const mac = await device(person);
      await h.call(
        "POST",
        `${v1}/me/sessions`,
        {
          sessions: [{ id: uuidv7(), titleId: game, deviceId: mac, startedAt: hours(2), endedAt: hours(1) }],
        },
        person.token,
      );
    }
    await earn(a, [0, 1]);
    await earn(b, [0]);
    await earn(c, [0]);
    const list = await h.call("GET", `${v1}/users/${d.handle}/trophies?titleId=${game}`, undefined, d.token);
    expect(list.status).toBe(200);
    const byId = new Map(list.body.trophies.map((t: { id: number }) => [t.id, t]));
    expect(byId.get(0)).toMatchObject({
      earnedCount: 3,
      rarity: 0.75,
      rarityLabel: "common",
      earnedAt: null,
    });
    expect(byId.get(1)).toMatchObject({ earnedCount: 1, rarity: 0.25, rarityLabel: "uncommon" });
    expect(byId.get(3)).toMatchObject({ earnedCount: 0, rarity: 0, rarityLabel: "ultra_rare" });
    const shown = await h.call("GET", `${v1}/games/${game}`, undefined, d.token);
    expect(shown.body.players).toBe(4);
  });

  it("hides a hidden trophy's texts from anyone who has not earned it", async () => {
    const a = await h.user("hid1@example.com");
    const b = await h.user("hid2@example.com");
    await befriend(a, b);
    await teachSet(a);
    await earn(a, [2]);

    const own = await h.call("GET", `${v1}/users/${a.handle}/trophies?titleId=${game}`, undefined, a.token);
    const ownTwist = own.body.trophies.find((t: { id: number }) => t.id === 2);
    expect(ownTwist).toMatchObject({ hidden: true, texts: { en: { name: "The twist" } } });
    expect(ownTwist.earnedAt).not.toBeNull();

    const friend = await h.call(
      "GET",
      `${v1}/users/${a.handle}/trophies?titleId=${game}`,
      undefined,
      b.token,
    );
    const seen = friend.body.trophies.find((t: { id: number }) => t.id === 2);
    expect(seen).toMatchObject({ hidden: true, texts: null });
    expect(seen.earnedAt).not.toBeNull();
    const timeline = await h.call("GET", `${v1}/users/${a.handle}/trophies`, undefined, b.token);
    expect(timeline.body.trophies).toHaveLength(1);
    expect(timeline.body.trophies[0]).toMatchObject({ titleId: game, trophyId: 2, texts: null });

    await earn(b, [2]);
    const after = await h.call("GET", `${v1}/users/${a.handle}/trophies?titleId=${game}`, undefined, b.token);
    expect(after.body.trophies.find((t: { id: number }) => t.id === 2).texts.en.name).toBe("The twist");
  });

  it("tells friends about a new trophy, keeping a hidden one's name to itself", async () => {
    const a = await h.user("ev1@example.com");
    const b = await h.user("ev2@example.com");
    const stranger = await h.user("ev3@example.com");
    await befriend(a, b);
    await teachSet(a);
    const bHears = await listen(b.id);
    const strangerHears = await listen(stranger.id);
    await earn(a, [1, 2]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const trophies = bHears.heard.filter((event) => event.type === "trophy.earned");
    expect(trophies.map((event) => event.data)).toEqual([
      expect.objectContaining({ userId: a.id, titleId: game, trophyId: 1, grade: "silver", name: "Halfway" }),
      expect.objectContaining({ userId: a.id, titleId: game, trophyId: 2, grade: "gold", name: null }),
    ]);
    expect(strangerHears.heard).toHaveLength(0);
    bHears.stop();
    strangerHears.stop();
  });
});

describe("visibility", () => {
  it("shows the library and trophies only to friends and yourself", async () => {
    const a = await h.user("vis1@example.com");
    const friend = await h.user("vis2@example.com");
    const stranger = await h.user("vis3@example.com");
    await befriend(a, friend);
    await teachSet(a);
    await earn(a, [0]);
    expect((await h.call("GET", `${v1}/users/${a.handle}/library`, undefined, friend.token)).status).toBe(
      200,
    );
    const friendView = await h.call("GET", `${v1}/users/${a.handle}/library`, undefined, friend.token);
    expect(friendView.body.games[0].devices).toBeUndefined();
    for (const path of ["library", "trophies", `trophies?titleId=${game}`]) {
      const response = await h.call("GET", `${v1}/users/${a.handle}/${path}`, undefined, stranger.token);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("forbidden");
    }
    expect((await h.call("GET", `${v1}/users/nobody/library`, undefined, a.token)).status).toBe(404);
    expect(
      (await h.call("GET", `${v1}/users/${a.handle}/trophies?titleId=bad`, undefined, a.token)).status,
    ).toBe(400);
  });
});
