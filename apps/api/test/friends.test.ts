import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

describe("friends", () => {
  it("asks by handle, is told, accepts, and both see each other", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const ayseHears = await listen(ayse.id);
    const asked = await h.call("POST", "/api/v1/me/friends/requests", { handle: "AYSE" }, utku.token);
    expect(asked.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      ayseHears.heard.some((event) => event.type === "friend.request" && event.data.handle === "utku"),
    ).toBe(true);

    const incoming = await h.call("GET", "/api/v1/me/friends/requests", undefined, ayse.token);
    expect(incoming.body.incoming.map((r: { handle: string }) => r.handle)).toEqual(["utku"]);
    expect(
      (await h.call("GET", "/api/v1/me/friends/requests", undefined, utku.token)).body.outgoing,
    ).toHaveLength(1);

    expect(
      (await h.call("POST", `/api/v1/me/friends/requests/${utku.id}/accept`, {}, ayse.token)).status,
    ).toBe(204);
    const utkuFriends = await h.call("GET", "/api/v1/me/friends", undefined, utku.token);
    expect(utkuFriends.body.friends.map((f: { handle: string }) => f.handle)).toEqual(["ayse"]);
    expect(utkuFriends.body.friends[0].presence.state).toBe("offline");
    expect(await h.valkey.smembers(`friends:${utku.id}`)).toEqual([ayse.id]);
    ayseHears.stop();
  });

  it("asking someone who already asked you makes you friends", async () => {
    const a = await h.user("a@example.com");
    const b = await h.user("b@example.com");
    await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    const back = await h.call("POST", "/api/v1/me/friends/requests", { handle: a.handle }, b.token);
    expect(back.body.state).toBe("accepted");
    expect((await h.call("GET", "/api/v1/me/friends", undefined, a.token)).body.friends).toHaveLength(1);
  });

  it("shows a friend's presence as the gateway keeps it", async () => {
    const a = await h.user("p1@example.com");
    const b = await h.user("p2@example.com");
    await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
    await h.valkey.set(
      `presence:${b.id}`,
      JSON.stringify({ state: "in_game", titleId: "PPSA01234", since: "2026-10-24T10:00:00Z" }),
    );
    const friends = await h.call("GET", "/api/v1/me/friends", undefined, a.token);
    expect(friends.body.friends[0].presence).toMatchObject({ state: "in_game", titleId: "PPSA01234" });
  });

  it("declines, removes, and refuses yourself and strangers", async () => {
    const a = await h.user("d1@example.com");
    const b = await h.user("d2@example.com");
    expect((await h.call("POST", "/api/v1/me/friends/requests", { handle: a.handle }, a.token)).status).toBe(
      400,
    );
    expect((await h.call("POST", "/api/v1/me/friends/requests", { handle: "nobody" }, a.token)).status).toBe(
      404,
    );
    await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    expect((await h.call("POST", `/api/v1/me/friends/requests/${a.id}/decline`, {}, b.token)).status).toBe(
      204,
    );
    expect(
      (await h.call("GET", "/api/v1/me/friends/requests", undefined, b.token)).body.incoming,
    ).toHaveLength(0);
    await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
    const aHears = await listen(a.id);
    expect((await h.call("DELETE", `/api/v1/me/friends/${a.id}`, undefined, b.token)).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await h.call("GET", "/api/v1/me/friends", undefined, a.token)).body.friends).toHaveLength(0);
    expect(await h.valkey.smembers(`friends:${a.id}`)).toEqual([]);
    expect(aHears.heard.some((event) => event.type === "friend.removed")).toBe(true);
    aHears.stop();
  });

  it("a block ends the friendship and stops requests", async () => {
    const a = await h.user("b1@example.com");
    const b = await h.user("b2@example.com");
    await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
    expect((await h.call("POST", "/api/v1/me/blocks", { userId: a.id }, b.token)).status).toBe(204);
    expect((await h.call("GET", "/api/v1/me/friends", undefined, a.token)).body.friends).toHaveLength(0);
    const again = await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
    expect(again.status).toBe(404);
  });
});

describe("people", () => {
  it("finds people by handle and shows a profile", async () => {
    const a = await h.user("searcher@example.com");
    await h.user("utku.halis@example.com");
    await h.user("utkan@example.com");
    const found = await h.call("GET", "/api/v1/users/search?q=utk", undefined, a.token);
    expect(found.body.users.map((u: { handle: string }) => u.handle).sort()).toEqual(["utkan", "utku.halis"]);
    const profile = await h.call("GET", "/api/v1/users/utkan", undefined, a.token);
    expect(profile.body).toMatchObject({ handle: "utkan", friendship: "none" });
    expect(profile.body.email).toBeUndefined();
    const self = await h.call("GET", "/api/v1/users/search?q=searcher", undefined, a.token);
    expect(self.body.users).toHaveLength(0);
  });
});
