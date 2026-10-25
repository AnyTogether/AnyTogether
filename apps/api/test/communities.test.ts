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
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
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
const make = (user: User, input: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/communities`,
    { name: "Cat Questers", titleId: game, icon: "pad-cosmic", description: "Paws up.", ...input },
    user.token,
  );
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describe("communities", () => {
  it("is made with its owner and chat, found by game, joined, and its chat follows the members", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const made = await make(ana);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      name: "Cat Questers",
      titleId: game,
      icon: "pad-cosmic",
      iconUrl: "https://anytogether.test/api/v1/art/icons/pad-cosmic.svg",
      visibility: "public",
      members: 1,
      role: "owner",
      owner: { userId: ana.id },
      moderators: [],
    });
    const id = made.body.id as string;
    const chatId = made.body.conversationId as string;
    expect(chatId).toBeTruthy();

    // Links, short names and unknown icons are refused.
    expect((await make(ana, { name: "ab" })).status).toBe(400);
    expect((await make(ana, { description: "see cats.com" })).status).toBe(400);
    expect((await make(ana, { icon: "pad-neon" })).status).toBe(400);

    const found = await h.call("GET", `${v1}/communities?titleId=${game}`, undefined, ben.token);
    expect(found.body.communities.map((x: { id: string }) => x.id)).toEqual([id]);
    expect(found.body.communities[0]).toMatchObject({ role: null, members: 1, upcomingEvents: 0 });
    expect(
      (await h.call("GET", `${v1}/communities?q=quest`, undefined, ben.token)).body.communities,
    ).toHaveLength(1);
    expect(
      (await h.call("GET", `${v1}/communities/${id}`, undefined, ben.token)).body.conversationId,
    ).toBeNull();

    const anaHears = await listen(ana.id);
    const joined = await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ role: "member", members: 2, conversationId: chatId });
    await settle();
    expect(anaHears.of("community.updated")[0]?.data).toEqual({ communityId: id });
    anaHears.stop();

    // Ben is in its chat, muted, and can write there; the chat's members are the community's.
    const chat = await h.call("GET", `${v1}/conversations/${chatId}`, undefined, ben.token);
    expect(chat.body).toMatchObject({ communityId: id, muted: true, title: "Cat Questers" });
    expect(chat.body.members).toHaveLength(2);
    const sent = await h.call(
      "POST",
      `${v1}/conversations/${chatId}/messages`,
      { clientId: crypto.randomUUID(), text: "Hi all" },
      ben.token,
    );
    expect(sent.status).toBe(201);
    expect(
      (await h.call("DELETE", `${v1}/conversations/${chatId}/members/${ben.id}`, undefined, ben.token))
        .status,
    ).toBe(409);
    expect(
      (await h.call("PATCH", `${v1}/conversations/${chatId}`, { title: "Mine" }, ana.token)).status,
    ).toBe(409);
    const unmuted = await h.call("PUT", `${v1}/conversations/${chatId}/mute`, { muted: false }, ben.token);
    expect(unmuted.body.muted).toBe(false);

    const members = await h.call("GET", `${v1}/communities/${id}/members`, undefined, ben.token);
    expect(members.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([
      [ana.id, "owner"],
      [ben.id, "member"],
    ]);
    const mine = await h.call("GET", `${v1}/me/communities`, undefined, ben.token);
    expect(mine.body.communities.map((x: { id: string }) => x.id)).toEqual([id]);

    // Leaving takes Ben out of the chat too; the owner cannot just leave.
    expect((await h.call("POST", `${v1}/communities/${id}/leave`, {}, ana.token)).status).toBe(409);
    expect((await h.call("POST", `${v1}/communities/${id}/leave`, {}, ben.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/conversations/${chatId}`, undefined, ben.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, ben.token)).body.members).toBe(1);
  });

  it("by invite only: hidden from others, moderators invite friends, the invitee is told and joins", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    await befriend(ana, ben);
    await befriend(ana, cem);
    await befriend(ben, cem);
    const id = (await make(ana, { visibility: "invite", titleId: null })).body.id as string;
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, ben.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/communities`, undefined, ben.token)).body.communities).toEqual([]);

    const benHears = await listen(ben.id);
    const invited = await h.call("POST", `${v1}/communities/${id}/invites`, { userIds: [ben.id] }, ana.token);
    expect(invited.body).toEqual({ invited: [ben.id] });
    await settle();
    expect(benHears.of("community.invite")[0]?.data).toMatchObject({
      communityId: id,
      from: { userId: ana.id },
    });
    benHears.stop();
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, ben.token);
    expect(notes.body.notifications[0]).toMatchObject({
      kind: "community_invite",
      subjectId: id,
      actor: { userId: ana.id },
      data: { name: "Cat Questers" },
    });
    const waiting = await h.call("GET", `${v1}/me/communities`, undefined, ben.token);
    expect(waiting.body.invites[0]).toMatchObject({
      community: { id, invited: true },
      from: { userId: ana.id },
    });

    expect((await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token)).status).toBe(200);
    const after = await h.call("GET", `${v1}/me/notifications`, undefined, ben.token);
    expect(after.body.notifications.find((n: { kind: string }) => n.kind === "community_invite").read).toBe(
      true,
    );
    // A plain member does not invite to a community by invite only.
    expect(
      (await h.call("POST", `${v1}/communities/${id}/invites`, { userIds: [cem.id] }, ben.token)).status,
    ).toBe(403);
    // Only friends are invited.
    const stranger = await h.user("dan@example.com");
    expect(
      (await h.call("POST", `${v1}/communities/${id}/invites`, { userIds: [stranger.id] }, ana.token)).status,
    ).toBe(403);
    // Declining takes the invite back.
    await h.call("POST", `${v1}/communities/${id}/invites`, { userIds: [cem.id] }, ana.token);
    expect((await h.call("POST", `${v1}/communities/${id}/decline`, {}, cem.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, cem.token)).status).toBe(404);
  });

  it("owner names moderators; moderators kick and ban members; a ban keeps them out until lifted", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const dan = await h.user("dan@example.com");
    const id = (await make(ana)).body.id as string;
    for (const user of [ben, cem, dan]) await h.call("POST", `${v1}/communities/${id}/join`, {}, user.token);

    expect(
      (
        await h.call(
          "PUT",
          `${v1}/communities/${id}/members/${cem.id}/role`,
          { role: "moderator" },
          ben.token,
        )
      ).status,
    ).toBe(403);
    const named = await h.call(
      "PUT",
      `${v1}/communities/${id}/members/${ben.id}/role`,
      { role: "moderator" },
      ana.token,
    );
    expect(named.body.moderators.map((m: { userId: string }) => m.userId)).toEqual([ben.id]);

    // A moderator changes the words but not who may join.
    expect(
      (await h.call("PATCH", `${v1}/communities/${id}`, { description: "New." }, ben.token)).status,
    ).toBe(200);
    expect(
      (await h.call("PATCH", `${v1}/communities/${id}`, { visibility: "invite" }, ben.token)).status,
    ).toBe(403);

    const cemHears = await listen(cem.id);
    expect(
      (await h.call("DELETE", `${v1}/communities/${id}/members/${cem.id}`, undefined, ben.token)).status,
    ).toBe(204);
    await settle();
    expect(cemHears.of("community.left")[0]?.data).toEqual({ communityId: id, reason: "kicked" });
    cemHears.stop();
    // Moderators do not act on each other or the owner.
    expect(
      (await h.call("DELETE", `${v1}/communities/${id}/members/${ana.id}`, undefined, ben.token)).status,
    ).toBe(403);

    expect(
      (await h.call("POST", `${v1}/communities/${id}/bans`, { userId: dan.id, reason: "spam" }, ben.token))
        .status,
    ).toBe(204);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, dan.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/communities/${id}/join`, {}, dan.token)).status).toBe(404);
    const bans = await h.call("GET", `${v1}/communities/${id}/bans`, undefined, ben.token);
    expect(bans.body.bans[0]).toMatchObject({
      user: { userId: dan.id },
      reason: "spam",
      by: { userId: ben.id },
    });
    expect((await h.call("GET", `${v1}/communities/${id}/bans`, undefined, cem.token)).status).toBe(403);
    expect(
      (await h.call("DELETE", `${v1}/communities/${id}/bans/${dan.id}`, undefined, ben.token)).status,
    ).toBe(204);
    expect((await h.call("POST", `${v1}/communities/${id}/join`, {}, dan.token)).status).toBe(200);

    // The owner hands it over and becomes a moderator; then the new owner deletes it.
    const handed = await h.call("POST", `${v1}/communities/${id}/owner`, { userId: ben.id }, ana.token);
    expect(handed.body).toMatchObject({ owner: { userId: ben.id }, role: "moderator" });
    expect((await h.call("DELETE", `${v1}/communities/${id}`, undefined, ana.token)).status).toBe(403);
    const danHears = await listen(dan.id);
    expect((await h.call("DELETE", `${v1}/communities/${id}`, undefined, ben.token)).status).toBe(204);
    await settle();
    expect(danHears.of("community.left")[0]?.data).toEqual({ communityId: id, reason: "deleted" });
    expect(danHears.of("conversation.updated")[0]?.data).toMatchObject({ removed: true });
    danHears.stop();
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, dan.token)).status).toBe(404);
  });

  it("shows on its game's hub", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const id = (await make(ana)).body.id as string;
    await make(ana, { name: "Secret cats", visibility: "invite" });
    const hub = await h.call("GET", `${v1}/games/${game}/hub`, undefined, ben.token);
    expect(hub.body.communities.map((x: { id: string }) => x.id)).toEqual([id]);
  });

  it("hands a deleted owner's communities to the longest-serving moderator", async () => {
    const { handOverCommunities } = await import("../src/communities.js");
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const id = (await make(ana)).body.id as string;
    const alone = (await make(ana, { name: "Just me" })).body.id as string;
    await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);
    await h.call("POST", `${v1}/communities/${id}/join`, {}, cem.token);
    await h.call("PUT", `${v1}/communities/${id}/members/${cem.id}/role`, { role: "moderator" }, ana.token);
    await handOverCommunities(h.deps, undefined, ana.id);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, ben.token)).body.owner.userId).toBe(
      cem.id,
    );
    expect((await h.call("GET", `${v1}/communities/${alone}`, undefined, ana.token)).status).toBe(404);
  });
});

