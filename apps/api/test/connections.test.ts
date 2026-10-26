import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const steamId = "76561198000000042";
const returnTo = (state: string) => `https://anytogether.test/connections/steam/callback?state=${state}`;

/** Steam as the tests see it: check_authentication says yes unless told otherwise, the Web API
 *  knows one persona. */
function fakeSteam(valid = true) {
  const asked: { url: string; body: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, body: String(init?.body ?? "") });
    if (url === "https://steamcommunity.com/openid/login")
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
    if (url.startsWith("https://api.steampowered.com/"))
      return Response.json({ response: { players: [{ personaname: "KralUtku" }] } });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

/** Discord as the tests see it: the code "good" gives a token for one user. */
function fakeDiscord() {
  const asked: { url: string; body: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    asked.push({ url, body });
    if (url === "https://discord.com/api/oauth2/token")
      return new URLSearchParams(body).get("code") === "good"
        ? Response.json({ access_token: "tok-123", token_type: "Bearer" })
        : new Response("{}", { status: 400 });
    if (url === "https://discord.com/api/users/@me")
      return Response.json({ id: "80351110224678912", username: "utku.k", global_name: "Utku" });
    if (url === "https://discord.com/api/oauth2/token/revoke") return new Response("{}");
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

/** What Steam sends back to the redirect page for this state. */
const steamAnswer = (state: string, overrides: Record<string, string> = {}) => ({
  "openid.ns": "http://specs.openid.net/auth/2.0",
  "openid.mode": "id_res",
  "openid.op_endpoint": "https://steamcommunity.com/openid/login",
  "openid.claimed_id": `https://steamcommunity.com/openid/id/${steamId}`,
  "openid.identity": `https://steamcommunity.com/openid/id/${steamId}`,
  "openid.return_to": returnTo(state),
  "openid.response_nonce": "2026-10-25T10:00:00Zabc",
  "openid.assoc_handle": "1234567890",
  "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
  "openid.sig": "c2lnbmF0dXJl",
  ...overrides,
});

describe("Steam", () => {
  it("links with OpenID 2.0, shows a badge, hides and unlinks", async () => {
    const steam = fakeSteam();
    h = await harness({ publicProfiles: true, steam: { apiKey: "test-key", fetch: steam.fetcher } });
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");

    const start = await h.call("POST", `${v1}/me/connections/steam/start`, {}, utku.token);
    expect(start.status).toBe(200);
    const url = new URL(start.body.url);
    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.realm")).toBe("https://anytogether.test");
    const back = new URL(url.searchParams.get("openid.return_to") as string);
    expect(back.origin + back.pathname).toBe("https://anytogether.test/connections/steam/callback");
    const state = back.searchParams.get("state") as string;

    // Not this account's state.
    expect(
      (
        await h.call(
          "POST",
          `${v1}/me/connections/steam/finish`,
          { state, params: steamAnswer(state) },
          ayse.token,
        )
      ).body.code,
    ).toBe("connection_failed");
    // That spent it: the owner starts again.
    const again = await h.call("POST", `${v1}/me/connections/steam/start`, {}, utku.token);
    const fresh = new URL(
      new URL(again.body.url).searchParams.get("openid.return_to") as string,
    ).searchParams.get("state") as string;
    const linked = await h.call(
      "POST",
      `${v1}/me/connections/steam/finish`,
      { state: fresh, params: steamAnswer(fresh) },
      utku.token,
    );
    expect(linked.status).toBe(201);
    expect(linked.body.connection).toMatchObject({
      provider: "steam",
      externalId: steamId,
      name: "KralUtku",
      url: `https://steamcommunity.com/profiles/${steamId}`,
      hidden: false,
    });
    // Steam itself was asked to confirm, with every parameter and check_authentication.
    const check = steam.asked.find((a) => a.url === "https://steamcommunity.com/openid/login");
    expect(new URLSearchParams(check?.body).get("openid.mode")).toBe("check_authentication");
    expect(new URLSearchParams(check?.body).get("openid.sig")).toBe("c2lnbmF0dXJl");
    // A state works once.
    expect(
      (
        await h.call(
          "POST",
          `${v1}/me/connections/steam/finish`,
          { state: fresh, params: steamAnswer(fresh) },
          utku.token,
        )
      ).body.code,
    ).toBe("connection_failed");

    const badge = {
      provider: "steam",
      name: "KralUtku",
      username: null,
      url: `https://steamcommunity.com/profiles/${steamId}`,
    };
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.connections).toEqual([
      badge,
    ]);
    const signedOut = await h.app.request(`${v1}/users/utku`);
    expect((await signedOut.json()).connections).toEqual([badge]);

    expect(
      (await h.call("PATCH", `${v1}/me/connections/steam`, { hidden: true }, utku.token)).body.connection
        .hidden,
    ).toBe(true);
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).body.connections).toEqual([]);
    const mine = await h.call("GET", `${v1}/me/connections`, undefined, utku.token);
    expect(mine.body.connections).toHaveLength(1);
    expect(mine.body.available).toEqual({ steam: true, discord: true });

    // The same Steam account cannot be linked to a second AnyTogether account.
    const theirs = await h.call("POST", `${v1}/me/connections/steam/start`, {}, ayse.token);
    const theirState = new URL(
      new URL(theirs.body.url).searchParams.get("openid.return_to") as string,
    ).searchParams.get("state") as string;
    const taken = await h.call(
      "POST",
      `${v1}/me/connections/steam/finish`,
      { state: theirState, params: steamAnswer(theirState) },
      ayse.token,
    );
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("connection_taken");

    expect((await h.call("DELETE", `${v1}/me/connections/steam`, undefined, utku.token)).status).toBe(204);
    expect((await h.call("GET", `${v1}/me/connections`, undefined, utku.token)).body.connections).toEqual([]);
  });

  it("refuses answers that were not asked for or that Steam does not confirm", async () => {
    const steam = fakeSteam();
    h = await harness({ steam: { fetch: steam.fetcher } });
    const utku = await h.user("utku@example.com");
    const tryWith = async (overrides: Record<string, string>) => {
      const start = await h.call("POST", `${v1}/me/connections/steam/start`, {}, utku.token);
      const state = new URL(
        new URL(start.body.url).searchParams.get("openid.return_to") as string,
      ).searchParams.get("state") as string;
      return h.call(
        "POST",
        `${v1}/me/connections/steam/finish`,
        { state, params: steamAnswer(state, overrides) },
        utku.token,
      );
    };
    const answers: Record<string, string>[] = [
      { "openid.return_to": "https://evil.example/connections/steam/callback?state=x" },
      { "openid.op_endpoint": "https://evil.example/openid/login" },
      { "openid.claimed_id": "https://evil.example/openid/id/76561198000000042" },
      { "openid.identity": "https://steamcommunity.com/openid/id/76561198000000099" },
      { "openid.mode": "cancel" },
      { "openid.signed": "op_endpoint,claimed_id,identity" },
    ];
    for (const bad of answers) {
      const refused = await tryWith(bad);
      expect(refused.status, JSON.stringify(bad)).toBe(400);
      expect(refused.body.code).toBe("connection_failed");
    }
    // No Steam call was made for any of those.
    expect(steam.asked).toEqual([]);

    await h.close();
    const doubting = fakeSteam(false);
    h = await harness({ steam: { fetch: doubting.fetcher } });
    const ayse = await h.user("ayse@example.com");
    const start = await h.call("POST", `${v1}/me/connections/steam/start`, {}, ayse.token);
    const state = new URL(
      new URL(start.body.url).searchParams.get("openid.return_to") as string,
    ).searchParams.get("state") as string;
    const refused = await h.call(
      "POST",
      `${v1}/me/connections/steam/finish`,
      { state, params: steamAnswer(state) },
      ayse.token,
    );
    expect(refused.body.code).toBe("connection_failed");
  });
});

