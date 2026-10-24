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
type Item = Record<string, unknown> & { id: string; kind: string };
const v1 = "/api/v1";
const game = "PPSA01234";
const set = "a1b2c3d4e5f6";
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);

/** Bronze 0, silver 1, gold 2 (hidden), platinum 3. */
async function teachSet(user: User) {
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, user.token);
  return h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
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

const earn = (user: User, ids: number[], earnedAt = ago(0)) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    { trophies: ids.map((trophyId) => ({ titleId: game, setHash: set, trophyId, earnedAt })) },
    user.token,
  );

async function device(user: User) {
  const id = uuidv7();
  await h.call("POST", `${v1}/me/devices`, { id, platform: "macos", name: "MacBook" }, user.token);
  return id;
}

/** A session of `minutes` that ended `endedHoursAgo` hours ago. */
const play = (user: User, deviceId: string, minutes: number, titleId = game, endedHoursAgo = 0) => {
  const endedAt = new Date(Date.now() - endedHoursAgo * 3_600_000);
  return h.call(
    "POST",
    `${v1}/me/sessions`,
    {
      sessions: [
        {
          id: uuidv7(),
          titleId,
          deviceId,
          startedAt: new Date(endedAt.getTime() - minutes * 60_000).toISOString(),
          endedAt: endedAt.toISOString(),
        },
      ],
    },
    user.token,
  );
};

const feed = async (user: User, query = "") => {
  const response = await h.call("GET", `${v1}/me/feed${query}`, undefined, user.token);
  expect(response.status).toBe(200);
  return response.body as { items: Item[]; next: string | null };
};

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Item }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

describe("trophies in the feed", () => {
  it("folds a game's trophies within the hour; a platinum stands alone", async () => {
    const a = await h.user("fold1@example.com");
    const b = await h.user("fold2@example.com");
    await befriend(a, b);
    await teachSet(a);
    await earn(a, [0]);
    await earn(a, [1, 2]);
    await earn(a, [3]);

    const { items } = await feed(b);
    const kinds = items.map((item) => item.kind);
    // Newest first: the platinum, the folded trophies; the friendship of A and B is not told to B.
    expect(kinds).toEqual(["platinum", "trophy"]);
    expect(items[0]).toMatchObject({
      kind: "platinum",
      highlight: "platinum",
      actor: { userId: a.id, handle: a.handle },
      game: { titleId: game, names: { en: "Cat Quest III" } },
      trophies: [{ trophyId: 3, grade: "platinum", texts: { en: { name: "Everything" } } }],
    });
    const folded = items[1] as Item & { trophies: { trophyId: number; texts: unknown }[] };
    expect(folded.trophyCount).toBe(3);
    expect(folded.trophies.map((t) => t.trophyId).sort()).toEqual([0, 1, 2]);
    // B has not earned the hidden gold: its name stays hidden from B, but not from A.
    expect(folded.trophies.find((t) => t.trophyId === 2)?.texts).toBeNull();
    const own = await h.call("GET", `${v1}/users/${a.handle}/activity`, undefined, a.token);
    const ownFolded = own.body.items.find((item: Item) => item.kind === "trophy");
    expect(ownFolded.trophies.find((t: { trophyId: number }) => t.trophyId === 2).texts).toEqual({
      en: { name: "The twist" },
    });
  });

  it("starts a new item after an hour, highlights rare ones, and leaves old trophies out", async () => {
    const a = await h.user("rare1@example.com");
    const b = await h.user("rare2@example.com");
    await befriend(a, b);
    await teachSet(a);
    await earn(a, [0], ago(30));
    expect((await feed(b)).items).toHaveLength(0);

    await earn(a, [1]);
    await h.deps.db.execute(sql`update activities set created_at = now() - interval '2 hours'`);
    await earn(a, [2]);
    let items = (await feed(b)).items;
    expect(items.map((item) => item.kind)).toEqual(["trophy", "trophy"]);
    expect(items.every((item) => item.highlight === null)).toBe(true);

    await h.deps.db.execute(sql`update trophies set rarity = 0.03 where trophy_id = 2`);
    items = (await feed(b)).items;
    expect(items[0]).toMatchObject({
      highlight: "rare",
      trophies: [{ trophyId: 2, rarity: 0.03, rarityLabel: "very_rare" }],
    });
  });

  it("tells friends live, and again with the same id when more trophies fold in", async () => {
    const a = await h.user("live1@example.com");
    const b = await h.user("live2@example.com");
    const stranger = await h.user("live3@example.com");
    await befriend(a, b);
    await teachSet(a);
    const bHears = await listen(b.id);
    const strangerHears = await listen(stranger.id);
    await earn(a, [0]);
    await earn(a, [1]);
    await settle();
    const items = bHears.heard.filter((event) => event.type === "feed.item").map((event) => event.data);
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(items[1]?.id);
    expect(items[1]).toMatchObject({ kind: "trophy", trophyCount: 2, actor: { userId: a.id } });
    expect(strangerHears.heard).toHaveLength(0);

    // Trophies hidden from friends are not told to them.
    await setPrivacy(a, { trophies: "nobody" });
    bHears.heard.length = 0;
    await earn(a, [3]);
    await settle();
    expect(bHears.heard.filter((event) => event.type === "feed.item")).toHaveLength(0);
    bHears.stop();
    strangerHears.stop();
  });
});

