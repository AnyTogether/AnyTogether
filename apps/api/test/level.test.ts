import { readFileSync } from "node:fs";
import { trophyLevelOf } from "@anytogether/shared";
import { sql } from "drizzle-orm";
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
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** Bronze 0 (15), silver 1 (30), gold 2 (90), platinum 3 (300). */
async function teachSet(user: User) {
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "First steps" } } },
        { id: 1, grade: "silver", texts: { en: { name: "Halfway" } } },
        { id: 2, grade: "gold", texts: { en: { name: "The twist" } } },
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

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

describe("trophy level", () => {
  it("goes up as trophies arrive: kept on the profile, told to friends, a feed item and a notification", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    await befriend(ana, ben);
    await teachSet(ana);
    const before = await h.call("GET", `${v1}/me`, undefined, ana.token);
    expect(before.body.profile.trophyLevel).toMatchObject({ level: 1, points: 0, tier: "bronze" });

    const heard = await listen(ben.id);
    await earn(ana, [0, 1]); // 45 points: still level 1
    expect((await h.call("GET", `${v1}/me`, undefined, ana.token)).body.profile.trophyLevel.level).toBe(1);
    await earn(ana, [2, 3]); // 435 points: level 8
    await settle();
    heard.stop();
    const after = await h.call("GET", `${v1}/me`, undefined, ana.token);
    expect(after.body.profile.trophyLevel).toEqual(trophyLevelOf(435));
    expect(after.body.profile.trophyLevel.level).toBe(8);

    const up = heard.heard.filter((e) => e.type === "level.up");
    expect(up).toHaveLength(1);
    expect(up[0]?.data).toMatchObject({ userId: ana.id, level: 8, tier: "bronze", frame: 1 });

    const feed = await h.call("GET", `${v1}/me/feed`, undefined, ben.token);
    const item = feed.body.items.find((i: { kind: string }) => i.kind === "level_up");
    expect(item).toMatchObject({ actor: { userId: ana.id }, level: { level: 8, tier: "bronze" } });

    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, ana.token);
    const note = notes.body.notifications.find((n: { kind: string }) => n.kind === "level_up");
    expect(note).toMatchObject({ data: { level: 8 }, actor: { userId: ana.id } });
  });

  it("old trophies raise the level without a feed item", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    await befriend(ana, ben);
    await teachSet(ana);
    await earn(ana, [0, 1, 2, 3], ago(24 * 400));
    expect((await h.call("GET", `${v1}/me`, undefined, ana.token)).body.profile.trophyLevel.level).toBe(8);
    const feed = await h.call("GET", `${v1}/me/feed`, undefined, ben.token);
    expect(feed.body.items.filter((i: { kind: string }) => i.kind === "level_up")).toEqual([]);
  });

  it("shows on profiles, friends lists and leaderboards to who may see the trophies", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    await befriend(ana, ben);
    await teachSet(ana);
    await earn(ana, [3]); // 300 points: level 6

    const asFriend = await h.call("GET", `${v1}/users/${ana.handle}`, undefined, ben.token);
    expect(asFriend.body.trophyLevel).toMatchObject({ level: 6, points: 300 });
    // Trophies are friends-only by default: a stranger sees no level.
    const asStranger = await h.call("GET", `${v1}/users/${ana.handle}`, undefined, cem.token);
    expect(asStranger.body.trophyLevel).toBeNull();

    const friends = await h.call("GET", `${v1}/me/friends`, undefined, ben.token);
    expect(friends.body.friends[0].level).toEqual({ level: 6, tier: "bronze", frame: 1 });
    const theirs = await h.call("GET", `${v1}/users/${ben.handle}/friends`, undefined, ben.token);
    expect(theirs.body.friends[0].level).toEqual({ level: 6, tier: "bronze", frame: 1 });

    const board = await h.call("GET", `${v1}/leaderboards/points?scope=friends`, undefined, ben.token);
    expect(board.body.entries[0]).toMatchObject({ user: { userId: ana.id }, level: { level: 6 } });

    // Hidden from everyone: friends lose it too.
    await h.call("PATCH", `${v1}/me/privacy`, { trophies: "nobody" }, ana.token);
    const hidden = await h.call("GET", `${v1}/me/friends`, undefined, ben.token);
    expect(hidden.body.friends[0].level).toBeNull();
  });

  it("is filled in for everyone by the migration with the same curve", async () => {
    const migration = readFileSync(
      new URL("../../../packages/db/drizzle/0012_psn.sql", import.meta.url),
      "utf8",
    );
    const expression = migration.split("-- level:begin")[1]?.split("-- level:end")[0]?.trim();
    expect(expression).toBeTruthy();
    const samples = [
      0, 59, 60, 435, 5939, 5940, 14_939, 14_940, 59_940, 464_940, 1_631_339, 1_631_340, 9_999_999,
    ];
    const rows = await h.deps.db.execute<{ points: number; level: number }>(
      sql.raw(
        `select t.points, ${expression} as level from (values ${samples.map((p) => `(${p})`).join(", ")}) as t(points)`,
      ),
    );
    for (const row of rows) expect(Number(row.level)).toBe(trophyLevelOf(Number(row.points)).level);
  });
});
