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
type Entry = { rank: number; user: { userId: string; handle: string }; value: number };
const v1 = "/api/v1";
const game = "PPSA01234";
const other = "PPSA05678";
const set = "a1b2c3d4e5f6";

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);

/** Bronze 0 (15), silver 1 (30), gold 2 (90), platinum 3 (300). */
async function teachSet(user: User, titleId = game) {
  await h.call("PUT", `${v1}/games/${titleId}`, { names: { en: `Game ${titleId}` } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${titleId}/${set}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "One" } } },
        { id: 1, grade: "silver", texts: { en: { name: "Two" } } },
        { id: 2, grade: "gold", texts: { en: { name: "Three" } } },
        { id: 3, grade: "platinum", texts: { en: { name: "Four" } } },
      ],
    },
    user.token,
  );
}

const earn = (user: User, ids: number[], titleId = game) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    {
      trophies: ids.map((trophyId) => ({
        titleId,
        setHash: set,
        trophyId,
        earnedAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
      })),
    },
    user.token,
  );

async function play(user: User, minutes: number, titleId = game) {
  const deviceId = uuidv7();
  await h.call("POST", `${v1}/me/devices`, { id: deviceId, platform: "macos", name: "Mac" }, user.token);
  const endedAt = Date.now() - 3 * 86_400_000;
  await h.call(
    "POST",
    `${v1}/me/sessions`,
    {
      sessions: [
        {
          id: uuidv7(),
          titleId,
          deviceId,
          startedAt: new Date(endedAt - minutes * 60_000).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
        },
      ],
    },
    user.token,
  );
}

const board = async (user: User, path: string) => {
  const response = await h.call("GET", `${v1}${path}`, undefined, user.token);
  expect(response.status).toBe(200);
  return response.body;
};
const ranks = (entries: Entry[]) => entries.map((e) => [e.rank, e.user.userId, e.value]);
const forget = async () => {
  const keys = await h.valkey.keys("lb:*");
  if (keys.length) await h.valkey.del(...keys);
};

describe("overall points", () => {
  it("ranks friends, the reader included, and leaves strangers out", async () => {
    const me = await h.user("lb1@example.com");
    const friend = await h.user("lb2@example.com");
    const stranger = await h.user("lb3@example.com");
    const shy = await h.user("lb4@example.com");
    await befriend(me, friend);
    await befriend(me, shy);
    await teachSet(me);
    await earn(me, [0, 1]);
    await earn(friend, [0, 1, 2, 3]);
    await earn(stranger, [3]);
    await earn(shy, [2]);
    await setPrivacy(shy, { trophies: "nobody" });

    const result = await board(me, "/leaderboards/points?scope=friends");
    expect(result).toMatchObject({ board: "points", scope: "friends", game: null, total: 2, around: [] });
    expect(ranks(result.entries)).toEqual([
      [1, friend.id, 435],
      [2, me.id, 45],
    ]);
    expect(result.me).toEqual({ rank: 2, value: 45, listed: true });
    expect(Date.parse(result.updatedAt)).not.toBeNaN();
    // The default scope is friends.
    expect(ranks((await board(me, "/leaderboards/points")).entries)).toEqual(ranks(result.entries));
  });

  it("takes only public trophies globally, keeps flagged players off, and says where a private reader would be", async () => {
    const me = await h.user("gl1@example.com");
    const a = await h.user("gl2@example.com");
    const b = await h.user("gl3@example.com");
    const cheat = await h.user("gl4@example.com");
    await teachSet(me);
    await earn(me, [0, 1]);
    await earn(a, [3]);
    await earn(b, [2]);
    await earn(cheat, [0, 1, 2, 3]);
    for (const user of [a, b, cheat]) await setPrivacy(user, { trophies: "everyone" });
    await h.deps.db.execute(sql`update earned_trophies set flagged = true where account_id = ${cheat.id}`);

    const result = await board(me, "/leaderboards/points?scope=global");
    expect(ranks(result.entries)).toEqual([
      [1, a.id, 300],
      [2, b.id, 90],
    ]);
    expect(result.total).toBe(2);
    expect(result.me).toEqual({ rank: 3, value: 45, listed: false });

    // Kept for a minute; a change shows after that.
    expect(await h.valkey.ttl("lb:global:points")).toBeGreaterThan(0);
    await setPrivacy(me, { trophies: "everyone" });
    expect((await board(me, "/leaderboards/points?scope=global")).me.listed).toBe(false);
    await forget();
    const fresh = await board(me, "/leaderboards/points?scope=global");
    expect(fresh.me).toEqual({ rank: 3, value: 45, listed: true });
    expect(fresh.total).toBe(3);
  });

  it("shares ranks between equal values and shows who is around a reader beyond the list", async () => {
    const users = await Promise.all(
      ["r1", "r2", "r3", "r4", "r5"].map((name) => h.user(`${name}@example.com`)),
    );
    const [first, second, third, fourth, me] = users as [User, User, User, User, User];
    await teachSet(first);
    await earn(first, [3]);
    await earn(second, [2]);
    await earn(third, [2]);
    await earn(fourth, [1]);
    await earn(me, [0]);
    for (const user of users) await setPrivacy(user, { trophies: "everyone" });

    const result = await board(me, "/leaderboards/points?scope=global&limit=2");
    expect(ranks(result.entries)).toEqual([
      [1, first.id, 300],
      [2, expect.any(String), 90],
    ]);
    expect(result.me).toEqual({ rank: 5, value: 15, listed: true });
    expect(ranks(result.around)).toEqual([
      [2, expect.any(String), 90],
      [4, fourth.id, 30],
      [5, me.id, 15],
    ]);

    for (const user of users.slice(1)) await befriend(first, user);
    const friends = await board(first, "/leaderboards/points?scope=friends&limit=3");
    expect(ranks(friends.entries).map(([rank]) => rank)).toEqual([1, 2, 2]);
    expect(friends.around).toEqual([]);
  });
});