describe("privacy at read time", () => {
  it("hides items as soon as the setting changes, and shows strangers only public ones", async () => {
    const a = await h.user("priv1@example.com");
    const friend = await h.user("priv2@example.com");
    const stranger = await h.user("priv3@example.com");
    await befriend(a, friend);
    await teachSet(a);
    await earn(a, [0]);
    await play(a, await device(a), 30);

    expect((await feed(friend)).items.map((item) => item.kind)).toEqual(["first_play", "trophy"]);
    const strangerView = () => h.call("GET", `${v1}/users/${a.handle}/activity`, undefined, stranger.token);
    expect((await strangerView()).body.items).toHaveLength(0);

    await setPrivacy(a, { trophies: "nobody" });
    expect((await feed(friend)).items.map((item) => item.kind)).toEqual(["first_play"]);
    await setPrivacy(a, { library: "everyone" });
    expect((await strangerView()).body.items.map((item: Item) => item.kind)).toEqual(["first_play"]);
    // The owner always sees all of it.
    const own = await h.call("GET", `${v1}/users/${a.handle}/activity`, undefined, a.token);
    expect(own.body.items.map((item: Item) => item.kind)).toEqual(["first_play", "trophy", "friendship"]);

    await h.call("POST", `${v1}/me/blocks`, { userId: a.id }, stranger.token);
    expect((await strangerView()).status).toBe(404);
    expect((await h.call("GET", `${v1}/users/nobody/activity`, undefined, a.token)).status).toBe(404);
  });
});

describe("play", () => {
  it("tells of a first play, of long sessions, and not of short ones or old ones", async () => {
    const a = await h.user("play1@example.com");
    const b = await h.user("play2@example.com");
    await befriend(a, b);
    const computer = await device(a);
    await play(a, computer, 30);
    await play(a, computer, 25);
    await play(a, computer, 180);
    await play(a, computer, 240, game, 48);
    await play(a, computer, 150, "CUSA00001", 0);
    const { items } = await feed(b);
    // Over ten hours in all by now (the old session counts toward that).
    expect(items[0]).toMatchObject({ kind: "milestone", milestone: { kind: "hours", value: 10 } });
    expect(
      items.slice(1).map((item) => [item.kind, item.seconds ?? null, (item.game as Item)?.titleId]),
    ).toEqual([
      ["first_play", 9000, "CUSA00001"],
      ["long_session", 10800, game],
      ["first_play", null, game],
    ]);
  });

  it("marks milestones: games and hours", async () => {
    const a = await h.user("mile1@example.com");
    const b = await h.user("mile2@example.com");
    await befriend(a, b);
    const computer = await device(a);
    for (const titleId of ["CUSA00001", "CUSA00002", "CUSA00003", "CUSA00004"])
      await play(a, computer, 20, titleId);
    expect((await feed(b)).items.filter((item) => item.kind === "milestone")).toHaveLength(0);
    await play(a, computer, 11 * 60, "CUSA00005");
    const milestones = (await feed(b)).items.filter((item) => item.kind === "milestone");
    expect(milestones.map((item) => item.milestone)).toEqual(
      expect.arrayContaining([
        { kind: "games", value: 5 },
        { kind: "hours", value: 10 },
      ]),
    );
    expect(milestones).toHaveLength(2);
  });
});

