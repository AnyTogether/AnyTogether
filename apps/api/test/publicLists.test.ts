import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const roomy = { limits: { joinRequestNew: { max: 100, seconds: 3600 } } };

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
const publicParties = (user: User, query = "") =>
  h.call("GET", `${v1}/parties/public${query}`, undefined, user.token);
const publicShares = (user: User, query = "") =>
  h.call("GET", `${v1}/share-plays/public${query}`, undefined, user.token);

describe("public parties", () => {
  it("are never public by default; listed ones show with game, language, size and host", async () => {
    h = await harness(roomy);
    const ines = await h.user("ines@example.com");
    const theo = await h.user("theo@example.com");
    const sol = await h.user("sol@example.com");
    const quiet = await h.call("POST", `${v1}/parties`, {}, theo.token);
    expect(quiet.body.public).toBeNull();
    const topic = await watchTopic("discover:PPSA01234");
    const made = await h.call(
      "POST",
      `${v1}/parties`,
      { public: { join: "request", titleId: "PPSA01234", language: "en" } },
      ines.token,
    );
    expect(made.body.public).toEqual({ join: "request", titleId: "PPSA01234", language: "en" });
    expect(made.body.requests).toEqual([]);
    const list = await publicParties(sol);
    expect(list.body.parties).toEqual([
      expect.objectContaining({
        id: made.body.id,
        host: expect.objectContaining({ userId: ines.id }),
        titleId: "PPSA01234",
        language: "en",
        join: "request",
        size: 1,
        max: 8,
        requested: false,
      }),
    ]);
    expect((await publicParties(sol, "?titleId=PPSA07777")).body.parties).toEqual([]);
    expect((await publicParties(sol, "?language=tr")).body.parties).toEqual([]);
    await settle();
    expect(topic.heard[0]).toMatchObject({
      type: "discover.changed",
      data: { kind: "party", id: made.body.id, change: "listed" },
    });
    topic.stop();
    // A stranger sees the party, but not who was invited or who asked.
    const seen = await h.call("GET", `${v1}/parties/${made.body.id}`, undefined, sol.token);
    expect(seen.status).toBe(200);
    expect(seen.body).not.toHaveProperty("requests");
    expect(seen.body.invited).toEqual([]);
    // Unlisted: gone from the list and from strangers.
    await h.call("PATCH", `${v1}/parties/${made.body.id}`, { public: null }, ines.token);
    expect((await publicParties(sol)).body.parties).toEqual([]);
    expect((await h.call("GET", `${v1}/parties/${made.body.id}`, undefined, sol.token)).status).toBe(404);
  });

  it("asking to join: the leader hears it, lets them in with an invite, and they join", async () => {
    h = await harness(roomy);
    const ines = await h.user("ines@example.com");
    const sol = await h.user("sol@example.com");
    const made = await h.call("POST", `${v1}/parties`, { public: { join: "request" } }, ines.token);
    const id = made.body.id as string;
    expect((await h.call("POST", `${v1}/parties/${id}/join`, {}, sol.token)).status).toBe(403);
    const inesHears = await listen(ines.id);
    const asked = await h.call("POST", `${v1}/parties/${id}/requests`, {}, sol.token);
    expect(asked.status).toBe(201);
    await settle();
    expect(inesHears.of("party.request")[0]?.data).toMatchObject({ partyId: id, from: { userId: sol.id } });
    inesHears.stop();
    expect((await publicParties(sol)).body.parties[0].requested).toBe(true);
    expect((await h.call("GET", `${v1}/me/party`, undefined, sol.token)).body.requests).toEqual([
      expect.objectContaining({ partyId: id }),
    ]);
    const party = await h.call("GET", `${v1}/parties/${id}`, undefined, ines.token);
    expect(party.body.requests.map((p: { userId: string }) => p.userId)).toEqual([sol.id]);
    // Only the leader answers.
    expect(
      (await h.call("POST", `${v1}/parties/${id}/requests/${sol.id}/accept`, {}, sol.token)).status,
    ).toBe(403);
    const solHears = await listen(sol.id);
    const yes = await h.call("POST", `${v1}/parties/${id}/requests/${sol.id}/accept`, {}, ines.token);
    expect(yes.status).toBe(200);
    expect(yes.body.requests).toEqual([]);
    expect(yes.body.invited.map((p: { userId: string }) => p.userId)).toEqual([sol.id]);
    await settle();
    expect(solHears.of("party.request_answered")[0]?.data).toEqual({ partyId: id, answer: "accepted" });
    expect(solHears.of("party.invite")).toHaveLength(1);
    solHears.stop();
    expect((await h.call("POST", `${v1}/parties/${id}/join`, {}, sol.token)).status).toBe(200);
  });

  it("an open public party lets anyone walk in; a block keeps both apart", async () => {
    h = await harness(roomy);
    const ines = await h.user("ines@example.com");
    const sol = await h.user("sol@example.com");
    const troll = await h.user("troll@example.com");
    const made = await h.call("POST", `${v1}/parties`, { public: { join: "open" } }, ines.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: troll.id }, ines.token);
    expect((await publicParties(troll)).body.parties).toEqual([]);
    expect((await h.call("GET", `${v1}/parties/${made.body.id}`, undefined, troll.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/parties/${made.body.id}/join`, {}, troll.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/parties/${made.body.id}/requests`, {}, troll.token)).status).toBe(
      404,
    );
    expect((await h.call("POST", `${v1}/parties/${made.body.id}/join`, {}, sol.token)).status).toBe(200);
    expect((await publicParties(sol)).body.parties[0].size).toBe(2);
    // A blocked person in the party hides it from the blocker too.
    const other = await h.call("POST", `${v1}/parties`, { public: { join: "open" } }, troll.token);
    expect((await publicParties(ines)).body.parties.map((p: { id: string }) => p.id)).not.toContain(
      other.body.id,
    );
    // The last one out ends it, and it leaves the list.
    await h.call("POST", `${v1}/parties/${made.body.id}/leave`, {}, sol.token);
    await h.call("POST", `${v1}/parties/${made.body.id}/leave`, {}, ines.token);
    expect((await publicParties(sol)).body.parties.map((p: { id: string }) => p.id)).toEqual([other.body.id]);
  });

  it("new accounts walk into strangers' parties less often", async () => {
    h = await harness({ limits: { joinRequestNew: { max: 1, seconds: 3600 } } });
    const sol = await h.user("sol@example.com");
    const a = await h.user("a@example.com");
    const b = await h.user("b@example.com");
    const first = await h.call("POST", `${v1}/parties`, { public: { join: "open" } }, a.token);
    const second = await h.call("POST", `${v1}/parties`, { public: { join: "request" } }, b.token);
    expect((await h.call("POST", `${v1}/parties/${first.body.id}/join`, {}, sol.token)).status).toBe(200);
    expect((await h.call("POST", `${v1}/parties/${second.body.id}/requests`, {}, sol.token)).status).toBe(
      429,
    );
  });
});