describe("events", () => {
  it("planned by a member: going or maybe, listed for the community and for me, changed and cancelled", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const id = (await make(ana)).body.id as string;
    await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);

    const plan = (user: User, input: Record<string, unknown> = {}) =>
      h.call(
        "POST",
        `${v1}/communities/${id}/events`,
        { title: "Platinum night", titleId: game, startsAt: inMinutes(120), durationMinutes: 90, ...input },
        user.token,
      );
    expect((await plan(cem)).status).toBe(403);
    expect((await plan(ben, { startsAt: inMinutes(-60) })).status).toBe(400);
    expect((await plan(ben, { startsAt: inMinutes(60 * 24 * 91) })).status).toBe(400);
    expect((await plan(ben, { durationMinutes: 5 })).status).toBe(400);
    const made = await plan(ben);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      communityId: id,
      host: { userId: ben.id },
      title: "Platinum night",
      status: "scheduled",
      going: 1,
      maybe: 0,
      mine: "going",
      canEdit: true,
      link: null,
    });
    expect(Date.parse(made.body.endsAt) - Date.parse(made.body.startsAt)).toBe(90 * 60_000);
    const eventId = made.body.id as string;

    // Someone outside the community sees it (public) but cannot say they go.
    expect((await h.call("GET", `${v1}/events/${eventId}`, undefined, cem.token)).body.canEdit).toBe(false);
    expect((await h.call("PUT", `${v1}/events/${eventId}/rsvp`, { status: "going" }, cem.token)).status).toBe(
      403,
    );
    const maybe = await h.call("PUT", `${v1}/events/${eventId}/rsvp`, { status: "maybe" }, ana.token);
    expect(maybe.body).toMatchObject({ going: 1, maybe: 1, mine: "maybe", canEdit: true });

    const listed = await h.call("GET", `${v1}/communities/${id}/events`, undefined, cem.token);
    expect(listed.body.events.map((e: { id: string }) => e.id)).toEqual([eventId]);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, cem.token)).body.upcomingEvents).toBe(
      1,
    );
    const mine = await h.call("GET", `${v1}/me/events`, undefined, ana.token);
    expect(mine.body.events.map((e: { id: string }) => e.id)).toEqual([eventId]);
    expect((await h.call("GET", `${v1}/me/events`, undefined, cem.token)).body.events).toEqual([]);

    const anaHears = await listen(ana.id);
    const moved = await h.call("PATCH", `${v1}/events/${eventId}`, { title: "Platinum night II" }, ben.token);
    expect(moved.body.title).toBe("Platinum night II");
    expect((await h.call("PATCH", `${v1}/events/${eventId}`, { title: "Mine" }, cem.token)).status).toBe(403);
    await settle();
    expect(anaHears.of("event.updated")[0]?.data).toMatchObject({ id: eventId, title: "Platinum night II" });

    // The owner, a moderator of the community, cancels it.
    expect((await h.call("DELETE", `${v1}/events/${eventId}`, undefined, ana.token)).status).toBe(204);
    await settle();
    expect(anaHears.of("event.cancelled")[0]?.data).toMatchObject({ eventId, communityId: id });
    anaHears.stop();
    expect((await h.call("GET", `${v1}/communities/${id}/events`, undefined, ben.token)).body.events).toEqual(
      [],
    );
    expect((await h.call("PUT", `${v1}/events/${eventId}/rsvp`, { status: "going" }, ana.token)).status).toBe(
      409,
    );
  });

  it("reminds those going or maybe 15 minutes before, once per start time", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const cem = await h.user("cem@example.com");
    const id = (await make(ana)).body.id as string;
    await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);
    await h.call("POST", `${v1}/communities/${id}/join`, {}, cem.token);
    const made = await h.call(
      "POST",
      `${v1}/communities/${id}/events`,
      { title: "Speedrun", startsAt: inMinutes(60) },
      ana.token,
    );
    const eventId = made.body.id as string;
    await h.call("PUT", `${v1}/events/${eventId}/rsvp`, { status: "maybe" }, ben.token);

    expect(await h.app.sweepEvents()).toBe(0);
    await h.deps.db.execute(sql`update community_events set starts_at = now() + interval '10 minutes'`);
    expect(await h.app.sweepEvents()).toBe(1);
    expect(await h.app.sweepEvents()).toBe(0);
    for (const user of [ana, ben]) {
      const notes = await h.call("GET", `${v1}/me/notifications`, undefined, user.token);
      expect(notes.body.notifications[0]).toMatchObject({
        kind: "event_reminder",
        subjectId: eventId,
        data: { title: "Speedrun", community: "Cat Questers" },
      });
    }
    // Cem said nothing: no reminder.
    expect((await h.call("GET", `${v1}/me/notifications`, undefined, cem.token)).body.notifications).toEqual(
      [],
    );
    // A new time gets a new reminder.
    await h.call("PATCH", `${v1}/events/${eventId}`, { startsAt: inMinutes(5) }, ana.token);
    expect(await h.app.sweepEvents()).toBe(1);
  });

  it("the host starts it into a party: those going or maybe are invited and told", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const id = (await make(ana)).body.id as string;
    await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);
    const made = await h.call(
      "POST",
      `${v1}/communities/${id}/events`,
      { title: "Raid", startsAt: inMinutes(90) },
      ana.token,
    );
    const eventId = made.body.id as string;
    await h.call("PUT", `${v1}/events/${eventId}/rsvp`, { status: "going" }, ben.token);
    expect((await h.call("POST", `${v1}/events/${eventId}/start`, { kind: "party" }, ana.token)).status).toBe(
      409,
    );
    await h.deps.db.execute(sql`update community_events set starts_at = now() + interval '10 minutes'`);
    expect((await h.call("POST", `${v1}/events/${eventId}/start`, { kind: "party" }, ben.token)).status).toBe(
      403,
    );
    expect(
      (await h.call("POST", `${v1}/events/${eventId}/start`, { kind: "share_play" }, ana.token)).status,
    ).toBe(409);

    const benHears = await listen(ben.id);
    const started = await h.call("POST", `${v1}/events/${eventId}/start`, { kind: "party" }, ana.token);
    expect(started.status).toBe(200);
    expect(started.body.link).toMatchObject({ kind: "party" });
    expect(started.body.startedAt).toBeTruthy();
    const partyId = started.body.link.id as string;
    await settle();
    expect(benHears.of("event.started")[0]?.data).toEqual({
      eventId,
      title: "Raid",
      link: { kind: "party", id: partyId },
    });
    benHears.stop();
    const benParty = await h.call("GET", `${v1}/me/party`, undefined, ben.token);
    expect(benParty.body.invites.map((i: { partyId: string }) => i.partyId)).toEqual([partyId]);
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, ben.token);
    expect(notes.body.notifications[0]).toMatchObject({
      kind: "event_started",
      subjectId: eventId,
      data: { link: { kind: "party", id: partyId } },
    });
    // Ben joins the party from the invite, though they are not friends.
    expect((await h.call("POST", `${v1}/parties/${partyId}/join`, {}, ben.token)).status).toBe(200);
  });
});

