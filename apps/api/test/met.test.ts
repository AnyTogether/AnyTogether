import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneMeetings } from "../src/met.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness({
    turn: { secret: "relay-secret", urls: ["stun:relay.test:3478"] },
    limits: {
      lfgPostNew: { max: 100, seconds: 86_400 },
      joinRequestNew: { max: 100, seconds: 3600 },
    },
  });
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const game = "PPSA01234";

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const playing = (user: User, titleId = game) =>
  h.valkey.set(`presence:${user.id}`, JSON.stringify({ state: "in_game", titleId }), "EX", 60);
const met = async (user: User, query = "") =>
  (await h.call("GET", `${v1}/me/players-met${query}`, undefined, user.token)).body;

/** A public party that anyone may walk into, for `game`. */
async function openParty(leader: User) {
  const made = await h.call(
    "POST",
    `${v1}/parties`,
    { privacy: "invite", public: { join: "open", titleId: game } },
    leader.token,
  );
  return made.body.id as string;
}

describe("players met", () => {
  it("remembers who walked into a party, both ways, with the game; strangers can befriend from there", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const party = await openParty(ana);
    expect((await h.call("POST", `${v1}/parties/${party}/join`, {}, ben.token)).status).toBe(200);
    expect((await h.call("POST", `${v1}/parties/${party}/join`, {}, cem.token)).status).toBe(200);

    const forBen = await met(ben);
    expect(forBen.remember).toBe(true);
    expect(forBen.days).toBe(30);
    expect(forBen.players.map((p: { user: { userId: string } }) => p.user.userId).sort()).toEqual(
      [ana.id, cem.id].sort(),
    );
    expect(forBen.players[0]).toMatchObject({
      source: "party",
      game: { titleId: game },
      times: 1,
      friendship: "none",
    });
    const forAna = await met(ana);
    expect(forAna.players).toHaveLength(2);

    // Ben asks Ana to be friends from the list: it says so next time.
    await h.call("POST", `${v1}/me/friends/requests`, { handle: ana.handle }, ben.token);
    const after = await met(ben);
    expect(after.players.find((p: { user: { userId: string } }) => p.user.userId === ana.id).friendship).toBe(
      "pending_out",
    );
    // Leaving and walking in again within the hour counts once.
    await h.call("POST", `${v1}/parties/${party}/leave`, {}, cem.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, cem.token);
    const again = await met(cem);
    expect(again.players.every((p: { times: number }) => p.times === 1)).toBe(true);
  });

  it("remembers share plays, game sessions and posts one was let in on", async () => {
    const host = await h.user("host@example.com");
    const friend = await h.user("friend@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(host, friend);
    await playing(host);
    const share = await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: game, title: "Cat Quest III" },
      host.token,
    );
    expect(
      (await h.call("POST", `${v1}/share-plays/${share.body.sharePlay.id}/join`, {}, friend.token)).status,
    ).toBe(201);
    expect((await met(friend)).players[0]).toMatchObject({ user: { userId: host.id }, source: "share_play" });

    const session = await h.call(
      "POST",
      `${v1}/game-sessions`,
      { titleId: "CUSA00001", gameVersion: "01.000", engineBuild: "0.2.13", capacity: 4 },
      host.token,
    );
    await h.call(
      "POST",
      `${v1}/game-sessions/${session.body.id}/join`,
      { gameVersion: "01.000", engineBuild: "0.2.13" },
      friend.token,
    );
    expect((await met(friend)).players[0]).toMatchObject({
      source: "game_session",
      game: { titleId: "CUSA00001" },
    });

    const post = await h.call(
      "POST",
      `${v1}/lfg`,
      { titleId: game, purpose: "online", languages: ["en"], slots: 2 },
      host.token,
    );
    await h.call("POST", `${v1}/lfg/${post.body.id}/requests`, {}, stranger.token);
    const yes = await h.call(
      "POST",
      `${v1}/lfg/${post.body.id}/requests/${stranger.id}/accept`,
      {},
      host.token,
    );
    expect(yes.status).toBe(200);
    expect((await met(stranger)).players[0]).toMatchObject({ user: { userId: host.id }, source: "lfg" });
  });

  it("leaves out blocks, forgets one person, turns off both ways, and forgets after 90 days", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const party = await openParty(ana);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, ben.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, cem.token);

    await h.call("POST", `${v1}/me/blocks`, { userId: cem.id }, ben.token);
    expect((await met(ben)).players.map((p: { user: { userId: string } }) => p.user.userId)).toEqual([
      ana.id,
    ]);
    expect((await met(cem)).players.map((p: { user: { userId: string } }) => p.user.userId)).toEqual([
      ana.id,
    ]);

    expect((await h.call("DELETE", `${v1}/me/players-met/${ben.id}`, undefined, ana.token)).status).toBe(204);
    expect((await h.call("DELETE", `${v1}/me/players-met/${ben.id}`, undefined, ana.token)).status).toBe(404);
    expect((await met(ana)).players).toHaveLength(1);
    expect((await met(ben)).players).toHaveLength(1);

    expect((await h.call("PATCH", `${v1}/me/players-met`, { remember: false }, cem.token)).body).toEqual({
      remember: false,
    });
    expect((await met(ana)).players).toHaveLength(0);
    expect((await met(cem)).remember).toBe(false);
    // Nobody remembers Cem from here on.
    await h.call("POST", `${v1}/parties/${party}/leave`, {}, cem.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, cem.token);
    expect((await met(ana)).players).toHaveLength(0);

    await h.deps.db.execute(sql`update met_players set last_met_at = now() - interval '40 days'`);
    expect((await met(ben)).players).toHaveLength(0);
    expect((await met(ben, "?days=90")).players).toHaveLength(1);
    expect((await h.call("GET", `${v1}/me/players-met?days=91`, undefined, ben.token)).status).toBe(400);
    await h.deps.db.execute(sql`update met_players set last_met_at = now() - interval '91 days'`);
    expect(await pruneMeetings(h.deps.db)).toBe(1);
    expect((await met(ben, "?days=90")).players).toHaveLength(0);
  });
});