describe("public share plays", () => {
  it("are listed by their host's choice; Live now needs an open one; anyone may watch an open one", async () => {
    h = await harness(roomy);
    const host = await h.user("host@example.com");
    const viewer = await h.user("viewer@example.com");
    const troll = await h.user("troll@example.com");
    expect(
      (
        await h.call(
          "POST",
          `${v1}/share-plays`,
          { titleId: "PPSA01234", public: { join: "request", live: true } },
          host.token,
        )
      ).status,
    ).toBe(400);
    const plain = await h.call("POST", `${v1}/share-plays`, { titleId: "PPSA01234" }, host.token);
    expect(plain.body.sharePlay.public).toBeNull();
    expect((await publicShares(viewer)).body.sharePlays).toEqual([]);
    const id = plain.body.sharePlay.id as string;
    const listed = await h.call(
      "PATCH",
      `${v1}/share-plays/${id}`,
      { public: { join: "open", language: "en", live: true }, maxViewers: 1 },
      host.token,
    );
    expect(listed.body.public).toEqual({ join: "open", language: "en", live: true });
    const live = await publicShares(viewer, "?live=1");
    expect(live.body.sharePlays).toEqual([
      expect.objectContaining({
        id,
        host: expect.objectContaining({ userId: host.id }),
        titleId: "PPSA01234",
        join: "open",
        live: true,
        language: "en",
        viewers: 0,
        maxViewers: 1,
      }),
    ]);
    await h.call("POST", `${v1}/me/blocks`, { userId: troll.id }, host.token);
    expect((await publicShares(troll)).body.sharePlays).toEqual([]);
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, troll.token)).status).toBe(404);
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, viewer.token)).status).toBe(201);
    // The host's viewer limit holds for strangers too.
    const third = await h.user("third@example.com");
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, third.token)).status).toBe(409);
    // Ending it takes it off the list.
    await h.call("DELETE", `${v1}/share-plays/${id}`, undefined, host.token);
    expect((await publicShares(viewer)).body.sharePlays).toEqual([]);
  });

  it("asking to join: the host hears it and lets them in with an invite", async () => {
    h = await harness(roomy);
    const host = await h.user("host@example.com");
    const viewer = await h.user("viewer@example.com");
    const started = await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: "PPSA01234", public: { join: "request" } },
      host.token,
    );
    const id = started.body.sharePlay.id as string;
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, viewer.token)).status).toBe(403);
    const hostHears = await listen(host.id);
    expect((await h.call("POST", `${v1}/share-plays/${id}/requests`, {}, viewer.token)).status).toBe(201);
    await settle();
    expect(hostHears.of("share_play.request")[0]?.data).toMatchObject({
      sharePlayId: id,
      from: { userId: viewer.id },
    });
    hostHears.stop();
    expect((await publicShares(viewer)).body.sharePlays[0].requested).toBe(true);
    const mine = await h.call("GET", `${v1}/share-plays/${id}`, undefined, host.token);
    expect(mine.body.requests.map((p: { userId: string }) => p.userId)).toEqual([viewer.id]);
    const viewerHears = await listen(viewer.id);
    const yes = await h.call("POST", `${v1}/share-plays/${id}/requests/${viewer.id}/accept`, {}, host.token);
    expect(yes.body.requests).toEqual([]);
    await settle();
    expect(viewerHears.of("share_play.invite")).toHaveLength(1);
    expect(viewerHears.of("share_play.request_answered")[0]?.data).toEqual({
      sharePlayId: id,
      answer: "accepted",
    });
    viewerHears.stop();
    expect((await h.call("POST", `${v1}/share-plays/${id}/join`, {}, viewer.token)).status).toBe(201);
    // Unlisting drops whoever still asks.
    const late = await h.user("late@example.com");
    await h.call("POST", `${v1}/share-plays/${id}/requests`, {}, late.token);
    const lateHears = await listen(late.id);
    await h.call("PATCH", `${v1}/share-plays/${id}`, { public: null }, host.token);
    await settle();
    expect(lateHears.of("share_play.request_answered")[0]?.data).toMatchObject({ answer: "declined" });
    lateHears.stop();
    expect((await h.call("GET", `${v1}/share-plays/${id}`, undefined, late.token)).status).toBe(404);
  });
});
