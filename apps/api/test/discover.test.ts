import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);

/** Library rows as play sessions would leave them, `hoursAgo` since the last play. */
async function plays(user: User, titleId: string, hoursAgo = 1) {
  await h.deps.db.execute(sql`insert into games (title_id, names) values (${titleId}, ${JSON.stringify({ en: `Game ${titleId}` })}::jsonb)
    on conflict (title_id) do nothing`);
  await h.deps.db.execute(sql`insert into library (account_id, title_id, last_played_at, seconds_played)
    values (${user.id}, ${titleId}, now() - make_interval(hours => ${hoursAgo}), 3600)`);
}
const ids = (list: { user: { userId: string } }[]) => list.map((p) => p.user.userId);

describe("discovery", () => {
  it("follows the library until chosen: on with a public library, off without, and either way by choice", async () => {
    h = await harness({ publicProfiles: true });
    const mira = await h.user("mira@example.com");
    expect((await h.call("GET", `${v1}/me/discovery`, undefined, mira.token)).body).toEqual({
      discoverable: false,
      chosen: null,
      languages: [],
    });
    await setPrivacy(mira, { library: "everyone" });
    expect((await h.call("GET", `${v1}/me/discovery`, undefined, mira.token)).body.discoverable).toBe(true);
    const off = await h.call(
      "PATCH",
      `${v1}/me/discovery`,
      { discoverable: false, languages: ["EN", "nl", "en"] },
      mira.token,
    );
    expect(off.body).toEqual({ discoverable: false, chosen: false, languages: ["en", "nl"] });
    const back = await h.call("PATCH", `${v1}/me/discovery`, { discoverable: null }, mira.token);
    expect(back.body).toEqual({ discoverable: true, chosen: null, languages: ["en", "nl"] });
    expect((await h.call("PATCH", `${v1}/me/discovery`, { languages: ["english"] }, mira.token)).status).toBe(
      400,
    );
    expect((await h.call("PATCH", `${v1}/me/discovery`, {}, mira.token)).status).toBe(400);
  });

  it("players of a game: public libraries only, most recently played first, minus the hidden and blocked", async () => {
    h = await harness({ publicProfiles: true });
    const me = await h.user("me@example.com");
    const kenji = await h.user("kenji@example.com");
    const sol = await h.user("sol@example.com");
    const ines = await h.user("ines@example.com");
    const theo = await h.user("theo@example.com");
    const troll = await h.user("troll@example.com");
    for (const [user, hours] of [
      [kenji, 5],
      [sol, 1],
      [ines, 2],
      [theo, 3],
      [troll, 1],
    ] as const)
      await plays(user, "PPSA01284", hours);
    await setPrivacy(kenji, { library: "everyone", presence: "everyone" });
    await setPrivacy(sol, { library: "everyone" });
    await setPrivacy(troll, { library: "everyone" });
    // Ines keeps her library to friends; Theo shows it but opted out of discovery.
    await setPrivacy(theo, { library: "everyone" });
    await h.call("PATCH", `${v1}/me/discovery`, { discoverable: false }, theo.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: troll.id }, me.token);
    await h.valkey.set(`presence:${kenji.id}`, JSON.stringify({ state: "online" }), "EX", 60);
    await h.valkey.set(`presence:${sol.id}`, JSON.stringify({ state: "online" }), "EX", 60);
    await befriend(me, sol);

    const players = await h.call("GET", `${v1}/discover/players?titleId=PPSA01284`, undefined, me.token);
    expect(ids(players.body.players)).toEqual([sol.id, kenji.id]);
    expect(players.body.players[0]).toMatchObject({ friendship: "friends" });
    // Sol shows presence to friends only: not here. Kenji shows it to everyone.
    expect(players.body.players[0]).not.toHaveProperty("presence");
    expect(players.body.players[1]).toMatchObject({ friendship: "none", presence: { state: "online" } });
    expect((await h.call("GET", `${v1}/discover/players?titleId=nope`, undefined, me.token)).status).toBe(
      400,
    );
    // Ines choosing discovery still keeps a friends-only library out of "players of".
    await h.call("PATCH", `${v1}/me/discovery`, { discoverable: true }, ines.token);
    expect(
      ids(
        (await h.call("GET", `${v1}/discover/players?titleId=PPSA01284`, undefined, me.token)).body.players,
      ),
    ).not.toContain(ines.id);
  });

  it("suggests friends of friends, people playing the same games and speaking the language", async () => {
    h = await harness({ publicProfiles: true });
    const me = await h.user("me@example.com");
    const friend = await h.user("friend@example.com");
    const fof = await h.user("fof@example.com");
    const gamer = await h.user("gamer@example.com");
    const speaker = await h.user("speaker@example.com");
    const hidden = await h.user("hidden@example.com");
    const private_ = await h.user("private@example.com");
    await befriend(me, friend);
    await befriend(friend, fof);
    await befriend(friend, hidden);
    await befriend(friend, private_);
    await setPrivacy(fof, { library: "everyone" });
    await h.call("PATCH", `${v1}/me/discovery`, { discoverable: true }, private_.token);
    await setPrivacy(hidden, { library: "everyone" });
    await h.call("PATCH", `${v1}/me/discovery`, { discoverable: false }, hidden.token);
    await plays(me, "PPSA01284");
    await plays(gamer, "PPSA01284");
    await setPrivacy(gamer, { library: "everyone" });
    await h.call("PATCH", `${v1}/me/discovery`, { languages: ["tr"] }, me.token);
    await h.call(
      "PATCH",
      `${v1}/me/discovery`,
      { languages: ["tr", "en"], discoverable: true },
      speaker.token,
    );
    await plays(speaker, "PPSA07777", 24);

    const found = await h.call("GET", `${v1}/discover/suggestions`, undefined, me.token);
    const byId = new Map(
      found.body.suggestions.map((s: { user: { userId: string }; reasons: unknown[] }) => [
        s.user.userId,
        s.reasons,
      ]),
    );
    expect(byId.get(fof.id)).toEqual([{ kind: "friends", count: 1 }]);
    expect(byId.get(private_.id)).toEqual([{ kind: "friends", count: 1 }]);
    expect(byId.get(gamer.id)).toEqual([
      { kind: "game", titleId: "PPSA01284", names: { en: "Game PPSA01284" } },
    ]);
    expect(byId.get(speaker.id)).toEqual([{ kind: "language", language: "tr" }]);
    expect(byId.has(friend.id)).toBe(false);
    expect(byId.has(hidden.id)).toBe(false);
    expect(byId.has(me.id)).toBe(false);
    // Friends in common count first.
    expect(found.body.suggestions[0].reasons[0].kind).toBe("friends");

    // A friend who hides their friends list leads to nobody through them.
    await setPrivacy(friend, { friends: "nobody" });
    const again = await h.call("GET", `${v1}/discover/suggestions`, undefined, me.token);
    expect(ids(again.body.suggestions)).not.toContain(fof.id);
    // A request sent takes them out; a block too.
    await h.call("POST", `${v1}/me/friends/requests`, { handle: gamer.handle }, me.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: me.id }, speaker.token);
    expect((await h.call("GET", `${v1}/discover/suggestions`, undefined, me.token)).body.suggestions).toEqual(
      [],
    );
  });

  it("a game's hub: who plays it now in public, open posts, public parties and share plays", async () => {
    h = await harness({ publicProfiles: true, limits: { lfgPostNew: { max: 10, seconds: 86_400 } } });
    const me = await h.user("me@example.com");
    const kenji = await h.user("kenji@example.com");
    const shy = await h.user("shy@example.com");
    const ines = await h.user("ines@example.com");
    await plays(kenji, "PPSA01284");
    await setPrivacy(kenji, { presence: "everyone", library: "everyone" });
    for (const [user, titleId] of [
      [kenji, "PPSA01284"],
      [shy, "PPSA01284"],
      [ines, "PPSA07777"],
    ] as const) {
      await h.valkey.set(
        `presence:${user.id}`,
        JSON.stringify({ state: "in_game", titleId, since: "2026-10-24T18:00:00Z" }),
        "EX",
        60,
      );
      await h.valkey.zadd(`playing:${titleId}`, Date.now(), user.id);
    }
    // Gone a while ago: no longer counted, whatever presence says.
    await h.valkey.zadd("playing:PPSA01284", Date.now() - 10 * 60_000, ines.id);
    await h.call(
      "POST",
      `${v1}/lfg`,
      { titleId: "PPSA01284", purpose: "trophies", languages: ["en"], slots: 1 },
      ines.token,
    );
    await h.call("POST", `${v1}/parties`, { public: { join: "open", titleId: "PPSA01284" } }, ines.token);
    await h.call(
      "POST",
      `${v1}/share-plays`,
      { titleId: "PPSA01284", public: { join: "open", live: true } },
      kenji.token,
    );

    const hub = await h.call("GET", `${v1}/games/PPSA01284/hub`, undefined, me.token);
    expect(hub.status).toBe(200);
    expect(hub.body.game).toMatchObject({ titleId: "PPSA01284", names: { en: "Game PPSA01284" } });
    expect(hub.body.players).toBe(1);
    expect(hub.body.playing).toEqual({
      total: 1,
      people: [{ user: expect.objectContaining({ userId: kenji.id }), since: "2026-10-24T18:00:00Z" }],
    });
    expect(hub.body.lfg).toHaveLength(1);
    expect(hub.body.parties).toHaveLength(1);
    expect(hub.body.sharePlays).toEqual([
      expect.objectContaining({ live: true, host: expect.objectContaining({ userId: kenji.id }) }),
    ]);
    expect(ids(hub.body.recentPlayers)).toEqual([kenji.id]);
    expect((await h.call("GET", `${v1}/games/PPSA00000/hub`, undefined, me.token)).status).toBe(404);
    // Blocked: Kenji is gone from every part of the hub.
    await h.call("POST", `${v1}/me/blocks`, { userId: kenji.id }, me.token);
    const blocked = await h.call("GET", `${v1}/games/PPSA01284/hub`, undefined, me.token);
    expect(blocked.body.playing.total).toBe(0);
    expect(blocked.body.sharePlays).toEqual([]);
    expect(blocked.body.recentPlayers).toEqual([]);
  });
});
