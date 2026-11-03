import { beforeEach, describe, expect, it, vi } from "vitest";

/** The browser's cookies as the route handlers see them. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));
vi.mock("@/lib/i18n", () => ({ language: async () => "tr" }));

/** The API: what it was asked, and what it answers next. */
const asked: { path: string; body: unknown }[] = [];
let answer: () => Response = () => new Response("{}", { status: 500 });
vi.mock("@/lib/session", () => ({
  accessCookie: "at_access",
  refreshCookie: "at_refresh",
  steamCookie: "at_steam",
  cookieOptions: (maxAge: number) => ({ maxAge }),
  goTo: (path: string) => new Response(null, { status: 303, headers: { location: path } }),
  keepAppealToken: async () => {},
  api: async (path: string, init: RequestInit = {}) => {
    asked.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer();
  },
}));

const steamUrl = "https://steamcommunity.com/openid/login?openid.mode=checkid_setup";
const state = "s".repeat(32);
const callback = (query: Record<string, string>) =>
  new Request(`https://anytogether.test/auth/steam/callback?${new URLSearchParams(query)}`);
const steamQuery = {
  state,
  "openid.mode": "id_res",
  "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000042",
  "openid.sig": "c2ln",
};

beforeEach(() => {
  jar.clear();
  asked.length = 0;
});

describe("Sign in with Steam on the website", () => {
  it("starts at Steam with the API's state kept in this browser, and only a path on this site after", async () => {
    const { GET } = await import("@/app/auth/steam/start/route");
    answer = () => Response.json({ url: steamUrl, state, expiresIn: 600 });
    const response = await GET(new Request("https://anytogether.test/auth/steam/start?next=//evil.example"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(steamUrl);
    expect(JSON.parse(jar.get("at_steam") ?? "{}")).toEqual({ state, next: "/" });

    // Anything but Steam's own page is not followed.
    jar.clear();
    answer = () => Response.json({ url: "https://evil.example/openid/login?x=1", state });
    const elsewhere = await GET(new Request("https://anytogether.test/auth/steam/start"));
    expect(elsewhere.headers.get("location")).toBe("/login?error=steam");
    expect(jar.has("at_steam")).toBe(false);
  });

  it("finishes only in the browser that started, with the same state", async () => {
    const { GET } = await import("@/app/auth/steam/callback/route");
    answer = () => Response.json({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    // No trip started here (a link someone else sent).
    expect((await GET(callback(steamQuery))).headers.get("location")).toBe("/login?error=steam");
    // Another state than the one kept.
    jar.set("at_steam", JSON.stringify({ state: "t".repeat(32), next: "/" }));
    expect((await GET(callback(steamQuery))).headers.get("location")).toBe("/login?error=steam");
    expect(asked).toEqual([]);
    expect(jar.has("at_access")).toBe(false);
  });

  it("signs in with the API's answer and goes where the sign-in started", async () => {
    const { GET } = await import("@/app/auth/steam/callback/route");
    answer = () => Response.json({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    jar.set("at_steam", JSON.stringify({ state, next: "/friends" }));
    const response = await GET(callback({ ...steamQuery, other: "x" }));
    expect(response.headers.get("location")).toBe("/friends");
    expect(asked).toEqual([
      {
        path: "/auth/steam/finish",
        body: {
          state,
          // Only Steam's openid.* answer goes on.
          params: {
            "openid.mode": "id_res",
            "openid.claimed_id": steamQuery["openid.claimed_id"],
            "openid.sig": "c2ln",
          },
          deviceName: "Browser",
          lang: "tr",
        },
      },
    ]);
    expect(jar.get("at_access")).toBe("a");
    expect(jar.get("at_refresh")).toBe("r");
    // The trip's cookie is spent.
    expect(jar.has("at_steam")).toBe(false);
  });

  it("says when no account has the Steam account linked, and goes back quietly on cancel", async () => {
    const { GET } = await import("@/app/auth/steam/callback/route");
    answer = () => Response.json({ code: "steam_not_linked" }, { status: 404 });
    jar.set("at_steam", JSON.stringify({ state, next: "/" }));
    expect((await GET(callback(steamQuery))).headers.get("location")).toBe("/login?error=steam_unlinked");
    expect(jar.has("at_access")).toBe(false);

    jar.set("at_steam", JSON.stringify({ state, next: "/" }));
    const cancelled = await GET(callback({ state, "openid.mode": "cancel" }));
    expect(cancelled.headers.get("location")).toBe("/login");
    expect(jar.has("at_steam")).toBe(false);
  });
});