describe("friendships in the feed", () => {
  it("shows a new friendship when both lists may be seen, once to a mutual friend, gone on unfriend", async () => {
    const a = await h.user("fr1@example.com");
    const b = await h.user("fr2@example.com");
    const c = await h.user("fr3@example.com");
    const d = await h.user("fr4@example.com");
    await befriend(a, c);
    await befriend(a, d);
    await befriend(b, d);
    await befriend(a, b);

    // C is A's friend but not B's: B's friends list (friends only by default) keeps it from C.
    const forC = () => feed(c).then((page) => page.items.filter((item) => item.kind === "friendship"));
    expect(await forC()).toHaveLength(0);
    await setPrivacy(b, { friends: "everyone" });
    expect((await forC()).map((item) => [(item.actor as Item).userId, (item.friend as Item).userId])).toEqual(
      [[a.id, b.id]],
    );

    // D is friends with both: one item, not two.
    const forD = (await feed(d)).items.filter(
      (item) => item.kind === "friendship" && [a.id, b.id].includes((item.friend as Item).userId as string),
    );
    expect(forD.filter((item) => [a.id, b.id].includes((item.actor as Item).userId as string))).toHaveLength(
      1,
    );

    await h.call("DELETE", `${v1}/me/friends/${b.id}`, undefined, a.token);
    expect(await forC()).toHaveLength(0);
  });
});

describe("reactions and paging", () => {
  it("takes one reaction per person, changes and removes it, only on items one may see", async () => {
    const a = await h.user("re1@example.com");
    const b = await h.user("re2@example.com");
    const c = await h.user("re3@example.com");
    const stranger = await h.user("re4@example.com");
    await befriend(a, b);
    await befriend(a, c);
    await teachSet(a);
    await earn(a, [0]);
    const [item] = (await feed(b)).items;
    const path = `${v1}/activities/${item?.id}/reaction`;
    expect((await h.call("PUT", path, { reaction: "fire" }, b.token)).body).toEqual({
      counts: { fire: 1 },
      mine: "fire",
    });
    await h.call("PUT", path, { reaction: "fire" }, c.token);
    expect((await h.call("PUT", path, { reaction: "clap" }, b.token)).body).toEqual({
      counts: { fire: 1, clap: 1 },
      mine: "clap",
    });
    expect((await feed(c)).items[0]?.reactions).toEqual({ counts: { fire: 1, clap: 1 }, mine: "fire" });
    expect((await h.call("DELETE", path, undefined, b.token)).body).toEqual({
      counts: { fire: 1 },
      mine: null,
    });
    expect((await h.call("PUT", path, { reaction: "poop" }, b.token)).status).toBe(400);
    expect((await h.call("PUT", path, { reaction: "fire" }, stranger.token)).status).toBe(404);
    expect(
      (await h.call("PUT", `${v1}/activities/nope/reaction`, { reaction: "fire" }, b.token)).status,
    ).toBe(404);
  });

  it("pages newest first with before", async () => {
    const a = await h.user("page1@example.com");
    const b = await h.user("page2@example.com");
    await befriend(a, b);
    const computer = await device(a);
    for (const titleId of ["CUSA00001", "CUSA00002", "CUSA00003"]) await play(a, computer, 20, titleId);
    const first = await feed(b, "?limit=2");
    expect(first.items.map((item) => (item.game as Item).titleId)).toEqual(["CUSA00003", "CUSA00002"]);
    expect(first.next).toBe(first.items[1]?.id);
    const second = await feed(b, `?limit=2&before=${first.next}`);
    expect(second.items.map((item) => (item.game as Item).titleId)).toEqual(["CUSA00001"]);
    expect(second.next).toBeNull();
    expect((await h.call("GET", `${v1}/me/feed?before=x`, undefined, b.token)).status).toBe(400);
    expect((await h.call("GET", `${v1}/me/feed?limit=500`, undefined, b.token)).status).toBe(400);
    expect((await h.call("GET", `${v1}/me/feed`)).status).toBe(401);
  });
});
