import { describe, expect, it, vi } from "vitest";
import { type Notice, noticeHref } from "../lib/notify";

// The relay itself needs a request's cookies; these tests stop before it, or see that it was reached.
vi.mock("@/lib/session", () => ({
  relay: async (path: string) => Response.json({ relayed: path }),
  accessToken: async () => "token",
  api: async (path: string) =>
    new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "x-path": path } }),
}));

const notice = (kind: Notice["kind"], extra: Partial<Notice> = {}): Notice => ({
  id: "n",
  kind,
  actor: { userId: "u", handle: "ayse", displayName: "Ayşe", avatar: null },
  subjectId: "c1",
  data: {},
  read: false,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("notifications", () => {
  it("lead to what they are about", () => {
    expect(noticeHref(notice("message"))).toBe("/messages?c=c1");
    expect(noticeHref(notice("friend_request"))).toBe("/u/ayse");
    expect(noticeHref(notice("party_invite"))).toBe("/party");
    expect(noticeHref(notice("missed_call"))).toBe("/u/ayse");
    expect(noticeHref(notice("game_invite"))).toBeNull();
    expect(noticeHref(notice("warning", { actor: null }))).toBeNull();
    expect(noticeHref(notice("lfg_request"))).toBe("/find#mine");
    expect(noticeHref(notice("lfg_accepted", { data: { invite: { kind: "party", id: "p1" } } }))).toBe(
      "/party",
    );
    expect(noticeHref(notice("lfg_accepted", { data: { invite: { kind: "share_play", id: "s1" } } }))).toBe(
      "/watch/s1",
    );
  });
});

describe("the admin relay", () => {
  const call = async (path: string, method: string, headers: Record<string, string> = {}) => {
    const { GET, POST } = await import("@/app/me/admin/[...path]/route");
    const handler = method === "GET" ? GET : POST;
    return handler(
      new Request(`https://together.example.org/me/admin/${path}`, {
        method,
        headers: { host: "together.example.org", ...headers },
        ...(method === "GET" ? {} : { body: "{}" }),
      }),
      { params: Promise.resolve({ path: path.split("?")[0]?.split("/") ?? [] }) },
    );
  };

  it("passes only the admin API's own paths", async () => {
    for (const [path, method] of [
      ["admin/secrets", "GET"],
      ["admin/reports/not-an-id", "POST"],
      ["me", "GET"],
      ["admin/../me", "GET"],
      ["admin/users", "POST"],
    ] as const)
      expect((await call(path, method)).status, `${method} ${path}`).toBe(404);
  });

  it("passes the admin API's paths and only its own query parameters", async () => {
    const response = await call("admin/users?q=@troll&evil=1", "GET");
    expect(await response.json()).toEqual({ relayed: "/admin/users?q=%40troll" });
  });

  it("passes the theme queue, a theme's verdict, and its still as a picture", async () => {
    const id = "01a16f2a-418a-7309-8c03-ef0f6f73fb8a";
    expect(await (await call("admin/themes?status=hidden&before=x", "GET")).json()).toEqual({
      relayed: "/admin/themes?status=hidden",
    });
    expect(await (await call(`admin/themes/${id}`, "POST")).json()).toEqual({
      relayed: `/admin/themes/${id}`,
    });
    const still = await call(`admin/themes/${id}/thumb.webp`, "GET");
    expect(still.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await still.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect((await call(`admin/themes/${id}/thumb.webp`, "POST")).status).toBe(404);
    expect((await call("admin/themes/not-an-id/thumb.webp", "GET")).status).toBe(404);
  });

  it("refuses an admin action sent by another site's page", async () => {
    const id = "01a16f2a-418a-7309-8c03-ef0f6f73fb8a";
    const response = await call(`admin/bans/${id}/lift`, "POST", {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });
});

describe("the service worker", () => {
  it("is left alone by the middleware", async () => {
    const { config } = await import("@/middleware");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/sw.js")).toBe(false);
    expect(matcher.test("/notifications")).toBe(true);
  });
});