describe("per game", () => {
  it("ranks by points, play time and completion, each with its own privacy", async () => {
    const me = await h.user("pg1@example.com");
    const a = await h.user("pg2@example.com");
    const b = await h.user("pg3@example.com");
    await teachSet(me);
    await teachSet(me, other);
    await earn(me, [0, 1, 2, 3]);
    await earn(a, [0]);
    await earn(b, [0, 1], other);
    await play(me, 60);
    await play(a, 300);
    // A's library is public but not their trophies: on the time board only.
    await setPrivacy(a, { library: "everyone" });
    await setPrivacy(me, { library: "everyone", trophies: "everyone" });
    await setPrivacy(b, { library: "everyone", trophies: "everyone" });

    const points = await board(me, `/games/${game}/leaderboard?scope=global`);
    expect(points).toMatchObject({ board: "points", game: { titleId: game, names: { en: `Game ${game}` } } });
    expect(ranks(points.entries)).toEqual([[1, me.id, 435]]);
    const time = await board(me, `/games/${game}/leaderboard?scope=global&by=time`);
    expect(ranks(time.entries)).toEqual([
      [1, a.id, 18000],
      [2, me.id, 3600],
    ]);
    const completion = await board(a, `/games/${game}/leaderboard?scope=global&by=completion`);
    expect(ranks(completion.entries)).toEqual([[1, me.id, 100]]);
    expect(completion.me).toEqual({ rank: 2, value: 25, listed: false });

    const elsewhere = await board(me, `/games/${other}/leaderboard?scope=global`);
    expect(ranks(elsewhere.entries)).toEqual([[1, b.id, 45]]);
    expect(elsewhere.me).toEqual({ rank: null, value: 0, listed: false });
  });

  it("lists games to pick from, the reader's first", async () => {
    const me = await h.user("pick1@example.com");
    const a = await h.user("pick2@example.com");
    const b = await h.user("pick3@example.com");
    await teachSet(me);
    await teachSet(me, other);
    await earn(a, [0], other);
    await earn(b, [0], other);
    await earn(me, [0]);
    const { games } = await board(me, "/leaderboards/games");
    expect(games).toEqual([
      { titleId: game, names: { en: `Game ${game}` }, iconUrl: null, players: 1, mine: true },
      { titleId: other, names: { en: `Game ${other}` }, iconUrl: null, players: 2, mine: false },
    ]);
  });

  it("refuses unknown games and bad parameters", async () => {
    const me = await h.user("bad1@example.com");
    expect((await h.call("GET", `${v1}/games/CUSA00001/leaderboard`, undefined, me.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/games/nope/leaderboard`, undefined, me.token)).status).toBe(400);
    await teachSet(me);
    for (const query of ["scope=all", "by=speed", "limit=0", "limit=101"])
      expect(
        (await h.call("GET", `${v1}/games/${game}/leaderboard?${query}`, undefined, me.token)).status,
      ).toBe(400);
    expect((await h.call("GET", `${v1}/leaderboards/points`)).status).toBe(401);
  });
});
