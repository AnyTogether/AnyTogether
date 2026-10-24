import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
/** Everyone in a test is a new account: room for more than a newcomer's day. */
const roomy = {
  limits: {
    lfgPostNew: { max: 100, seconds: 86_400 },
    joinRequestNew: { max: 100, seconds: 3600 },
  },
};

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return {
    heard,
    stop: () => events.disconnect(),
    of: (type: string) => heard.filter((e) => e.type === type),
  };
}
async function watchTopic(topic: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`topic:${topic}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

const post = (user: User, input: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/lfg`,
    { titleId: "PPSA01234", purpose: "online", languages: ["en"], slots: 2, ...input },
    user.token,
  );
async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const board = (user: User, query = "") => h.call("GET", `${v1}/lfg${query}`, undefined, user.token);

describe("looking for group", () => {
  it("posts, lists newest first, filters by game, purpose, language and now", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    const sol = await h.user("sol@example.com");
    const topic = await watchTopic("lfg:PPSA01234");
    const first = await post(mira, {
      note: "chill co-op, mics on",
      region: "eu",
      languages: ["en", "TR", "en"],
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      author: { userId: mira.id },
      titleId: "PPSA01234",
      purpose: "online",
      startsAt: null,
      languages: ["en", "tr"],
      region: "eu",
      slots: 2,
      filled: 0,
      status: "open",
      mine: true,
      myRequest: null,
      requests: [],
    });
    // Three hours by default.
    expect(Date.parse(first.body.expiresAt) - Date.now()).toBeGreaterThan(2.9 * 3_600_000);
    await settle();
    expect(topic.heard[0]).toMatchObject({
      type: "lfg.changed",
      data: { postId: first.body.id, titleId: "PPSA01234", change: "opened" },
    });
    topic.stop();
    const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
    await post(kenji, { titleId: "PPSA07777", purpose: "trophies", languages: ["ja"], startsAt: later });

    const all = await board(sol);
    expect(all.body.posts.map((p: { author: { userId: string } }) => p.author.userId)).toEqual([
      kenji.id,
      mira.id,
    ]);
    expect(all.body.posts[0]).not.toHaveProperty("requests");
    expect((await board(sol, "?titleId=PPSA01234")).body.posts).toHaveLength(1);
    expect((await board(sol, "?purpose=trophies")).body.posts[0].author.userId).toBe(kenji.id);
    expect((await board(sol, "?language=tr")).body.posts[0].author.userId).toBe(mira.id);
    expect((await board(sol, "?now=1")).body.posts.map((p: { id: string }) => p.id)).toEqual([first.body.id]);
    expect((await board(sol, "?purpose=raid")).status).toBe(400);
    const games = await h.call("GET", `${v1}/lfg/games`, undefined, sol.token);
    expect(games.body.games.map((g: { titleId: string }) => g.titleId).sort()).toEqual([
      "PPSA01234",
      "PPSA07777",
    ]);
  });

  it("checks what a post says: slots, times, the link deny-list, three open at most", async () => {
    h = await harness({ ...roomy, blockedLinkDomains: ["grabify.link"] });
    const mira = await h.user("mira@example.com");
    expect((await post(mira, { purpose: "coop", slots: 4 })).status).toBe(400);
    expect((await post(mira, { purpose: "coop", slots: 3 })).status).toBe(201);
    const tooLate = new Date(Date.now() + 25 * 3_600_000).toISOString();
    expect((await post(mira, { startsAt: tooLate })).status).toBe(400);
    expect((await post(mira, { expiresAt: tooLate })).status).toBe(400);
    expect((await post(mira, { languages: [] })).status).toBe(400);
    const linked = await post(mira, { note: "join via grabify[.]link/abc" });
    expect(linked.status).toBe(400);
    expect(linked.body.code).toBe("link_blocked");
    expect((await post(mira)).status).toBe(201);
    expect((await post(mira)).status).toBe(201);
    const fourth = await post(mira);
    expect(fourth.status).toBe(409);
  });

  it("I'm in: the poster hears it, says yes, and the player is invited to their party without being friends", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    const sol = await h.user("sol@example.com");
    const made = await post(mira, { slots: 3 });
    const id = made.body.id as string;
    const miraHears = await listen(mira.id);
    const asked = await h.call("POST", `${v1}/lfg/${id}/requests`, {}, kenji.token);
    expect(asked.status).toBe(201);
    expect(asked.body.myRequest).toEqual({ status: "pending", invite: null });
    expect((await h.call("POST", `${v1}/lfg/${id}/requests`, {}, kenji.token)).status).toBe(200);
    await h.call("POST", `${v1}/lfg/${id}/requests`, {}, sol.token);
    expect((await h.call("POST", `${v1}/lfg/${id}/requests`, {}, mira.token)).status).toBe(400);
    await settle();
    expect(miraHears.of("lfg.request")[0]?.data).toMatchObject({ postId: id, from: { userId: kenji.id } });
    miraHears.stop();
    // Two people asking gather in one notification.
    const notes = await h.call("GET", `${v1}/me/notifications`, undefined, mira.token);
    expect(notes.body.notifications).toHaveLength(1);
    expect(notes.body.notifications[0]).toMatchObject({
      kind: "lfg_request",
      subjectId: id,
      actor: { userId: sol.id },
      data: { postId: id, titleId: "PPSA01234", purpose: "online", count: 2 },
    });
    const mine = await h.call("GET", `${v1}/me/lfg`, undefined, mira.token);
    expect(mine.body.posts[0].requests.map((r: { user: { userId: string } }) => r.user.userId)).toEqual([
      kenji.id,
      sol.id,
    ]);
    expect(
      (await h.call("GET", `${v1}/me/lfg`, undefined, kenji.token)).body.asked.map(
        (p: { id: string }) => p.id,
      ),
    ).toEqual([id]);

    const kenjiHears = await listen(kenji.id);
    const yes = await h.call("POST", `${v1}/lfg/${id}/requests/${kenji.id}/accept`, {}, mira.token);
    expect(yes.status).toBe(200);
    expect(yes.body).toMatchObject({ filled: 1, status: "open" });
    const party = (await h.call("GET", `${v1}/me/party`, undefined, mira.token)).body.party;
    expect(party.invited.map((p: { userId: string }) => p.userId)).toEqual([kenji.id]);
    await settle();
    expect(kenjiHears.of("lfg.answered")[0]?.data).toEqual({
      postId: id,
      answer: "accepted",
      invite: { kind: "party", id: party.id },
    });
    expect(kenjiHears.of("party.invite")[0]?.data).toMatchObject({ partyId: party.id });
    kenjiHears.stop();
    // Told once, by the post's notification, not a party invite besides.
    const kenjiNotes = (await h.call("GET", `${v1}/me/notifications`, undefined, kenji.token)).body
      .notifications;
    expect(kenjiNotes.map((n: { kind: string }) => n.kind)).toEqual(["lfg_accepted"]);
    expect(kenjiNotes[0].data.invite).toEqual({ kind: "party", id: party.id });
    expect((await h.call("POST", `${v1}/parties/${party.id}/join`, {}, kenji.token)).status).toBe(200);

    // No to the other: they hear it and cannot ask again.
    const solHears = await listen(sol.id);
    await h.call("POST", `${v1}/lfg/${id}/requests/${sol.id}/decline`, {}, mira.token);
    await settle();
    expect(solHears.of("lfg.answered")[0]?.data).toMatchObject({ answer: "declined", invite: null });
    solHears.stop();
    expect((await h.call("POST", `${v1}/lfg/${id}/requests`, {}, sol.token)).status).toBe(409);
    // Nobody waits now: the poster's notification is read.
    expect((await h.call("GET", `${v1}/me/notifications/unread`, undefined, mira.token)).body.unread).toBe(0);
  });

  it("co-op invites to the share play the poster hosts, and the player may watch it", async () => {
    h = await harness(roomy);
    const host = await h.user("host@example.com");
    const player = await h.user("player@example.com");
    const share = await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: "PPSA01234", title: "Cat Quest III", open: false, maxViewers: 2 },
      host.token,
    );
    const made = await post(host, { purpose: "coop", slots: 1 });
    await h.call("POST", `${v1}/lfg/${made.body.id}/requests`, {}, player.token);
    const yes = await h.call(
      "POST",
      `${v1}/lfg/${made.body.id}/requests/${player.id}/accept`,
      {},
      host.token,
    );
    expect(yes.body).toMatchObject({ filled: 1, status: "full" });
    expect(yes.body.requests[0]).toMatchObject({
      status: "accepted",
      invite: { kind: "share_play", id: share.body.sharePlay.id },
    });
    const joined = await h.call(
      "POST",
      `${v1}/share-plays/${share.body.sharePlay.id}/join`,
      {},
      player.token,
    );
    expect(joined.status).toBe(201);
  });

  it("closes itself when full: who still waits hears no, and the board drops it", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    const sol = await h.user("sol@example.com");
    const made = await post(mira, { slots: 1 });
    const id = made.body.id as string;
    await h.call("POST", `${v1}/lfg/${id}/requests`, {}, kenji.token);
    await h.call("POST", `${v1}/lfg/${id}/requests`, {}, sol.token);
    const topic = await watchTopic("lfg");
    const solHears = await listen(sol.id);
    await h.call("POST", `${v1}/lfg/${id}/requests/${kenji.id}/accept`, {}, mira.token);
    await settle();
    expect(solHears.of("lfg.answered")[0]?.data).toMatchObject({ answer: "declined" });
    expect(topic.heard.map((e) => e.data.change)).toEqual(["closed"]);
    solHears.stop();
    topic.stop();
    expect((await board(sol)).body.posts).toEqual([]);
    expect((await h.call("GET", `${v1}/lfg/${id}`, undefined, sol.token)).body.status).toBe("full");
    expect((await h.call("POST", `${v1}/lfg/${id}/requests/${sol.id}/accept`, {}, mira.token)).status).toBe(
      404,
    );
  });

  it("goes when its time runs out, and its poster may close it sooner", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    const soon = await post(mira, { expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    const other = await post(mira);
    await h.call("POST", `${v1}/lfg/${soon.body.id}/requests`, {}, kenji.token);
    expect(await h.app.sweepLfg()).toBe(0);
    expect(await h.app.sweepLfg(Date.now() + 11 * 60_000)).toBe(1);
    expect((await h.call("GET", `${v1}/lfg/${soon.body.id}`, undefined, kenji.token)).body).toMatchObject({
      status: "expired",
      myRequest: { status: "declined" },
    });
    // Run out but not swept yet: off the board all the same.
    await h.deps.db.execute(
      sql`update lfg_posts set expires_at = now() - interval '1 minute' where id = ${other.body.id}`,
    );
    expect((await board(kenji)).body.posts).toEqual([]);
    const third = await post(mira);
    expect((await h.call("DELETE", `${v1}/lfg/${third.body.id}`, undefined, kenji.token)).status).toBe(403);
    expect((await h.call("DELETE", `${v1}/lfg/${third.body.id}`, undefined, mira.token)).status).toBe(204);
    const late = await h.call("POST", `${v1}/lfg/${third.body.id}/requests`, {}, kenji.token);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "conflict", postStatus: "closed" });
  });

  it("blocks hide posts both ways, and banned posters vanish", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    const sol = await h.user("sol@example.com");
    const made = await post(mira);
    await h.call("POST", `${v1}/me/blocks`, { userId: kenji.id }, mira.token);
    expect((await board(kenji)).body.posts).toEqual([]);
    expect((await h.call("GET", `${v1}/lfg/${made.body.id}`, undefined, kenji.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/lfg/${made.body.id}/requests`, {}, kenji.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/lfg/games`, undefined, kenji.token)).body.games).toEqual([]);
    const kenjiPost = await post(kenji);
    expect((await board(mira)).body.posts.map((p: { id: string }) => p.id)).toEqual([made.body.id]);
    expect((await board(sol)).body.posts).toHaveLength(2);
    await run(["ban", "@kenji"], h.deps);
    expect((await board(sol)).body.posts.map((p: { id: string }) => p.id)).not.toContain(kenjiPost.body.id);
  });

  it("new accounts post and ask less often than established ones", async () => {
    h = await harness();
    const fresh = await h.user("fresh@example.com");
    const old = await h.user("old@example.com");
    // Old: a week old with trophies.
    await h.deps.db.execute(
      sql`update accounts set created_at = now() - interval '7 days' where id = ${old.id}`,
    );
    await h.deps.db.execute(sql`insert into games (title_id) values ('PPSA09999') on conflict do nothing`);
    await h.deps.db.execute(
      sql`insert into library (account_id, title_id, trophies_earned) values (${old.id}, 'PPSA09999', 12)`,
    );
    for (let i = 0; i < 2; i++) {
      const made = await post(fresh);
      expect(made.status).toBe(201);
      await h.call("DELETE", `${v1}/lfg/${made.body.id}`, undefined, fresh.token);
    }
    const third = await post(fresh);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      const made = await post(old);
      expect(made.status).toBe(201);
      await h.call("DELETE", `${v1}/lfg/${made.body.id}`, undefined, old.token);
    }
  });

  it("can be reported, and a moderator takes it off the board", async () => {
    h = await harness(roomy);
    const boss = await h.user("boss@example.com");
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    await run(["grant", "@boss"], h.deps);
    const made = await post(mira, { note: "selling accounts, dm me" });
    expect(
      (
        await h.call(
          "POST",
          `${v1}/reports`,
          { targetKind: "lfg", targetId: made.body.id, reason: "spam" },
          mira.token,
        )
      ).status,
    ).toBe(400);
    const reported = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "lfg", targetId: made.body.id, reason: "spam" },
      kenji.token,
    );
    expect(reported.status).toBe(201);
    const queue = await h.call("GET", `${v1}/admin/reports`, undefined, boss.token);
    const report = queue.body.reports[0];
    expect(report).toMatchObject({
      targetKind: "lfg",
      target: { userId: mira.id },
      post: { note: "selling accounts, dm me", titleId: "PPSA01234", removed: false },
    });
    const removed = await h.call(
      "POST",
      `${v1}/admin/reports/${report.id}`,
      { action: "remove_post" },
      boss.token,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.report.post.removed).toBe(true);
    expect((await board(kenji)).body.posts).toEqual([]);
    expect((await h.call("GET", `${v1}/lfg/${made.body.id}`, undefined, kenji.token)).status).toBe(404);
    // A moderator may also take one down directly.
    const another = await post(mira);
    expect((await h.call("POST", `${v1}/admin/lfg/${another.body.id}/remove`, {}, kenji.token)).status).toBe(
      403,
    );
    expect((await h.call("POST", `${v1}/admin/lfg/${another.body.id}/remove`, {}, boss.token)).status).toBe(
      204,
    );
    expect((await board(kenji)).body.posts).toEqual([]);
    const audit = await h.call("GET", `${v1}/admin/audit`, undefined, boss.token);
    expect(audit.body.entries.filter((e: { action: string }) => e.action === "lfg.removed")).toHaveLength(2);
  });

  it("each LFG notification can be turned off", async () => {
    h = await harness(roomy);
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    await h.call("PATCH", `${v1}/me/notifications/settings`, { lfg_request: false }, mira.token);
    await h.call("PATCH", `${v1}/me/notifications/settings`, { lfg_accepted: false }, kenji.token);
    const made = await post(mira);
    await h.call("POST", `${v1}/lfg/${made.body.id}/requests`, {}, kenji.token);
    await h.call("POST", `${v1}/lfg/${made.body.id}/requests/${kenji.id}/accept`, {}, mira.token);
    expect((await h.call("GET", `${v1}/me/notifications`, undefined, mira.token)).body.notifications).toEqual(
      [],
    );
    expect(
      (await h.call("GET", `${v1}/me/notifications`, undefined, kenji.token)).body.notifications,
    ).toEqual([]);
  });

  it("lets in only into a party the poster leads: in someone else's party, yes is refused", async () => {
    h = await harness(roomy);
    const lead = await h.user("lead@example.com");
    const mira = await h.user("mira@example.com");
    const kenji = await h.user("kenji@example.com");
    await befriend(lead, mira);
    const party = (await h.call("POST", `${v1}/parties`, {}, lead.token)).body.id as string;
    await h.call("POST", `${v1}/parties/${party}/invites`, { userIds: [mira.id] }, lead.token);
    expect((await h.call("POST", `${v1}/parties/${party}/join`, {}, mira.token)).status).toBe(200);

    const id = (await post(mira)).body.id as string;
    await h.call("POST", `${v1}/lfg/${id}/requests`, {}, kenji.token);
    const refused = await h.call("POST", `${v1}/lfg/${id}/requests/${kenji.id}/accept`, {}, mira.token);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: "not_party_leader",
      title: "Only your party's leader can bring players in",
    });
    // Nothing changed: kenji still waits, is invited nowhere, and no slot is used.
    const mine = await h.call("GET", `${v1}/lfg/${id}`, undefined, mira.token);
    expect(mine.body).toMatchObject({ filled: 0, status: "open" });
    expect(mine.body.requests[0]).toMatchObject({ status: "pending", invite: null });
    const kenjiParty = await h.call("GET", `${v1}/me/party`, undefined, kenji.token);
    expect(kenjiParty.body).toMatchObject({ party: null, invites: [] });
    // Saying no is still the poster's to do.
    expect(
      (await h.call("POST", `${v1}/lfg/${id}/requests/${kenji.id}/decline`, {}, mira.token)).status,
    ).toBe(200);

    // Once mira leads the party, her yes brings players into it.
    const sol = await h.user("sol@example.com");
    await h.call("POST", `${v1}/lfg/${id}/requests`, {}, sol.token);
    await h.call("POST", `${v1}/parties/${party}/leader`, { userId: mira.id }, lead.token);
    const accepted = await h.call("POST", `${v1}/lfg/${id}/requests/${sol.id}/accept`, {}, mira.token);
    expect(accepted.status).toBe(200);
    const solParty = await h.call("GET", `${v1}/me/party`, undefined, sol.token);
    expect(solParty.body.invites).toMatchObject([{ partyId: party }]);

    // With no party at all, a yes makes one led by the poster, as before.
    const solo = await h.user("solo@example.com");
    const soloPost = (await post(solo)).body.id as string;
    await h.call("POST", `${v1}/lfg/${soloPost}/requests`, {}, kenji.token);
    const made = await h.call("POST", `${v1}/lfg/${soloPost}/requests/${kenji.id}/accept`, {}, solo.token);
    expect(made.status).toBe(200);
    const soloParty = await h.call("GET", `${v1}/me/party`, undefined, solo.token);
    expect(soloParty.body.party).toMatchObject({ leaderId: solo.id });
  });
});
