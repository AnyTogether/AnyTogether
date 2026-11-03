import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const steamId = "76561198000000042";
const steamLogin = "https://steamcommunity.com/openid/login";

/** Steam as the tests see it: check_authentication says yes unless told otherwise. */
function fakeSteam() {
  const asked: { url: string; body: string }[] = [];
  let valid = true;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, body: String(init?.body ?? "") });
    if (url === steamLogin) return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const refuse = () => {
    valid = false;
  };
  return { asked, fetcher, refuse };
}

/** What Steam sends back for a return address, claiming `id`. */
const steamAnswer = (returnTo: string, id = steamId, overrides: Record<string, string> = {}) => ({
  "openid.ns": "http://specs.openid.net/auth/2.0",
  "openid.mode": "id_res",
  "openid.op_endpoint": steamLogin,
  "openid.claimed_id": `https://steamcommunity.com/openid/id/${id}`,
  "openid.identity": `https://steamcommunity.com/openid/id/${id}`,
  "openid.return_to": returnTo,
  "openid.response_nonce": "2026-11-03T10:00:00Zabc",
  "openid.assoc_handle": "1234567890",
  "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
  "openid.sig": "c2lnbmF0dXJl",
  ...overrides,
});

/** A started Sign in with Steam: its state and the return address Steam must answer for. */
async function start() {
  const started = await h.call("POST", `${v1}/auth/steam/start`, {});
  expect(started.status).toBe(200);
  const url = new URL(started.body.url);
  const returnTo = url.searchParams.get("openid.return_to") as string;
  return { state: started.body.state as string, url, returnTo };
}

/** Links Steam to the account, as Settings does. */
async function link(token: string) {
  const started = await h.call("POST", `${v1}/me/connections/steam/start`, {}, token);
  const returnTo = new URL(started.body.url).searchParams.get("openid.return_to") as string;
  const state = new URL(returnTo).searchParams.get("state") as string;
  const linked = await h.call(
    "POST",
    `${v1}/me/connections/steam/finish`,
    { state, params: steamAnswer(returnTo) },
    token,
  );
  expect(linked.status).toBe(201);
}

describe("Sign in with Steam", () => {
  it("is offered, and starts at Steam's OpenID page coming back to the website", async () => {
    h = await harness({ steam: { fetch: fakeSteam().fetcher } });
    expect((await h.call("GET", `${v1}/auth/providers`)).body.steam).toBe(true);
    const { state, url, returnTo } = await start();
    expect(url.origin + url.pathname).toBe(steamLogin);
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.realm")).toBe("https://anytogether.test");
    expect(returnTo).toBe(`https://anytogether.test/auth/steam/callback?state=${state}`);
  });

  it("signs in the account that has the Steam account linked, once per state", async () => {
    const steam = fakeSteam();
    h = await harness({ steam: { fetch: steam.fetcher } });
    const utku = await h.user("utku@example.com");
    await link(utku.token);

    const { state, returnTo } = await start();
    const signedIn = await h.call("POST", `${v1}/auth/steam/finish`, {
      state,
      params: steamAnswer(returnTo),
      deviceName: "Browser",
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.id).toBe(utku.id);
    expect(signedIn.body.user.created).toBe(false);
    const me = await h.call("GET", `${v1}/me`, undefined, signedIn.body.accessToken);
    expect(me.body.account.id).toBe(utku.id);
    // Steam itself was asked, at its own address, with check_authentication.
    const check = steam.asked.filter((a) => a.url === steamLogin).at(-1);
    expect(new URLSearchParams(check?.body).get("openid.mode")).toBe("check_authentication");
    expect(new URLSearchParams(check?.body).get("openid.sig")).toBe("c2lnbmF0dXJl");

    // The same answer again: the state is spent.
    const again = await h.call("POST", `${v1}/auth/steam/finish`, { state, params: steamAnswer(returnTo) });
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("provider_rejected");
  });

  it("makes no account for a SteamID nobody has linked", async () => {
    h = await harness({ steam: { fetch: fakeSteam().fetcher } });
    await h.user("utku@example.com");
    const { state, returnTo } = await start();
    const answer = await h.call("POST", `${v1}/auth/steam/finish`, { state, params: steamAnswer(returnTo) });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe("steam_not_linked");
    expect(answer.body.accessToken).toBeUndefined();
  });

  it("turns away an answer Steam does not confirm, or one made for another sign-in", async () => {
    const steam = fakeSteam();
    h = await harness({ steam: { fetch: steam.fetcher } });
    const utku = await h.user("utku@example.com");
    await link(utku.token);

    // An answer for another state's return address (or a made-up state).
    const first = await start();
    const second = await start();
    const crossed = await h.call("POST", `${v1}/auth/steam/finish`, {
      state: second.state,
      params: steamAnswer(first.returnTo),
    });
    expect(crossed.body.code).toBe("provider_rejected");
    const madeUp = await h.call("POST", `${v1}/auth/steam/finish`, {
      state: "a".repeat(32),
      params: steamAnswer(first.returnTo.replace(first.state, "a".repeat(32))),
    });
    expect(madeUp.body.code).toBe("provider_rejected");

    // Claiming another SteamID than the one signed, or a field left unsigned.
    const unsigned = await start();
    const notSigned = await h.call("POST", `${v1}/auth/steam/finish`, {
      state: unsigned.state,
      params: steamAnswer(unsigned.returnTo, steamId, { "openid.signed": "signed,op_endpoint,return_to" }),
    });
    expect(notSigned.body.code).toBe("provider_rejected");
    const otherEndpoint = await start();
    const forged = await h.call("POST", `${v1}/auth/steam/finish`, {
      state: otherEndpoint.state,
      params: steamAnswer(otherEndpoint.returnTo, steamId, {
        "openid.op_endpoint": "https://evil.example/openid/login",
      }),
    });
    expect(forged.body.code).toBe("provider_rejected");

    // Steam says the signature is not its own.
    steam.refuse();
    const refused = await start();
    const answer = await h.call("POST", `${v1}/auth/steam/finish`, {
      state: refused.state,
      params: steamAnswer(refused.returnTo),
    });
    expect(answer.status).toBe(401);
    expect(answer.body.code).toBe("provider_rejected");
    // Nothing was ever sent anywhere but Steam (the forged endpoint never asked).
    expect(steam.asked.every((a) => a.url.startsWith("https://steamcommunity.com/"))).toBe(true);
  });
});