describe("Discord", () => {
  it("links with the code flow and PKCE, keeps no token, and is off without the secret", async () => {
    const discord = fakeDiscord();
    h = await harness({
      providers: {
        google: { clientIds: [], keys: async () => new Uint8Array() as never },
        apple: { clientIds: [], keys: async () => new Uint8Array() as never },
        discord: { clientId: "discord-client", clientSecret: "discord-secret", fetch: discord.fetcher },
      },
    });
    // The website offers "Sign in with Discord" from this.
    expect((await h.call("GET", `${v1}/auth/providers`)).body).toEqual({
      discord: { clientId: "discord-client" },
      google: false,
      apple: false,
    });
    const utku = await h.user("utku@example.com");
    const start = await h.call("POST", `${v1}/me/connections/discord/start`, {}, utku.token);
    const url = new URL(start.body.url);
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "discord-client",
      scope: "identify",
      redirect_uri: "https://anytogether.test/connections/discord/callback",
      code_challenge_method: "S256",
    });
    const state = url.searchParams.get("state") as string;
    const challenge = url.searchParams.get("code_challenge") as string;

    const bad = await h.call(
      "POST",
      `${v1}/me/connections/discord/finish`,
      { state, code: "nope" },
      utku.token,
    );
    expect(bad.body.code).toBe("connection_failed");
    const restart = await h.call("POST", `${v1}/me/connections/discord/start`, {}, utku.token);
    const next = new URL(restart.body.url).searchParams.get("state") as string;
    const linked = await h.call(
      "POST",
      `${v1}/me/connections/discord/finish`,
      { state: next, code: "good" },
      utku.token,
    );
    expect(linked.status).toBe(201);
    expect(linked.body.connection).toMatchObject({
      provider: "discord",
      externalId: "80351110224678912",
      name: "Utku",
      username: "utku.k",
      url: "https://discord.com/users/80351110224678912",
    });
    // The verifier matched its challenge, the secret went only to Discord, the token was revoked.
    const exchange = discord.asked.filter((a) => a.url === "https://discord.com/api/oauth2/token").at(-1);
    const sent = new URLSearchParams(exchange?.body);
    expect(sent.get("redirect_uri")).toBe("https://anytogether.test/connections/discord/callback");
    expect(sent.get("client_secret")).toBe("discord-secret");
    expect(sent.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(sent.get("code_verifier"));
    expect(new URLSearchParams(discord.asked.at(-1)?.body).get("token")).toBe("tok-123");
    expect(discord.asked.at(-1)?.url).toBe("https://discord.com/api/oauth2/token/revoke");
    expect(JSON.stringify(linked.body)).not.toContain("tok-123");

    await h.close();
    h = await harness({
      providers: {
        google: { clientIds: [], keys: async () => new Uint8Array() as never },
        apple: { clientIds: [], keys: async () => new Uint8Array() as never },
        discord: { clientId: "discord-client", clientSecret: "", fetch: discord.fetcher },
      },
    });
    const ayse = await h.user("ayse@example.com");
    expect((await h.call("GET", `${v1}/me/connections`, undefined, ayse.token)).body.available).toEqual({
      steam: true,
      discord: false,
    });
    expect((await h.call("GET", `${v1}/auth/providers`)).body.discord).toBeNull();
    const off = await h.call("POST", `${v1}/me/connections/discord/start`, {}, ayse.token);
    expect(off.status).toBe(400);
    expect(off.body.code).toBe("provider_disabled");
    expect((await h.call("POST", `${v1}/me/connections/nope/start`, {}, ayse.token)).status).toBe(404);
  });
});
