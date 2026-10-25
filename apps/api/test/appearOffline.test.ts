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

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const appear = (user: User, appearOffline: unknown) =>
  h.call("PATCH", `${v1}/me/presence`, { appearOffline }, user.token);
const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

/** What the gateway keeps while the user is online and playing. */
const playing = (user: User, titleId = "PPSA01234") =>
  h.valkey.set(
    `presence:${user.id}`,
    JSON.stringify({ state: "in_game", titleId, since: "2026-10-25T10:00:00Z" }),
    "EX",
    60,
  );

describe("appear offline", () => {
  it("is off by default and kept on the account", async () => {
    const utku = await h.user("utku@example.com");
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.appearOffline).toBe(false);
    const on = await appear(utku, true);
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ appearOffline: true });
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.appearOffline).toBe(true);
    expect((await appear(utku, false)).body).toEqual({ appearOffline: false });
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.appearOffline).toBe(false);
  });

  it("takes only a yes or no", async () => {
    const utku = await h.user("utku@example.com");
    expect((await appear(utku, "yes")).status).toBe(400);
    expect((await h.call("PATCH", `${v1}/me/presence`, {}, utku.token)).status).toBe(400);
    expect((await h.call("PATCH", `${v1}/me/presence`, { appearOffline: true })).status).toBe(401);
  });

  it("shows friends offline at once, tells the user's other devices, and keeps quiet while on", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await playing(utku);
    expect(
      (await h.call("GET", `${v1}/me/friends`, undefined, ayse.token)).body.friends[0].presence.state,
    ).toBe("in_game");

    const ayseHears = await listen(ayse.id);
    const utkuHears = await listen(utku.id);
    await appear(utku, true);
    await settle();
    expect(ayseHears.heard).toContainEqual(
      expect.objectContaining({ type: "presence.updated", data: { userId: utku.id, state: "offline" } }),
    );
    expect(utkuHears.heard).toContainEqual(
      expect.objectContaining({ type: "presence.mode", data: { appearOffline: true } }),
    );
    // Turning it on twice tells no one twice.
    ayseHears.heard.length = 0;
    await appear(utku, true);
    await settle();
    expect(ayseHears.heard.filter((e) => e.type === "presence.updated")).toEqual([]);
    ayseHears.stop();
    utkuHears.stop();

    // The gateway is told to keep quiet; the API shows offline even if a presence was kept.
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");
    expect(await h.valkey.get(`presence:${utku.id}`)).toBeNull();
    await playing(utku);
    expect((await h.call("GET", `${v1}/me/friends`, undefined, ayse.token)).body.friends[0].presence).toEqual(
      {
        state: "offline",
      },
    );
    // To a friend the profile looks like any offline one: presence shown, and offline.
    const card = await h.call("GET", `${v1}/users/utku`, undefined, ayse.token);
    expect(card.body.visible.presence).toBe(true);
    expect(card.body.presence).toEqual({ state: "offline" });
  });

  it("survives a Valkey that forgot: every sign-in tells the gateway again", async () => {
    const utku = await h.user("utku@example.com");
    await appear(utku, true);
    await h.valkey.flushdb();
    await h.call("POST", `${v1}/auth/email/start`, { email: "utku@example.com" });
    await h.call("POST", `${v1}/auth/email/verify`, {
      email: "utku@example.com",
      code: h.mailer.lastCode("utku@example.com"),
    });
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");
  });

  it("back online: the gateway may tell friends again, unless privacy still hides presence", async () => {
    const utku = await h.user("utku@example.com");
    await appear(utku, true);
    const utkuHears = await listen(utku.id);
    await appear(utku, false);
    await settle();
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBeNull();
    expect(utkuHears.heard).toContainEqual(
      expect.objectContaining({ type: "presence.mode", data: { appearOffline: false } }),
    );
    utkuHears.stop();

    // Privacy and appear offline each hide on their own; showing one again leaves the other.
    await setPrivacy(utku, { presence: "nobody" });
    await appear(utku, true);
    await appear(utku, false);
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");
    await appear(utku, true);
    await setPrivacy(utku, { presence: "friends" });
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBe("1");
    await appear(utku, false);
    expect(await h.valkey.get(`presence-hidden:${utku.id}`)).toBeNull();
  });

  it("is gone from discovery and the game hub's playing now", async () => {
    const me = await h.user("me@example.com");
    const kenji = await h.user("kenji@example.com");
    await h.deps.db.execute(sql`insert into games (title_id, names) values ('PPSA01284', '{"en":"Game"}'::jsonb)
      on conflict (title_id) do nothing`);
    await h.deps.db.execute(sql`insert into library (account_id, title_id, last_played_at, seconds_played)
      values (${kenji.id}, 'PPSA01284', now(), 3600)`);
    await setPrivacy(kenji, { presence: "everyone", library: "everyone" });
    const inGame = async () => {
      await playing(kenji, "PPSA01284");
      await h.valkey.zadd("playing:PPSA01284", Date.now(), kenji.id);
    };
    await inGame();
    const before = await h.call("GET", `${v1}/games/PPSA01284/hub`, undefined, me.token);
    expect(before.body.playing.total).toBe(1);
    const players = await h.call("GET", `${v1}/discover/players?titleId=PPSA01284`, undefined, me.token);
    expect(players.body.players[0].presence).toMatchObject({ state: "in_game" });

    await appear(kenji, true);
    // Even if the gateway had kept something since, nothing shows.
    await inGame();
    const after = await h.call("GET", `${v1}/games/PPSA01284/hub`, undefined, me.token);
    expect(after.body.playing).toEqual({ total: 0, people: [] });
    const hidden = await h.call("GET", `${v1}/discover/players?titleId=PPSA01284`, undefined, me.token);
    expect(hidden.body.players[0].presence).toBeUndefined();
  });
});

describe("appearing offline, for the user's own records", () => {
  it("still knows the game they play (from their devices) when it remembers who they met", async () => {
    const { playingNow } = await import("../src/met.js");
    const utku = await h.user("utku@example.com");
    await appear(utku, true);
    await h.valkey.sadd(`presence-devices:${utku.id}`, "s1", "s2");
    await h.valkey.set(`presence:${utku.id}:s1`, JSON.stringify({ state: "online" }));
    await h.valkey.set(`presence:${utku.id}:s2`, JSON.stringify({ state: "in_game", titleId: "PPSA01234" }));
    expect(await playingNow(h.valkey, utku.id)).toBe("PPSA01234");
    await h.valkey.set(`presence:${utku.id}:s2`, JSON.stringify({ state: "away" }));
    expect(await playingNow(h.valkey, utku.id)).toBeNull();
  });
});