describe("community moderation", () => {
  it("reports on communities and events reach the admins, who remove them", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const boss = await h.user("boss@example.com");
    await h.deps.db.execute(sql`update accounts set role = 'admin' where id = ${boss.id}`);
    const id = (await make(ana)).body.id as string;
    await h.call("POST", `${v1}/communities/${id}/join`, {}, ben.token);
    const eventId = (
      await h.call(
        "POST",
        `${v1}/communities/${id}/events`,
        { title: "Rude night", startsAt: inMinutes(60) },
        ana.token,
      )
    ).body.id as string;

    expect(
      (
        await h.call(
          "POST",
          `${v1}/reports`,
          { targetKind: "community", targetId: id, reason: "spam" },
          ana.token,
        )
      ).status,
    ).toBe(400);
    const reported = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "event", targetId: eventId, reason: "harassment", note: "mean" },
      ben.token,
    );
    expect(reported.status).toBe(201);
    await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "community", targetId: id, reason: "spam" },
      ben.token,
    );

    const queue = await h.call("GET", `${v1}/admin/reports`, undefined, boss.token);
    const eventReport = queue.body.reports.find((r: { targetKind: string }) => r.targetKind === "event");
    const communityReport = queue.body.reports.find(
      (r: { targetKind: string }) => r.targetKind === "community",
    );
    expect(eventReport.target.userId).toBe(ana.id);

    const removedEvent = await h.call(
      "POST",
      `${v1}/admin/reports/${eventReport.id}`,
      { action: "remove_event" },
      boss.token,
    );
    expect(removedEvent.status).toBe(200);
    expect((await h.call("GET", `${v1}/events/${eventId}`, undefined, ben.token)).body.status).toBe(
      "cancelled",
    );

    const removed = await h.call(
      "POST",
      `${v1}/admin/reports/${communityReport.id}`,
      { action: "remove_community" },
      boss.token,
    );
    expect(removed.status).toBe(200);
    expect((await h.call("GET", `${v1}/communities/${id}`, undefined, ben.token)).status).toBe(404);
    expect((await h.call("DELETE", `${v1}/admin/communities/${id}`, undefined, boss.token)).status).toBe(404);
    expect((await h.call("DELETE", `${v1}/admin/communities/${id}`, undefined, ben.token)).status).toBe(403);
  });
});
