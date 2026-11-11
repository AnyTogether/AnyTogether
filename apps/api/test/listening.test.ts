import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPresenceExtra } from "../src/presence.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness({ publicProfiles: true });
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const heard = { title: "So What", artist: "Miles Davis" };

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);
const pick = (user: User, status: string) => h.call("PATCH", `${v1}/me/presence`, { status }, user.token);
const signedOut = async (path: string) => {
  const response = await h.app.request(`${v1}${path}`, { headers: { "cf-connecting-ip": "203.0.113.7" } });
  return { status: response.status, body: await response.json() };
};

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const got: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => got.push(JSON.parse(message)));
  return { got, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

/** What the gateway keeps while the user plays and shares what they listen to. */
const listening = (user: User) =>
  h.valkey.set(
    `presence:${user.id}`,
    JSON.stringify({ state: "in_game", titleId: "PPSA01234", status: "online", listening: heard }),
    "EX",
    60,
  );

describe("what someone listens to", () => {
  it("is shown to friends and to oneself, in the friends list and on the profile", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await listening(utku);
    const friends = await h.call("GET", `${v1}/me/friends`, undefined, ayse.token);
    expect(friends.body.friends[0].presence).toEqual({
      state: "in_game",
      titleId: "PPSA01234",
      status: "online",
      listening: heard,
    });
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.presence.listening).toEqual(
      heard,
    );
    expect((await h.call("GET", `${v1}/users/utku`, undefined, utku.token)).body.presence.listening).toEqual(
      heard,
    );
  });

  it("is never shown to someone who is not a friend, even with presence open to everyone", async () => {
    const utku = await h.user("utku@example.com");
    const stranger = await h.user("stranger@example.com");
    const asked = await h.user("asked@example.com");
    await setPrivacy(utku, { presence: "everyone" });
    await listening(utku);
    // A request that was not answered yet is not a friendship.
    await h.call("POST", `${v1}/me/friends/requests`, { handle: utku.handle }, asked.token);
    for (const other of [stranger, asked]) {
      const seen = await h.call("GET", `${v1}/users/utku`, undefined, other.token);
      expect(seen.body.visible.presence).toBe(true);
      expect(seen.body.presence).toEqual({ state: "in_game", titleId: "PPSA01234", status: "online" });
      expect(JSON.stringify(seen.body)).not.toContain("So What");
    }
    // The public profile, for someone who is not signed in.
    const card = await signedOut("/users/utku");
    expect(card.status).toBe(200);
    expect(JSON.stringify(card.body)).not.toContain("So What");
    expect(JSON.stringify(card.body)).not.toContain("listening");
    // Nor where people who play a game are listed.
    const players = await h.call(
      "GET",
      `${v1}/discover/players?titleId=PPSA01234`,
      undefined,
      stranger.token,
    );
    expect(JSON.stringify(players.body)).not.toContain("So What");
  });

  it("is hidden by Invisible, like the rest of the presence", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await listening(utku);
    const ayseHears = await listen(ayse.id);
    await pick(utku, "invisible");
    await settle();
    // Friends are told offline, with nothing else, and what the gateway kept is dropped.
    expect(ayseHears.got).toContainEqual(
      expect.objectContaining({ type: "presence.updated", data: { userId: utku.id, state: "offline" } }),
    );
    expect(JSON.stringify(ayseHears.got)).not.toContain("So What");
    ayseHears.stop();
    expect(await h.valkey.get(`presence:${utku.id}`)).toBeNull();
    // Even if something kept a presence, the API does not show it.
    await listening(utku);
    const friends = await h.call("GET", `${v1}/me/friends`, undefined, ayse.token);
    expect(friends.body.friends[0].presence).toEqual({ state: "offline" });
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.presence).toEqual({
      state: "offline",
    });
  });

  it("is hidden when presence is shown to nobody", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await listening(utku);
    const ayseHears = await listen(ayse.id);
    await setPrivacy(utku, { presence: "nobody" });
    await settle();
    expect(ayseHears.got).toContainEqual(
      expect.objectContaining({ type: "presence.updated", data: { userId: utku.id, state: "offline" } }),
    );
    expect(JSON.stringify(ayseHears.got)).not.toContain("So What");
    ayseHears.stop();
    expect(await h.valkey.get(`presence:${utku.id}`)).toBeNull();
    await listening(utku);
    const friends = await h.call("GET", `${v1}/me/friends`, undefined, ayse.token);
    expect(friends.body.friends[0].presence).toEqual({ state: "offline" });
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.presence).toBeUndefined();
  });

  it("stays when the API adds a party to the presence, and only friends are told", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    await listening(utku);
    const ayseHears = await listen(ayse.id);
    const strangerHears = await listen(stranger.id);
    const party = { id: "p1", size: 2, max: 8, open: false };
    await setPresenceExtra(h.valkey, utku.id, "party", party);
    await settle();
    expect(JSON.parse((await h.valkey.get(`presence:${utku.id}`)) ?? "{}")).toEqual({
      state: "in_game",
      titleId: "PPSA01234",
      status: "online",
      party,
      listening: heard,
    });
    // The merged presence keeps the time it had left: it still runs out by itself.
    const ttl = await h.valkey.ttl(`presence:${utku.id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(ayseHears.got).toContainEqual(
      expect.objectContaining({
        type: "presence.updated",
        data: expect.objectContaining({ userId: utku.id, party, listening: heard }),
      }),
    );
    expect(strangerHears.got).toEqual([]);
    ayseHears.stop();
    strangerHears.stop();
  });

  it("is nowhere in the account's data export", async () => {
    const utku = await h.user("utku@example.com");
    await listening(utku);
    const exported = await h.call("GET", `${v1}/me/export`, undefined, utku.token);
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.body)).not.toContain("So What");
  });
});
