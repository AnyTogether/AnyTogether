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
type Standing = { rank: number; user: { userId: string } | null; value: number; me: boolean };
const v1 = "/api/v1";
const game = "PPSA01234";
const set = "a1b2c3d4e5f6";
const hour = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
async function teachSet(user: User) {
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
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
const earn = (user: User, ids: number[], earnedAt: number) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    {
      trophies: ids.map((trophyId) => ({
        titleId: game,
        setHash: set,
        trophyId,
        earnedAt: new Date(earnedAt).toISOString(),
      })),
    },
    user.token,
  );
async function play(user: User, from: number, to: number) {
  const deviceId = uuidv7();
  await h.call("POST", `${v1}/me/devices`, { id: deviceId, platform: "macos", name: "Mac" }, user.token);
  await h.call(
    "POST",
    `${v1}/me/sessions`,
    {
      sessions: [
        {
          id: uuidv7(),
          titleId: game,
          deviceId,
          startedAt: new Date(from).toISOString(),
          endedAt: new Date(to).toISOString(),
        },
      ],
    },
    user.token,
  );
}
const make = (user: User, input: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/challenges`,
    {
      title: "Weekend race",
      titleId: game,
      metric: "points",
      audience: "friends",
      startsAt: at(60_000),
      endsAt: at(48 * hour),
      ...input,
    },
    user.token,
  );
/** Moves a challenge's window (the API only takes windows from now on). */
const window = (id: string, startsAt: number, endsAt: number) =>
  h.deps.db.execute(
    sql`update challenges set starts_at = ${new Date(startsAt).toISOString()}::timestamptz,
      ends_at = ${new Date(endsAt).toISOString()}::timestamptz where id = ${id}::uuid`,
  );
const detail = (user: User, id: string) => h.call("GET", `${v1}/challenges/${id}`, undefined, user.token);
const rows = (standings: Standing[]) => standings.map((s) => [s.rank, s.user?.userId ?? null, s.value]);
const notificationsOf = async (user: User) =>
  (await h.call("GET", `${v1}/me/notifications`, undefined, user.token)).body.notifications as {
    kind: string;
    subjectId: string;
    data: Record<string, unknown>;
  }[];
const forget = async () => {
  const keys = await h.valkey.keys("ch:*");
  if (keys.length) await h.valkey.del(...keys);
};

describe("making a challenge", () => {
  it("checks the window, the game, the texts and the community", async () => {
    const ana = await h.user("ana@example.com");
    await teachSet(ana);
    expect((await make(ana, { endsAt: at(30 * 60_000) })).status).toBe(400);
    expect((await make(ana, { startsAt: at(-hour), endsAt: at(hour) })).status).toBe(400);
    expect((await make(ana, { startsAt: at(91 * 24 * hour), endsAt: at(92 * 24 * hour) })).status).toBe(400);
    expect((await make(ana, { endsAt: at(91 * 24 * hour) })).status).toBe(400);
    expect((await make(ana, { title: "go to cats.com" })).status).toBe(400);
    expect((await make(ana, { metric: "speed" })).status).toBe(400);
    expect((await make(ana, { titleId: "PPSA99999" })).status).toBe(404);
    expect((await make(ana, { audience: "community" })).status).toBe(400);
    expect((await make(ana, { audience: "community", communityId: uuidv7() })).status).toBe(404);

    const made = await make(ana, { description: "Most points by Sunday." });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      title: "Weekend race",
      description: "Most points by Sunday.",
      game: { titleId: game, names: { en: "Cat Quest" } },
      metric: "points",
      audience: "friends",
      community: null,
      creator: { userId: ana.id },
      state: "upcoming",
      final: false,
      entrants: 1,
      joined: true,
      mine: true,
      canCancel: true,
      leader: null,
      myStanding: null,
    });
  });

  it("keeps how many one person runs at once in check", async () => {
    const ana = await h.user("ana@example.com");
    await teachSet(ana);
    for (let i = 0; i < 10; i++) expect((await make(ana)).status).toBe(201);
    expect((await make(ana)).status).toBe(409);
  });
});

describe("who sees and joins a challenge", () => {
  it("friends challenges reach the maker's friends only", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const eve = await h.user("eve@example.com");
    await teachSet(ana);
    await befriend(ana, ben);
    const made = await make(ana);
    const id = made.body.id as string;

    const list = await h.call("GET", `${v1}/challenges`, undefined, ben.token);
    expect(list.body.challenges.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await h.call("GET", `${v1}/challenges`, undefined, eve.token)).body.challenges).toEqual([]);
    expect((await detail(eve, id)).status).toBe(404);
    expect((await h.call("POST", `${v1}/challenges/${id}/join`, {}, eve.token)).status).toBe(404);

    const joined = await h.call("POST", `${v1}/challenges/${id}/join`, {}, ben.token);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ joined: true, entrants: 2, mine: false, canCancel: false });
    const mine = await h.call("GET", `${v1}/me/challenges`, undefined, ben.token);
    expect(mine.body.challenges.map((c: { id: string }) => c.id)).toEqual([id]);
    // By game, as the leaderboards ask.
    const byGame = await h.call("GET", `${v1}/challenges?titleId=${game}`, undefined, ben.token);
    expect(byGame.body.challenges).toHaveLength(1);
    expect(
      (await h.call("GET", `${v1}/challenges?titleId=PPSA05678`, undefined, ben.token)).body.challenges,
    ).toEqual([]);

    const left = await h.call("POST", `${v1}/challenges/${id}/leave`, {}, ben.token);
    expect(left.body).toMatchObject({ joined: false, entrants: 1 });
    // The maker cancels rather than leaves.
    expect((await h.call("POST", `${v1}/challenges/${id}/leave`, {}, ana.token)).status).toBe(409);
  });

  it("community challenges reach its members, and public ones everyone but those blocked", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const eve = await h.user("eve@example.com");
    const troll = await h.user("troll@example.com");
    await teachSet(ana);
    const community = await h.call(
      "POST",
      `${v1}/communities`,
      { name: "Cat Questers", titleId: game, icon: "pad-cosmic" },
      ana.token,
    );
    const communityId = community.body.id as string;
    await h.call("POST", `${v1}/communities/${communityId}/join`, {}, ben.token);
    expect((await make(eve, { audience: "community", communityId })).status).toBe(403);
    const inside = await make(ana, { audience: "community", communityId });
    expect(inside.status).toBe(201);
    expect(inside.body.community).toMatchObject({ id: communityId, name: "Cat Questers" });
    expect((await detail(ben, inside.body.id)).status).toBe(200);
    expect((await detail(eve, inside.body.id)).status).toBe(404);

    const open = await make(ana, { audience: "public", title: "Open race" });
    expect((await detail(eve, open.body.id)).status).toBe(200);
    await h.call("POST", `${v1}/me/blocks`, { userId: troll.id }, ana.token);
    expect((await detail(troll, open.body.id)).status).toBe(404);
    expect((await h.call("POST", `${v1}/challenges/${open.body.id}/join`, {}, troll.token)).status).toBe(404);
    const trollList = await h.call("GET", `${v1}/challenges`, undefined, troll.token);
    expect(trollList.body.challenges).toEqual([]);
  });

  it("invites friends who may join, and tells them", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const eve = await h.user("eve@example.com");
    await teachSet(ana);
    await befriend(ana, ben);
    const made = await make(ana, { invite: [ben.id, eve.id] });
    await h.app.notes.flush();
    const told = (await notificationsOf(ben)).filter((n) => n.kind === "challenge_invite");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      subjectId: made.body.id,
      data: { challengeId: made.body.id, title: "Weekend race", titleId: game, metric: "points" },
    });
    // Eve is no friend of Ana's: no invite.
    expect((await notificationsOf(eve)).filter((n) => n.kind === "challenge_invite")).toEqual([]);
    const again = await h.call(
      "POST",
      `${v1}/challenges/${made.body.id}/invites`,
      { userIds: [eve.id] },
      ana.token,
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ invited: 0 });
    // Only people in it invite.
    expect(
      (await h.call("POST", `${v1}/challenges/${made.body.id}/invites`, { userIds: [ana.id] }, ben.token))
        .status,
    ).toBe(403);
  });
});

describe("standings", () => {
  it("count only the window: trophy points, trophies and play time, never flagged trophies", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cy = await h.user("cy@example.com");
    await teachSet(ana);
    for (const friend of [ben, cy]) await befriend(ana, friend);
    const points = await make(ana, { metric: "points" });
    const count = await make(ana, { metric: "trophies", title: "Most trophies" });
    const time = await make(ana, { metric: "time", title: "Most hours" });
    const start = Date.now() - 4 * hour;
    const end = Date.now() + 10 * hour;
    for (const made of [points, count, time]) {
      await window(made.body.id, start, end);
      for (const friend of [ben, cy])
        await h.call("POST", `${v1}/challenges/${made.body.id}/join`, {}, friend.token);
    }
    // Before the window: not counted.
    await earn(ana, [3], start - hour);
    await earn(ana, [0], start + hour);
    await earn(ben, [1, 2], start + hour);
    await earn(cy, [3], start + 2 * hour);
    await h.deps.db.execute(sql`update earned_trophies set flagged = true where account_id = ${cy.id}`);
    // Half of Ana's session is before the window; Ben's two overlap on two computers and count
    // once.
    await play(ana, start - hour, start + hour);
    await play(ben, start, start + 2 * hour);
    await play(ben, start + hour, start + 3 * hour);

    // Standings are kept for 30 seconds; joining worked them out already.
    await forget();
    const byPoints = await detail(ana, points.body.id);
    expect(byPoints.status).toBe(200);
    expect(byPoints.body.state).toBe("active");
    expect(rows(byPoints.body.standings)).toEqual([
      [1, ben.id, 120],
      [2, ana.id, 15],
      [3, cy.id, 0],
    ]);
    expect(byPoints.body.standings[1].me).toBe(true);
    expect(byPoints.body.leader).toMatchObject({ rank: 1, value: 120, user: { userId: ben.id } });
    expect(byPoints.body.myStanding).toEqual({ rank: 2, value: 15 });
    expect(rows((await detail(ana, count.body.id)).body.standings)).toEqual([
      [1, ben.id, 2],
      [2, ana.id, 1],
      [3, cy.id, 0],
    ]);
    expect(rows((await detail(ana, time.body.id)).body.standings)).toEqual([
      [1, ben.id, 3 * 3600],
      [2, ana.id, 3600],
      [3, cy.id, 0],
    ]);
  });

  it("show someone blocked as a hidden place", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const eve = await h.user("eve@example.com");
    await teachSet(ana);
    const made = await make(ana, { audience: "public" });
    await window(made.body.id, Date.now() - hour, Date.now() + hour);
    await h.call("POST", `${v1}/challenges/${made.body.id}/join`, {}, ben.token);
    await h.call("POST", `${v1}/challenges/${made.body.id}/join`, {}, eve.token);
    await earn(eve, [3], Date.now() - 60_000);
    await earn(ben, [0], Date.now() - 60_000);
    await h.call("POST", `${v1}/me/blocks`, { userId: eve.id }, ben.token);
    await forget();
    const seen = await detail(ben, made.body.id);
    expect(rows(seen.body.standings)).toEqual([
      [1, null, 300],
      [2, ben.id, 15],
      [3, ana.id, 0],
    ]);
    expect(seen.body.leader).toMatchObject({ rank: 1, user: null });
  });
});

describe("start, end and winner", () => {
  it("tells the people in it when it starts and when it is final, and writes the result down", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    await teachSet(ana);
    await befriend(ana, ben);
    const made = await make(ana);
    const id = made.body.id as string;
    await h.call("POST", `${v1}/challenges/${id}/join`, {}, ben.token);
    // Nothing to tell before the start.
    expect(await h.app.sweepChallenges()).toBe(0);

    await window(id, Date.now() - hour, Date.now() + hour);
    expect(await h.app.sweepChallenges()).toBe(1);
    await h.app.notes.flush();
    expect((await notificationsOf(ben)).filter((n) => n.kind === "challenge_started")).toHaveLength(1);
    // The maker started it; they are not told.
    expect((await notificationsOf(ana)).filter((n) => n.kind === "challenge_started")).toEqual([]);
    expect(await h.app.sweepChallenges()).toBe(0);

    await earn(ben, [2], Date.now() - 150 * 60_000);
    await earn(ana, [0], Date.now() - 150 * 60_000);
    // Over, but inside the grace hour: ended, not final yet.
    await window(id, Date.now() - 3 * hour, Date.now() - 10 * 60_000);
    await forget();
    const ended = await detail(ana, id);
    expect(ended.body).toMatchObject({ state: "ended", final: false });
    expect((await h.call("POST", `${v1}/challenges/${id}/leave`, {}, ben.token)).status).toBe(409);
    expect(await h.app.sweepChallenges()).toBe(0);

    await window(id, Date.now() - 4 * hour, Date.now() - 2 * hour);
    expect(await h.app.sweepChallenges()).toBe(1);
    await h.app.notes.flush();
    const final = await detail(ana, id);
    expect(final.body).toMatchObject({
      state: "ended",
      final: true,
      leader: { rank: 1, value: 90, user: { userId: ben.id } },
      myStanding: { rank: 2, value: 15 },
    });
    // A trophy that arrives later changes nothing now.
    await earn(ana, [3], Date.now() - 3 * hour);
    await forget();
    expect(rows((await detail(ana, id)).body.standings)).toEqual([
      [1, ben.id, 90],
      [2, ana.id, 15],
    ]);
    const endedNotes = (await notificationsOf(ana)).filter((n) => n.kind === "challenge_ended");
    expect(endedNotes).toHaveLength(1);
    expect(endedNotes[0]?.data).toMatchObject({
      challengeId: id,
      rank: 2,
      value: 15,
      entrants: 2,
      winner: { handle: ben.handle, value: 90 },
    });
    expect((await notificationsOf(ben)).find((n) => n.kind === "challenge_ended")?.data).toMatchObject({
      rank: 1,
    });
    expect(await h.app.sweepChallenges()).toBe(0);

    // Ended ones are listed on asking.
    const past = await h.call("GET", `${v1}/challenges?state=ended`, undefined, ana.token);
    expect(past.body.challenges.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await h.call("GET", `${v1}/challenges`, undefined, ana.token)).body.challenges).toEqual([]);
  });

  it("is cancelled by its maker only, and then counts nothing", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cy = await h.user("cy@example.com");
    await teachSet(ana);
    await befriend(ana, ben);
    await befriend(ana, cy);
    const made = await make(ana, { invite: [ben.id, cy.id] });
    const id = made.body.id as string;
    await h.call("POST", `${v1}/challenges/${id}/join`, {}, ben.token);
    expect((await h.call("DELETE", `${v1}/challenges/${id}`, undefined, ben.token)).status).toBe(403);
    const cancelled = await h.call("DELETE", `${v1}/challenges/${id}`, undefined, ana.token);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ state: "cancelled", canCancel: false });
    expect((await h.call("POST", `${v1}/challenges/${id}/join`, {}, ben.token)).status).toBe(409);
    expect((await h.call("GET", `${v1}/challenges`, undefined, ben.token)).body.challenges).toEqual([]);
    // Ben joined, so his invite was read; Cy's, still unread, is taken back.
    expect((await notificationsOf(ben)).filter((n) => n.kind === "challenge_invite")).toHaveLength(1);
    expect((await notificationsOf(cy)).filter((n) => n.kind === "challenge_invite")).toEqual([]);
    await window(id, Date.now() - 4 * hour, Date.now() - 2 * hour);
    expect(await h.app.sweepChallenges()).toBe(0);
  });
});
