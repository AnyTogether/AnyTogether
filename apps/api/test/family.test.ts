import { randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
type User = Awaited<ReturnType<typeof h.user>>;

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A family with a manager and a linked child; returns both. */
async function familyWithChild(childEmail = "kid@example.com") {
  const mom = await h.user("mom@example.com");
  const made = await h.call("POST", `${v1}/families`, { name: "The Yılmaz family" }, mom.token);
  expect(made.status).toBe(201);
  const kid = await h.user(childEmail);
  const { body } = await h.call("POST", `${v1}/me/family/link-codes`, {}, mom.token);
  const joined = await h.call(
    "POST",
    `${v1}/me/family/join`,
    { code: body.code, timeZone: "Europe/Istanbul" },
    kid.token,
  );
  expect(joined.status).toBe(200);
  return { mom, kid, familyId: made.body.id as string };
}

const restrict = (mom: User, kid: User, update: Record<string, unknown>) =>
  h.call("PATCH", `${v1}/me/family/children/${kid.id}/restrictions`, update, mom.token);

describe("families", () => {
  it("a manager makes a family, invites a parent who accepts, hands over, and adults leave", async () => {
    const mom = await h.user("mom@example.com");
    const dad = await h.user("dad@example.com");
    expect((await h.call("GET", `${v1}/me/family`, undefined, mom.token)).body).toEqual({
      family: null,
      invites: [],
    });
    const made = await h.call("POST", `${v1}/families`, { name: "  Home  " }, mom.token);
    expect(made.body).toMatchObject({ name: "Home", role: "manager" });
    expect((await h.call("POST", `${v1}/families`, { name: "Again" }, mom.token)).status).toBe(409);

    const invited = await h.call(
      "POST",
      `${v1}/me/family/invites`,
      { handle: dad.handle, role: "parent" },
      mom.token,
    );
    expect(invited.status).toBe(201);
    const waiting = await h.call("GET", `${v1}/me/family`, undefined, dad.token);
    expect(waiting.body.invites).toHaveLength(1);
    expect(waiting.body.invites[0]).toMatchObject({ familyName: "Home", role: "parent" });
    const note = await h.call("GET", `${v1}/me/notifications`, undefined, dad.token);
    expect(note.body.notifications[0]).toMatchObject({ kind: "family_invite" });

    const accepted = await h.call("POST", `${v1}/family-invites/${invited.body.id}/accept`, {}, dad.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.members.map((m: { role: string }) => m.role)).toEqual(["manager", "parent"]);

    // The manager cannot just leave while others are in it; handing over first.
    expect((await h.call("POST", `${v1}/me/family/leave`, {}, mom.token)).status).toBe(409);
    const handed = await h.call("PATCH", `${v1}/me/family/members/${dad.id}`, { role: "manager" }, mom.token);
    expect(handed.body.role).toBe("parent");
    expect((await h.call("POST", `${v1}/me/family/leave`, {}, mom.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/me/family`, undefined, mom.token)).body.family).toBeNull();

    const log = await h.call("GET", `${v1}/me/family/log`, undefined, dad.token);
    expect(log.body.entries.map((e: { action: string }) => e.action)).toEqual([
      "member.left",
      "family.handed_over",
      "member.joined",
      "member.invited",
      "family.created",
    ]);
  });

  it("makes a child account by email; the child signs in, and can say it is not their family", async () => {
    const mom = await h.user("mom@example.com");
    await h.call("POST", `${v1}/families`, { name: "Home" }, mom.token);
    const made = await h.call(
      "POST",
      `${v1}/me/family/children`,
      { email: "Kid@Example.com", displayName: "Kid", timeZone: "Europe/Istanbul" },
      mom.token,
    );
    expect(made.status).toBe(201);
    expect(made.body.child).toMatchObject({ role: "child", confirmed: false, displayName: "Kid" });
    expect(h.mailer.sent.some((m) => m.kind === "family-child" && m.to === "kid@example.com")).toBe(true);
    // An address with an account is linked with a code instead.
    await h.user("taken@example.com");
    const taken = await h.call("POST", `${v1}/me/family/children`, { email: "taken@example.com" }, mom.token);
    expect(taken.status).toBe(409);
    expect(taken.body.hint).toBe("link_code");

    const kid = await h.user("kid@example.com");
    expect(kid.id).toBe(made.body.child.userId);
    const status = await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token);
    expect(status.body).toMatchObject({ restricted: true, role: "child" });
    expect(status.body.restrictions.playTime.timeZone).toBe("Europe/Istanbul");
    // A child cannot leave on their own…
    const leave = await h.call("POST", `${v1}/me/family/leave`, {}, kid.token);
    expect(leave.status).toBe(403);
    expect(leave.body).toMatchObject({ code: "restricted_by_family", feature: "family" });
    // …but a new account someone else made can say it is not theirs.
    expect((await h.call("POST", `${v1}/me/family/not-mine`, {}, kid.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token)).body.restricted).toBe(
      false,
    );
    const alerts = await h.call("GET", `${v1}/me/notifications`, undefined, mom.token);
    expect(alerts.body.notifications[0]).toMatchObject({
      kind: "family_alert",
      data: { event: "child_declined" },
    });
  });

  it("links an existing account with a code; only a parent changes limits; removing frees the child", async () => {
    const { mom, kid, familyId } = await familyWithChild();
    const aunt = await h.user("aunt@example.com");
    const wrong = await h.call("POST", `${v1}/me/family/join`, { code: "AAAA-BBBB" }, aunt.token);
    expect(wrong.body.code).toBe("code_invalid");
    const family = await h.call("GET", `${v1}/me/family`, undefined, kid.token);
    expect(family.body.family).toMatchObject({ id: familyId, role: "child" });
    expect(family.body.family.members.find((m: { userId: string }) => m.userId === kid.id).confirmed).toBe(
      true,
    );

    const invite = await h.call(
      "POST",
      `${v1}/me/family/invites`,
      { handle: aunt.handle, role: "adult" },
      mom.token,
    );
    await h.call("POST", `${v1}/family-invites/${invite.body.id}/accept`, {}, aunt.token);
    expect((await restrict(aunt, kid, { voiceChat: true })).status).toBe(403);
    expect((await restrict(kid, kid, { voiceChat: true })).status).toBe(403);
    const changed = await restrict(mom, kid, {
      voiceChat: true,
      playTime: { days: { mon: { limitMinutes: 60, from: null, until: null } } },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.restrictions.voiceChat).toBe(true);
    expect(changed.body.restrictions.playTime.days.mon.limitMinutes).toBe(60);
    expect(changed.body.restrictions.playTime.days.tue.limitMinutes).toBeNull();
    const bad = await restrict(mom, kid, {
      playTime: { days: { mon: { limitMinutes: 60, from: "20:00", until: "08:00" } } },
    });
    expect(bad.status).toBe(400);

    // The child's data export carries the family part.
    const exported = await h.app.request(`${v1}/me/export`, {
      headers: { authorization: `Bearer ${kid.token}` },
    });
    const data = JSON.parse(await exported.text());
    expect(data.family.membership.role).toBe("child");
    expect(data.family.restrictions.settings.voiceChat).toBe(true);
    expect((await h.call("DELETE", `${v1}/me/family/members/${kid.id}`, undefined, mom.token)).status).toBe(
      204,
    );
    expect((await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token)).body.restricted).toBe(
      false,
    );
  });
});

describe("a child's limits, enforced by the API", () => {
  it("keeps the profile private and out of discovery", async () => {
    const { mom, kid } = await familyWithChild();
    const me = await h.call("GET", `${v1}/me`, undefined, kid.token);
    expect(me.body.profile.privacy).toMatchObject({ search: "friends", library: "friends" });
    const looser = await h.call("PATCH", `${v1}/me/privacy`, { trophies: "everyone" }, kid.token);
    expect(looser.status).toBe(403);
    expect(looser.body).toMatchObject({ code: "restricted_by_family", feature: "profile_visibility" });
    expect((await h.call("PATCH", `${v1}/me/privacy`, { trophies: "nobody" }, kid.token)).status).toBe(200);
    const discover = await h.call("PATCH", `${v1}/me/discovery`, { discoverable: true }, kid.token);
    expect(discover.body.feature).toBe("discovery");
    expect((await h.call("GET", `${v1}/discover/suggestions`, undefined, kid.token)).body.feature).toBe(
      "discovery",
    );

    await restrict(mom, kid, { profileVisibility: "nobody" });
    const after = await h.call("GET", `${v1}/me`, undefined, kid.token);
    // Every section, the gallery too.
    expect(Object.values(after.body.profile.privacy)).toEqual([
      "nobody",
      "nobody",
      "nobody",
      "nobody",
      "nobody",
      "nobody",
    ]);
  });

  it("friend requests: only approved people, and a parent's yes sends the request", async () => {
    const { mom, kid } = await familyWithChild();
    const stranger = await h.user("stranger@example.com");
    const asked = await h.call("POST", `${v1}/me/friends/requests`, { handle: stranger.handle }, kid.token);
    expect(asked.status).toBe(403);
    expect(asked.body).toMatchObject({
      code: "restricted_by_family",
      feature: "friend_requests",
      side: "self",
    });
    const toKid = await h.call("POST", `${v1}/me/friends/requests`, { handle: kid.handle }, stranger.token);
    expect(toKid.body).toMatchObject({ code: "restricted_by_family", side: "other" });
    // Family members are always fine.
    expect(
      (await h.call("POST", `${v1}/me/friends/requests`, { handle: kid.handle }, mom.token)).status,
    ).toBe(201);

    const request = await h.call(
      "POST",
      `${v1}/me/family/requests`,
      { kind: "add_friend", handle: stranger.handle, note: "from school" },
      kid.token,
    );
    expect(request.status).toBe(201);
    expect(request.body).toMatchObject({
      kind: "add_friend",
      status: "pending",
      person: { userId: stranger.id },
    });
    const momSees = await h.call("GET", `${v1}/me/family/requests?status=pending`, undefined, mom.token);
    expect(momSees.body.requests).toHaveLength(1);
    const note = (await h.call("GET", `${v1}/me/notifications`, undefined, mom.token)).body.notifications;
    expect(note.some((n: { kind: string }) => n.kind === "family_request")).toBe(true);

    const yes = await h.call("POST", `${v1}/me/family/requests/${request.body.id}/approve`, {}, mom.token);
    expect(yes.body.status).toBe("approved");
    const incoming = await h.call("GET", `${v1}/me/friends/requests`, undefined, stranger.token);
    expect(incoming.body.incoming.map((r: { userId: string }) => r.userId)).toContain(kid.id);
    expect(
      (await h.call("POST", `${v1}/me/friends/requests/${kid.id}/accept`, {}, stranger.token)).status,
    ).toBe(204);
    const answer = (await h.call("GET", `${v1}/me/notifications`, undefined, kid.token)).body.notifications;
    expect(
      answer.some(
        (n: { kind: string; data: { approved: boolean } }) => n.kind === "family_answer" && n.data.approved,
      ),
    ).toBe(true);
  });

  it("messages and calls follow the message rule and voice chat", async () => {
    const { mom, kid } = await familyWithChild();
    const friend = await h.user("friend@example.com");
    await restrict(mom, kid, { friendRequests: "everyone" });
    await befriend(kid, friend);
    const direct = await h.call("POST", `${v1}/conversations`, { members: [friend.id] }, kid.token);
    expect(direct.status).toBe(201);
    const send = (token: string) =>
      h.call(
        "POST",
        `${v1}/conversations/${direct.body.id}/messages`,
        { clientId: randomUUID(), text: "hi" },
        token,
      );
    expect((await send(friend.token)).status).toBe(201);

    await restrict(mom, kid, { messages: "nobody" });
    const blocked = await send(friend.token);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "restricted_by_family", feature: "messages" });
    expect((await send(kid.token)).body.feature).toBe("messages");

    // A group with someone who is not the child's friend is refused even under "friends".
    await restrict(mom, kid, { messages: "friends" });
    const other = await h.user("other@example.com");
    await befriend(friend, other);
    const group = await h.call(
      "POST",
      `${v1}/conversations`,
      { members: [kid.id, other.id], group: true },
      friend.token,
    );
    expect(group.body.feature).toBe("messages");

    const call = await h.call("POST", `${v1}/calls`, { userId: friend.id }, kid.token);
    expect(call.body).toMatchObject({ code: "restricted_by_family", feature: "voice_chat" });
    expect((await h.call("POST", `${v1}/calls`, { userId: kid.id }, friend.token)).body.feature).toBe(
      "voice_chat",
    );
    await restrict(mom, kid, { voiceChat: true });
    expect((await h.call("POST", `${v1}/calls`, { userId: friend.id }, kid.token)).status).toBe(201);
  });

  it("share play, public parties, the board and discovery stay off", async () => {
    const { mom, kid } = await familyWithChild();
    const share = await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: "PPSA01234", maxViewers: 2 },
      kid.token,
    );
    expect(share.body.feature).toBe("share_play");
    expect((await h.call("GET", `${v1}/parties/public`, undefined, kid.token)).body.feature).toBe(
      "public_matchmaking",
    );
    expect((await h.call("GET", `${v1}/lfg`, undefined, kid.token)).body.feature).toBe("public_matchmaking");
    const post = await h.call(
      "POST",
      `${v1}/lfg`,
      { titleId: "PPSA01234", purpose: "online", languages: ["en"], slots: 1 },
      kid.token,
    );
    expect(post.body.feature).toBe("public_matchmaking");
    expect(
      (await h.call("GET", `${v1}/discover/players?titleId=PPSA01234`, undefined, kid.token)).body.feature,
    ).toBe("discovery");
    // A host cannot invite the child to watch either.
    const host = await h.user("host@example.com");
    await restrict(mom, kid, { friendRequests: "everyone" });
    await befriend(kid, host);
    const hosted = await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: "PPSA01234", maxViewers: 2 },
      host.token,
    );
    const invite = await h.call(
      "POST",
      `${v1}/share-plays/${hosted.body.sharePlay.id}/invites`,
      { userIds: [kid.id] },
      host.token,
    );
    expect(invite.body.feature).toBe("share_play");
    // An adult in no family is not touched.
    expect((await h.call("GET", `${v1}/lfg`, undefined, host.token)).status).toBe(200);
  });

  it("age ratings: games over the limit are refused, an approved game is allowed", async () => {
    const { mom, kid } = await familyWithChild();
    const teach = await h.call(
      "PUT",
      `${v1}/games/PPSA02929`,
      { names: { en: "Grown-up game" }, ageLevels: { default: 16, US: 13, TR: 12 } },
      mom.token,
    );
    expect(teach.body.ageLevels).toEqual({ default: 16, US: 13, TR: 12 });
    await restrict(mom, kid, { ageLimit: 12 });
    const session = { titleId: "PPSA02929", gameVersion: "01.000", engineBuild: "x", capacity: 2 };
    const refused = await h.call("POST", `${v1}/game-sessions`, session, kid.token);
    expect(refused.body).toMatchObject({ code: "restricted_by_family", feature: "age_rating" });
    // Turkey's rating is 12: allowed with the region set.
    await restrict(mom, kid, { ageRegion: "TR" });
    expect((await h.call("POST", `${v1}/game-sessions`, session, kid.token)).status).toBe(201);
    await restrict(mom, kid, { ageRegion: "default" });
    const ask = await h.call(
      "POST",
      `${v1}/me/family/requests`,
      { kind: "play_game", titleId: "PPSA02929" },
      kid.token,
    );
    expect(ask.body.gameName).toBe("Grown-up game");
    await h.call("POST", `${v1}/me/family/requests/${ask.body.id}/approve`, {}, mom.token);
    const status = await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token);
    expect(status.body.restrictions.allowedTitles).toEqual(["PPSA02929"]);
    expect((await h.call("POST", `${v1}/game-sessions`, session, kid.token)).status).toBe(201);
  });
});

describe("play time and the launchers' status", () => {
  it("counts today's play, adds approved extra time, and signs the status", async () => {
    const { mom, kid } = await familyWithChild();
    await restrict(mom, kid, {
      playTime: {
        enabled: true,
        timeZone: "UTC",
        days: Object.fromEntries(
          ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
            d,
            { limitMinutes: 60, from: null, until: null },
          ]),
        ),
      },
    });
    const device = randomUUID();
    await h.call("POST", `${v1}/me/devices`, { id: device, platform: "macos", name: "Mac" }, kid.token);
    const now = Date.now();
    // 20 minutes today (UTC), kept short of midnight.
    const minutesToday = Math.min(20, Math.floor((now % 86_400_000) / 60_000));
    await h.call(
      "POST",
      `${v1}/me/sessions`,
      {
        sessions: [
          {
            id: randomUUID(),
            titleId: "PPSA01234",
            deviceId: device,
            startedAt: new Date(now - minutesToday * 60_000 - 1000).toISOString(),
            endedAt: new Date(now - 1000).toISOString(),
          },
        ],
      },
      kid.token,
    );
    const status = await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token);
    expect(status.body.today).toMatchObject({ limitMinutes: 60, bonusMinutes: 0, allowed: true });
    expect(Math.round(status.body.today.playedSeconds / 60)).toBe(minutesToday);

    // The signed copy checks out with the published key and says the same.
    const jwks = createLocalJWKSet((await h.call("GET", `${v1}/.well-known/jwks.json`)).body);
    const { payload } = await jwtVerify(status.body.signed, jwks, { audience: "anytogether-family" });
    expect(payload.sub).toBe(kid.id);
    expect(
      (payload.family as { restrictions: { playTime: { enabled: boolean } } }).restrictions.playTime.enabled,
    ).toBe(true);
    // A family document is no access token.
    expect((await h.call("GET", `${v1}/me`, undefined, status.body.signed)).status).toBe(401);

    const more = await h.call(
      "POST",
      `${v1}/me/family/requests`,
      { kind: "more_time", minutes: 30 },
      kid.token,
    );
    const again = await h.call(
      "POST",
      `${v1}/me/family/requests`,
      { kind: "more_time", minutes: 30 },
      kid.token,
    );
    expect(again.body.id).toBe(more.body.id);
    await h.call("POST", `${v1}/me/family/requests/${more.body.id}/approve`, { minutes: 15 }, mom.token);
    await h.call("POST", `${v1}/me/family/children/${kid.id}/time-grants`, { minutes: 10 }, mom.token);
    const later = await h.call("GET", `${v1}/me/family/restrictions`, undefined, kid.token);
    expect(later.body.today).toMatchObject({ bonusMinutes: 25, limitMinutes: 85 });

    // The limit reached: the parents hear it once a day.
    expect(
      (await h.call("POST", `${v1}/me/family/limit-reached`, { titleId: "PPSA01234" }, kid.token)).status,
    ).toBe(204);
    await h.call("POST", `${v1}/me/family/limit-reached`, {}, kid.token);
    const alerts = (
      await h.call("GET", `${v1}/me/notifications`, undefined, mom.token)
    ).body.notifications.filter(
      (n: { kind: string; data: { event?: string } }) =>
        n.kind === "family_alert" && n.data.event === "limit_reached",
    );
    expect(alerts).toHaveLength(1);

    const activity = await h.call(
      "GET",
      `${v1}/me/family/children/${kid.id}/activity?days=7`,
      undefined,
      mom.token,
    );
    expect(activity.body.days).toHaveLength(7);
    expect(activity.body.games[0]).toMatchObject({ titleId: "PPSA01234" });
    expect(activity.body.requests).toBe(1);
  });

  it("someone in no family, or an adult in one, is not restricted", async () => {
    const solo = await h.user("solo@example.com");
    const status = await h.call("GET", `${v1}/me/family/restrictions`, undefined, solo.token);
    expect(status.body).toMatchObject({ restricted: false, role: null, restrictions: null, today: null });
    expect(typeof status.body.signed).toBe("string");
    const { mom } = await familyWithChild();
    expect((await h.call("GET", `${v1}/me/family/restrictions`, undefined, mom.token)).body).toMatchObject({
      restricted: false,
      role: "manager",
    });
  });

  it("sends the weekly summary to the parents, by mail to those who want it", async () => {
    const { mom, kid } = await familyWithChild();
    await h.call("PATCH", `${v1}/me/notifications/settings`, { familyMail: true }, mom.token);
    expect(await h.app.sendFamilySummaries()).toBe(0);
    const inAWeek = new Date(Date.now() + 8 * 86_400_000);
    expect(await h.app.sendFamilySummaries(inAWeek)).toBe(1);
    const summary = (
      await h.call("GET", `${v1}/me/notifications`, undefined, mom.token)
    ).body.notifications.find((n: { kind: string }) => n.kind === "family_summary");
    expect(summary.data.children[0]).toMatchObject({ userId: kid.id, seconds: 0 });
    expect(h.mailer.sent.some((m) => m.kind === "family-summary" && m.to === "mom@example.com")).toBe(true);
    expect(await h.app.sendFamilySummaries(inAWeek)).toBe(0);
  });
});
