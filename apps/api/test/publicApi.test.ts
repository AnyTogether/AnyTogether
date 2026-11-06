import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
const start = async (overrides: Parameters<typeof harness>[0] = {}) => {
  h = await harness({ publicProfiles: true, ...overrides });
};
afterEach(async () => {
  await h?.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const pub = "/api/v1/public";
const game = "PPSA01234";
const set = "a1b2c3d4e5f6";
const allScopes = ["profiles:read", "leaderboards:read", "challenges:read"];

const makeToken = async (user: User, scopes = allScopes, name = "My bot") => {
  const made = await h.call("POST", `${v1}/me/api-tokens`, { name, scopes }, user.token);
  expect(made.status).toBe(201);
  return made.body as { id: string; token: string; start: string; scopes: string[] };
};
const read = (token: string | undefined, path: string) => h.call("GET", `${pub}${path}`, undefined, token);
const setPrivacy = (user: User, privacy: Record<string, string>) =>
  h.call("PATCH", `${v1}/me/privacy`, privacy, user.token);
const setPublic = (user: User, on: boolean) =>
  h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: on }, user.token);
async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
async function teachSet(user: User) {
  await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/${game}/${set}`,
    {
      trophies: [
        { id: 0, grade: "bronze", texts: { en: { name: "One" } } },
        { id: 1, grade: "silver", texts: { en: { name: "Two" } } },
        { id: 2, grade: "gold", texts: { en: { name: "Three" } } },
        { id: 3, grade: "platinum", texts: { en: { name: "Four" } } },
      ],
    },
    user.token,
  );
}
const earn = (user: User, ids: number[], earnedAt = new Date(Date.now() - 60_000)) =>
  h.call(
    "POST",
    `${v1}/me/trophies`,
    {
      trophies: ids.map((trophyId) => ({
        titleId: game,
        setHash: set,
        trophyId,
        earnedAt: earnedAt.toISOString(),
      })),
    },
    user.token,
  );
/** Every key anywhere in an answer: the public API never hands out account IDs. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

describe("personal API tokens", () => {
  it("are made, listed without the secret, and stop working once revoked", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const made = await makeToken(ana, ["profiles:read"]);
    expect(made.token).toMatch(/^atp_[A-Za-z0-9_-]{40,}$/);
    expect(made.start).toBe(made.token.slice(0, 8));
    const list = await h.call("GET", `${v1}/me/api-tokens`, undefined, ana.token);
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0]).toMatchObject({
      id: made.id,
      name: "My bot",
      scopes: ["profiles:read"],
      lastUsedAt: null,
    });
    expect(JSON.stringify(list.body)).not.toContain(made.token);

    expect((await read(made.token, `/users/${ana.handle}`)).status).toBe(200);
    const used = await h.call("GET", `${v1}/me/api-tokens`, undefined, ana.token);
    expect(used.body.tokens[0].lastUsedAt).not.toBeNull();

    // Someone else cannot revoke it.
    const ben = await h.user("ben@example.com");
    expect((await h.call("DELETE", `${v1}/me/api-tokens/${made.id}`, undefined, ben.token)).status).toBe(404);
    expect((await h.call("DELETE", `${v1}/me/api-tokens/${made.id}`, undefined, ana.token)).status).toBe(204);
    expect((await read(made.token, `/users/${ana.handle}`)).status).toBe(401);
    expect((await h.call("GET", `${v1}/me/api-tokens`, undefined, ana.token)).body.tokens).toEqual([]);
  });

  it("refuses bad input, more than ten, and a token in place of a sign-in", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    expect((await h.call("POST", `${v1}/me/api-tokens`, { name: "x", scopes: [] }, ana.token)).status).toBe(
      400,
    );
    expect(
      (await h.call("POST", `${v1}/me/api-tokens`, { name: "x", scopes: ["messages:write"] }, ana.token))
        .status,
    ).toBe(400);
    expect(
      (await h.call("POST", `${v1}/me/api-tokens`, { name: "", scopes: allScopes }, ana.token)).status,
    ).toBe(400);
    let last = "";
    for (let i = 0; i < 10; i++) last = (await makeToken(ana, allScopes, `Bot ${i}`)).token;
    const eleventh = await h.call(
      "POST",
      `${v1}/me/api-tokens`,
      { name: "One more", scopes: allScopes },
      ana.token,
    );
    expect(eleventh.status).toBe(409);
    // An API token never signs in to the rest of the API.
    expect((await h.call("GET", `${v1}/me`, undefined, last)).status).toBe(401);
    expect((await h.call("GET", `${v1}/me/api-tokens`, undefined, last)).status).toBe(401);
  });
});

describe("the public API", () => {
  it("wants a valid token with the right scope", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    expect((await read(undefined, `/users/${ana.handle}`)).status).toBe(401);
    expect((await read("atp_nothing", `/users/${ana.handle}`)).status).toBe(401);
    // A sign-in's access token is not an API token.
    expect((await read(ana.token, `/users/${ana.handle}`)).status).toBe(401);

    const profilesOnly = await makeToken(ana, ["profiles:read"]);
    expect((await read(profilesOnly.token, `/users/${ana.handle}`)).status).toBe(200);
    const refused = await read(profilesOnly.token, "/leaderboards/points");
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden", scope: "leaderboards:read" });
    expect((await read(profilesOnly.token, "/challenges")).status).toBe(403);

    const me = await read(profilesOnly.token, "/token");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ name: "My bot", scopes: ["profiles:read"] });

    // A banned account's tokens stop working.
    await h.deps.db.execute(sql`update accounts set status = 'banned' where id = ${ana.id}`);
    expect((await read(profilesOnly.token, "/token")).status).toBe(401);
  });

  it("shows a profile as a signed-out reader sees it, and never an account ID", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const { token } = await makeToken(ana);
    await teachSet(ben);
    await earn(ben, [0, 1]);

    // Public profile on, library and trophies open to friends only (the default).
    const card = await read(token, `/users/${ben.handle}`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({
      handle: ben.handle,
      publicProfile: true,
      visible: { library: false, trophies: false },
    });
    expect(keysOf(card.body)).not.toContain("userId");
    expect((await read(token, `/users/${ben.handle}/library`)).status).toBe(403);
    expect((await read(token, `/users/${ben.handle}/trophies`)).status).toBe(403);

    await setPrivacy(ben, { library: "everyone", trophies: "everyone" });
    const library = await read(token, `/users/${ben.handle}/library`);
    expect(library.status).toBe(200);
    expect(library.body.games.map((g: { titleId: string }) => g.titleId)).toEqual([game]);
    const trophies = await read(token, `/users/${ben.handle}/trophies?titleId=${game}`);
    expect(trophies.status).toBe(200);
    expect(trophies.body.trophies.filter((t: { earnedAt: string | null }) => t.earnedAt)).toHaveLength(2);

    // Being friends changes nothing: the API reads as a stranger.
    await befriend(ana, ben);
    await setPrivacy(ben, { library: "friends", trophies: "friends" });
    expect((await read(token, `/users/${ben.handle}/library`)).status).toBe(403);

    // The public profile switch off: the minimal card, and every part refused.
    await setPrivacy(ben, { library: "everyone", trophies: "everyone" });
    await setPublic(ben, false);
    const minimal = await read(token, `/users/${ben.handle}`);
    expect(minimal.status).toBe(200);
    expect(minimal.body).toMatchObject({
      handle: ben.handle,
      bio: null,
      publicProfile: false,
      visible: { library: false },
    });
    expect((await read(token, `/users/${ben.handle}/library`)).status).toBe(403);
    expect((await read(token, `/users/${ben.handle}/trophies`)).status).toBe(403);
    expect((await read(token, "/users/nobody-here")).status).toBe(404);
  });

  it("hides people blocked either way from the token's owner", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const troll = await h.user("troll@example.com");
    const shy = await h.user("shy@example.com");
    const { token } = await makeToken(ana);
    await teachSet(troll);
    for (const user of [troll, shy]) {
      await setPrivacy(user, { library: "everyone", trophies: "everyone" });
      await earn(user, [3]);
    }
    await h.call("POST", `${v1}/me/blocks`, { userId: troll.id }, ana.token);
    await h.call("POST", `${v1}/me/blocks`, { userId: ana.id }, shy.token);
    for (const who of [troll, shy]) {
      expect((await read(token, `/users/${who.handle}`)).status).toBe(404);
      expect((await read(token, `/users/${who.handle}/trophies`)).status).toBe(404);
    }
    const board = await read(token, "/leaderboards/points");
    expect(board.status).toBe(200);
    expect(board.body.entries).toEqual([]);
    const gameBoard = await read(token, `/games/${game}/leaderboard?by=points`);
    expect(gameBoard.body.entries).toEqual([]);
  });

  it("serves the global leaderboards only, with nobody who keeps their trophies or library from everyone", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const open = await h.user("open@example.com");
    const friendsOnly = await h.user("friends@example.com");
    const switchedOff = await h.user("off@example.com");
    const { token } = await makeToken(ana, ["leaderboards:read"]);
    await teachSet(open);
    for (const user of [open, friendsOnly, switchedOff]) await earn(user, [2]);
    await setPrivacy(open, { library: "everyone", trophies: "everyone" });
    await setPrivacy(switchedOff, { library: "everyone", trophies: "everyone" });
    await setPublic(switchedOff, false);
    await befriend(ana, friendsOnly);

    const overall = await read(token, "/leaderboards/points");
    expect(overall.status).toBe(200);
    expect(overall.body.entries.map((e: { user: { handle: string } }) => e.user.handle)).toEqual([
      open.handle,
    ]);
    expect(overall.body.entries[0]).toMatchObject({ rank: 1, value: 90 });
    expect(overall.body).not.toHaveProperty("me");
    expect(keysOf(overall.body)).not.toContain("userId");

    const byGame = await read(token, `/games/${game}/leaderboard?by=points&limit=5`);
    expect(byGame.status).toBe(200);
    expect(byGame.body).toMatchObject({ board: "points", game: { titleId: game } });
    expect(byGame.body.entries.map((e: { user: { handle: string } }) => e.user.handle)).toEqual([
      open.handle,
    ]);
    expect((await read(token, `/games/${game}/leaderboard?by=nonsense`)).status).toBe(400);
    expect((await read(token, `/games/${game}/leaderboard?scope=friends`)).status).toBe(400);
    expect((await read(token, "/games/PPSA99999/leaderboard")).status).toBe(404);

    const info = await read(token, `/games/${game}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ titleId: game, names: { en: "Cat Quest" } });
  });

  it("lists only challenges made for everyone, and hides entrants who keep that part private", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const shy = await h.user("shy@example.com");
    await teachSet(ana);
    await befriend(ana, ben);
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();
    const base = { titleId: game, metric: "points", startsAt, endsAt };
    const open = await h.call(
      "POST",
      `${v1}/challenges`,
      { ...base, title: "Open race", audience: "public" },
      ana.token,
    );
    expect(open.status).toBe(201);
    const closed = await h.call(
      "POST",
      `${v1}/challenges`,
      { ...base, title: "Friends race", audience: "friends" },
      ana.token,
    );
    expect(closed.status).toBe(201);
    await h.call("POST", `${v1}/challenges/${open.body.id}/join`, {}, shy.token);
    await h.call("POST", `${v1}/challenges/${open.body.id}/join`, {}, ben.token);
    await setPrivacy(ana, { trophies: "everyone" });
    await setPrivacy(ben, { trophies: "everyone" });
    await setPublic(ben, false);
    // Started an hour ago, so the trophies below count.
    await h.deps.db.execute(sql`update challenges set starts_at = now() - interval '1 hour'`);
    await earn(ana, [0]);
    await earn(ben, [3]);
    await earn(shy, [2]);

    const { token } = await makeToken(ben, ["challenges:read"]);
    const list = await read(token, "/challenges");
    expect(list.status).toBe(200);
    expect(list.body.challenges.map((c: { id: string }) => c.id)).toEqual([open.body.id]);
    expect((await read(token, `/challenges/${closed.body.id}`)).status).toBe(404);

    const detail = await read(token, `/challenges/${open.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      title: "Open race",
      state: "active",
      entrants: 3,
      audience: "public",
    });
    expect(detail.body).not.toHaveProperty("joined");
    // Ben's public profile is off and Shy's trophies are friends-only: their places stay, their
    // names do not.
    expect(
      detail.body.standings.map((s: { rank: number; user: { handle: string } | null; value: number }) => [
        s.rank,
        s.user?.handle ?? null,
        s.value,
      ]),
    ).toEqual([
      [1, null, 300],
      [2, null, 90],
      [3, ana.handle, 15],
    ]);
    expect(keysOf(detail.body)).not.toContain("userId");
  });

  it("counts every token on its own and every account across its tokens, with headers saying how many are left", async () => {
    await start({
      limits: { publicApi: { max: 3, seconds: 60 }, publicApiAccount: { max: 5, seconds: 60 } },
    });
    const ana = await h.user("ana@example.com");
    const first = await makeToken(ana, ["profiles:read"], "First");
    const second = await makeToken(ana, ["profiles:read"], "Second");
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await read(first.token, `/users/${ana.handle}`));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 429]);
    expect(answers[0]?.headers.get("ratelimit-limit")).toBe("3");
    expect(answers[0]?.headers.get("ratelimit-remaining")).toBe("2");
    expect(Number(answers[0]?.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
    expect(answers[3]?.headers.get("retry-after")).toBeTruthy();
    expect(answers[3]?.body).toMatchObject({ code: "rate_limited", limit: "publicApi" });

    // The second token has its own three, but the account has five in all (three used so far:
    // a refused request does not count against the account).
    expect((await read(second.token, `/users/${ana.handle}`)).status).toBe(200);
    expect((await read(second.token, `/users/${ana.handle}`)).status).toBe(200);
    const over = await read(second.token, `/users/${ana.handle}`);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ limit: "publicApiAccount" });
  });

  it("answers browsers from any site and describes itself in an OpenAPI document", async () => {
    await start();
    const ana = await h.user("ana@example.com");
    const { token } = await makeToken(ana);
    const answer = await h.app.request(`${pub}/users/${ana.handle}`, {
      headers: { authorization: `Bearer ${token}`, origin: "https://tools.example" },
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    const preflight = await h.app.request(`${pub}/users/${ana.handle}`, {
      method: "OPTIONS",
      headers: { origin: "https://tools.example", "access-control-request-method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");

    const spec = await read(undefined, "/openapi.json");
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toMatch(/^3\.1/);
    const paths = Object.keys(spec.body.paths);
    for (const path of [
      "/token",
      "/users/{handle}",
      "/users/{handle}/library",
      "/users/{handle}/trophies",
      "/games/{titleId}",
      "/games/{titleId}/leaderboard",
      "/leaderboards/points",
      "/challenges",
      "/challenges/{id}",
    ])
      expect(paths).toContain(path);
    // Read only: no method but GET.
    for (const item of Object.values(spec.body.paths) as Record<string, unknown>[])
      expect(Object.keys(item).filter((key) => key !== "parameters")).toEqual(["get"]);
    // No write routes exist under /public either.
    expect((await h.call("POST", `${pub}/challenges`, {}, token)).status).toBe(404);
  });
});
