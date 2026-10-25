import { joinCodes } from "@anytogether/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { mute } from "../src/moderation.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
type User = Awaited<ReturnType<typeof h.user>>;

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return {
    heard,
    of: (type: string) => heard.filter((e) => e.type === type),
    stop: () => events.disconnect(),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A party led by `leader` with a join code; returns the party ID and the code. */
async function partyWithCode(leader: User, hours?: number) {
  const party = await h.call("POST", `${v1}/parties`, {}, leader.token);
  const issued = await h.call(
    "POST",
    `${v1}/parties/${party.body.id}/code`,
    hours ? { hours } : {},
    leader.token,
  );
  expect(issued.status).toBe(201);
  return { partyId: party.body.id as string, code: issued.body.code as string, issued: issued.body };
}

/** A family with a manager and a linked child. */
async function familyWithChild() {
  const mom = await h.user("mom@example.com");
  await h.call("POST", `${v1}/families`, { name: "Home" }, mom.token);
  const kid = await h.user("kid@example.com");
  const { body } = await h.call("POST", `${v1}/me/family/link-codes`, {}, mom.token);
  await h.call("POST", `${v1}/me/family/join`, { code: body.code, timeZone: "Europe/Istanbul" }, kid.token);
  return { mom, kid };
}
const restrict = (mom: User, kid: User, update: Record<string, unknown>) =>
  h.call("PATCH", `${v1}/me/family/children/${kid.id}/restrictions`, update, mom.token);

describe("party join codes", () => {
  it("a stranger with the code asks, the leader says yes, and the stranger joins from the invite", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const friend = await h.user("friend@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(leader, friend);
    const { partyId, code, issued } = await partyWithCode(leader);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(issued.url).toBe(`https://anytogether.test/join/${code}`);
    const hours = (Date.parse(issued.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    // Members see it; only the leader hands one out.
    await h.call("POST", `${v1}/parties/${partyId}/invites`, { userIds: [friend.id] }, leader.token);
    await h.call("POST", `${v1}/parties/${partyId}/join`, {}, friend.token);
    expect((await h.call("GET", `${v1}/parties/${partyId}`, undefined, friend.token)).body.joinCode).toEqual(
      issued,
    );
    expect((await h.call("POST", `${v1}/parties/${partyId}/code`, {}, friend.token)).status).toBe(403);

    // Signed out: what it opens, with no user IDs.
    const preview = await h.call("GET", `${v1}/join/${code.toLowerCase().slice(0, 4)}-${code.slice(4)}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      code,
      kind: "party",
      id: partyId,
      size: 2,
      max: 8,
      host: { handle: "lead" },
    });
    expect(preview.body.host.userId).toBeUndefined();
    expect(preview.body.state).toBeUndefined();
    // Signed in: where the reader stands.
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe("none");
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, friend.token)).body.state).toBe("member");

    const leaderHears = await listen(leader.id);
    const asked = await h.call("POST", `${v1}/join/${code}`, {}, stranger.token);
    expect(asked.status).toBe(201);
    expect(asked.body).toEqual({ kind: "party", id: partyId, state: "requested" });
    // Asking again is the same request.
    expect((await h.call("POST", `${v1}/join/${code}`, {}, stranger.token)).status).toBe(200);
    await settle();
    expect(leaderHears.of("party.request")[0]?.data).toMatchObject({
      partyId,
      via: "code",
      from: { userId: stranger.id },
    });
    leaderHears.stop();
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe(
      "requested",
    );
    const seen = await h.call("GET", `${v1}/parties/${partyId}`, undefined, leader.token);
    expect(seen.body.requests.map((r: { userId: string }) => r.userId)).toEqual([stranger.id]);
    expect((await h.call("GET", `${v1}/me/party`, undefined, stranger.token)).body.requests).toEqual([
      { partyId, askedAt: expect.any(String) },
    ]);
    // Asking is not joining: the stranger cannot walk in.
    expect((await h.call("POST", `${v1}/parties/${partyId}/join`, {}, stranger.token)).status).toBe(404);

    const strangerHears = await listen(stranger.id);
    const accepted = await h.call(
      "POST",
      `${v1}/parties/${partyId}/requests/${stranger.id}/accept`,
      {},
      leader.token,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.requests).toEqual([]);
    await settle();
    expect(strangerHears.of("party.request_answered")[0]?.data).toEqual({ partyId, answer: "accepted" });
    expect(strangerHears.of("party.invite")[0]?.data).toMatchObject({ partyId });
    strangerHears.stop();
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe("invited");
    const joined = await h.call("POST", `${v1}/parties/${partyId}/join`, {}, stranger.token);
    expect(joined.status).toBe(200);
    expect(joined.body.members).toHaveLength(3);
  });

  it("the leader says no, and the asker hears it", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const stranger = await h.user("stranger@example.com");
    const { partyId, code } = await partyWithCode(leader);
    await h.call("POST", `${v1}/join/${code}`, {}, stranger.token);
    const hears = await listen(stranger.id);
    await h.call("POST", `${v1}/parties/${partyId}/requests/${stranger.id}/decline`, {}, leader.token);
    await settle();
    expect(hears.of("party.request_answered")[0]?.data).toEqual({ partyId, answer: "declined" });
    expect(hears.of("party.invite")).toEqual([]);
    hears.stop();
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe("none");
  });

  it("stops working when revoked, replaced, run out, or the party ends", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const stranger = await h.user("stranger@example.com");
    const first = await partyWithCode(leader, 2);
    expect((Date.parse(first.issued.expiresAt) - Date.now()) / 3_600_000).toBeLessThanOrEqual(2);
    expect(
      (await h.call("POST", `${v1}/parties/${first.partyId}/code`, { hours: 73 }, leader.token)).status,
    ).toBe(400);

    // A new code replaces the old.
    const second = await h.call("POST", `${v1}/parties/${first.partyId}/code`, {}, leader.token);
    expect(second.body.code).not.toBe(first.code);
    expect((await h.call("GET", `${v1}/join/${first.code}`)).status).toBe(404);
    expect((await h.call("POST", `${v1}/join/${first.code}`, {}, stranger.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/join/${second.body.code}`)).status).toBe(200);

    // Revoked.
    expect(
      (await h.call("DELETE", `${v1}/parties/${first.partyId}/code`, undefined, leader.token)).status,
    ).toBe(204);
    expect((await h.call("GET", `${v1}/join/${second.body.code}`)).status).toBe(404);
    expect(
      (await h.call("GET", `${v1}/parties/${first.partyId}`, undefined, leader.token)).body.joinCode,
    ).toBeNull();
    expect(
      (await h.call("DELETE", `${v1}/parties/${first.partyId}/code`, undefined, leader.token)).status,
    ).toBe(404);

    // Run out.
    const third = await h.call("POST", `${v1}/parties/${first.partyId}/code`, {}, leader.token);
    await h.deps.db
      .update(joinCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(joinCodes.code, third.body.code));
    expect((await h.call("GET", `${v1}/join/${third.body.code}`)).status).toBe(404);
    expect(
      (await h.call("GET", `${v1}/parties/${first.partyId}`, undefined, leader.token)).body.joinCode,
    ).toBeNull();

    // The party ended.
    const fourth = await h.call("POST", `${v1}/parties/${first.partyId}/code`, {}, leader.token);
    await h.call("POST", `${v1}/join/${fourth.body.code}`, {}, stranger.token);
    const hears = await listen(stranger.id);
    await h.call("POST", `${v1}/parties/${first.partyId}/leave`, {}, leader.token);
    await settle();
    expect(hears.of("party.request_answered")[0]?.data).toMatchObject({ answer: "declined" });
    hears.stop();
    expect((await h.call("GET", `${v1}/join/${fourth.body.code}`)).status).toBe(404);

    // Nonsense is no code.
    expect((await h.call("GET", `${v1}/join/not-a-code`)).status).toBe(404);
  });

  it("requests from the code outlive taking the party off the public list", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const stranger = await h.user("stranger@example.com");
    const party = await h.call("POST", `${v1}/parties`, { public: { join: "request" } }, leader.token);
    const issued = await h.call("POST", `${v1}/parties/${party.body.id}/code`, {}, leader.token);
    await h.call("POST", `${v1}/join/${issued.body.code}`, {}, stranger.token);
    const unlisted = await h.call("PATCH", `${v1}/parties/${party.body.id}`, { public: null }, leader.token);
    expect(unlisted.body.requests.map((r: { userId: string }) => r.userId)).toEqual([stranger.id]);
  });

  it("keeps out the blocked, members, the muted and the rate-limited", async () => {
    h = await harness({ limits: { joinRequestNew: { max: 2, seconds: 3600 } } });
    const leader = await h.user("lead@example.com");
    const blocked = await h.user("blocked@example.com");
    const { partyId, code } = await partyWithCode(leader);

    await h.call("POST", `${v1}/me/blocks`, { userId: blocked.id }, leader.token);
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, blocked.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/join/${code}`, {}, blocked.token)).status).toBe(404);
    // A block by a member counts too.
    const member = await h.user("member@example.com");
    const other = await h.user("other@example.com");
    await befriend(leader, member);
    await h.call("POST", `${v1}/parties/${partyId}/invites`, { userIds: [member.id] }, leader.token);
    await h.call("POST", `${v1}/parties/${partyId}/join`, {}, member.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: other.id }, member.token);
    expect((await h.call("POST", `${v1}/join/${code}`, {}, other.token)).status).toBe(404);

    expect((await h.call("POST", `${v1}/join/${code}`, {}, member.token)).status).toBe(409);
    expect((await h.call("POST", `${v1}/join/${code}`, {}, leader.token)).status).toBe(409);

    const troll = await h.user("troll@example.com");
    await mute(h.deps, troll.id);
    expect((await h.call("POST", `${v1}/join/${code}`, {}, troll.token)).body.code).toBe("account_muted");

    // New accounts ask strangers twice an hour here.
    const eager = await h.user("eager@example.com");
    const codes = [code, (await partyWithCode(await h.user("l2@example.com"))).code];
    codes.push((await partyWithCode(await h.user("l3@example.com"))).code);
    expect((await h.call("POST", `${v1}/join/${codes[0]}`, {}, eager.token)).status).toBe(201);
    expect((await h.call("POST", `${v1}/join/${codes[1]}`, {}, eager.token)).status).toBe(201);
    const third = await h.call("POST", `${v1}/join/${codes[2]}`, {}, eager.token);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("follows the family rules of a child on either side", async () => {
    h = await harness();
    const { mom, kid } = await familyWithChild();
    const leader = await h.user("lead@example.com");
    const { code } = await partyWithCode(leader);

    // Public matchmaking off (the default): no asking strangers.
    const refused = await h.call("POST", `${v1}/join/${code}`, {}, kid.token);
    expect(refused.body).toMatchObject({ code: "restricted_by_family", feature: "public_matchmaking" });
    // On, but only friends may talk to the child.
    await restrict(mom, kid, { publicMatchmaking: true, messages: "friends" });
    const talk = await h.call("POST", `${v1}/join/${code}`, {}, kid.token);
    expect(talk.body).toMatchObject({ code: "restricted_by_family", feature: "messages" });
    // A parent approved the leader.
    await restrict(mom, kid, { approvedContacts: [leader.id] });
    expect((await h.call("POST", `${v1}/join/${code}`, {}, kid.token)).status).toBe(201);

    // A child leading a party hands out no code while public matchmaking is off.
    await restrict(mom, kid, { publicMatchmaking: false });
    const own = await h.call("POST", `${v1}/parties`, {}, kid.token);
    const issue = await h.call("POST", `${v1}/parties/${own.body.id}/code`, {}, kid.token);
    expect(issue.body).toMatchObject({ code: "restricted_by_family", feature: "public_matchmaking" });
    // And a stranger cannot ask into a party a child is in when the child talks to friends only.
    await restrict(mom, kid, { publicMatchmaking: true, approvedContacts: [] });
    const kidCode = await h.call("POST", `${v1}/parties/${own.body.id}/code`, {}, kid.token);
    expect(kidCode.status).toBe(201);
    const adult = await h.user("adult@example.com");
    const intoKid = await h.call("POST", `${v1}/join/${kidCode.body.code}`, {}, adult.token);
    expect(intoKid.body).toMatchObject({ code: "restricted_by_family", side: "other" });
  });

  it("a muted leader hands out no code", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const party = await h.call("POST", `${v1}/parties`, {}, leader.token);
    await mute(h.deps, leader.id);
    expect((await h.call("POST", `${v1}/parties/${party.body.id}/code`, {}, leader.token)).body.code).toBe(
      "account_muted",
    );
  });
});

describe("share play join codes", () => {
  const game = { titleId: "PPSA01234", title: "Cat Quest III", maxViewers: 3, open: false };

  it("a stranger asks with the code, the host says yes, and the stranger watches", async () => {
    h = await harness();
    const host = await h.user("host@example.com");
    const stranger = await h.user("stranger@example.com");
    const started = await h.call("POST", `${v1}/share-plays`, game, host.token);
    const id = started.body.sharePlay.id as string;
    expect(started.body.sharePlay.joinCode).toBeNull();
    const issued = await h.call("POST", `${v1}/share-plays/${id}/code`, { hours: 3 }, host.token);
    expect(issued.status).toBe(201);
    const code = issued.body.code as string;
    expect((await h.call("GET", `${v1}/share-plays/${id}`, undefined, host.token)).body.joinCode).toEqual(
      issued.body,
    );

    const preview = await h.call("GET", `${v1}/join/${code}`);
    expect(preview.body).toMatchObject({
      kind: "share_play",
      id,
      size: 0,
      max: 3,
      host: { handle: "host" },
      game: { titleId: "PPSA01234", title: "Cat Quest III" },
    });
    expect((await h.call("POST", `${v1}/join/${code}`, {}, host.token)).status).toBe(409);

    const hostHears = await listen(host.id);
    const asked = await h.call("POST", `${v1}/join/${code}`, {}, stranger.token);
    expect(asked.body).toEqual({ kind: "share_play", id, state: "requested" });
    await settle();
    expect(hostHears.of("share_play.request")[0]?.data).toMatchObject({ sharePlayId: id, via: "code" });
    hostHears.stop();
    const seen = await h.call("GET", `${v1}/share-plays/${id}`, undefined, host.token);
    expect(seen.body.requests.map((r: { userId: string }) => r.userId)).toEqual([stranger.id]);
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, stranger.token)).status).toBe(404);

    await h.call("POST", `${v1}/share-plays/${id}/requests/${stranger.id}/accept`, {}, host.token);
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe("invited");
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, stranger.token)).status).toBe(201);
    expect((await h.call("GET", `${v1}/join/${code}`, undefined, stranger.token)).body.state).toBe("member");

    // Revoked, then the share play ends with a fresh one.
    expect((await h.call("DELETE", `${v1}/share-plays/${id}/code`, undefined, host.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/join/${code}`)).status).toBe(404);
    const again = await h.call("POST", `${v1}/share-plays/${id}/code`, {}, host.token);
    await h.call("DELETE", `${v1}/share-plays/${id}`, undefined, host.token);
    expect((await h.call("GET", `${v1}/join/${again.body.code}`)).status).toBe(404);
  });

  it("only the host hands one out, and a child needs share play on", async () => {
    h = await harness();
    const host = await h.user("host@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(host, friend);
    const started = await h.call("POST", `${v1}/share-plays`, { ...game, open: true }, host.token);
    const id = started.body.sharePlay.id as string;
    await h.call("POST", `${v1}/share-plays/${id}/join`, {}, friend.token);
    expect((await h.call("POST", `${v1}/share-plays/${id}/code`, {}, friend.token)).status).toBe(403);
    const { code } = (await h.call("POST", `${v1}/share-plays/${id}/code`, {}, host.token)).body;
    const { mom, kid } = await familyWithChild();
    await restrict(mom, kid, { publicMatchmaking: true, approvedContacts: [host.id] });
    expect((await h.call("POST", `${v1}/join/${code}`, {}, kid.token)).body.feature).toBe("share_play");
  });
});

describe("party Discord link", () => {
  it("the leader sets a discord.gg or discord.com link, members see it, and it can be cleared", async () => {
    h = await harness();
    const leader = await h.user("lead@example.com");
    const friend = await h.user("friend@example.com");
    await befriend(leader, friend);
    const party = await h.call("POST", `${v1}/parties`, { privacy: "friends" }, leader.token);
    const id = party.body.id as string;
    expect(party.body.discord).toBeNull();
    await h.call("POST", `${v1}/parties/${id}/join`, {}, friend.token);

    const hears = await listen(friend.id);
    const set = await h.call(
      "PATCH",
      `${v1}/parties/${id}`,
      { discord: "https://discord.gg/abc123?x=1" },
      leader.token,
    );
    expect(set.status).toBe(200);
    expect(set.body.discord).toBe("https://discord.gg/abc123");
    await settle();
    expect(hears.of("party.updated").at(-1)?.data).toMatchObject({ discord: "https://discord.gg/abc123" });
    hears.stop();
    expect((await h.call("GET", `${v1}/parties/${id}`, undefined, friend.token)).body.discord).toBe(
      "https://discord.gg/abc123",
    );

    for (const bad of ["https://example.com/x", "http://discord.gg/abc", "https://discord.com/login"])
      expect((await h.call("PATCH", `${v1}/parties/${id}`, { discord: bad }, leader.token)).status).toBe(400);
    expect(
      (await h.call("PATCH", `${v1}/parties/${id}`, { discord: "https://discord.gg/mine" }, friend.token))
        .status,
    ).toBe(403);
    const cleared = await h.call("PATCH", `${v1}/parties/${id}`, { discord: null }, leader.token);
    expect(cleared.body.discord).toBeNull();
  });
});
