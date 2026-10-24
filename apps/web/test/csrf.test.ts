import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

describe("changes from other sites", () => {
  const request = (path: string, method: string, headers: Record<string, string>) =>
    new NextRequest(`https://together.example.org${path}`, {
      method,
      headers: { host: "together.example.org", ...headers },
    });

  it("refuses a state-changing request another site's page sent, even a sibling subdomain", async () => {
    const { middleware } = await import("@/middleware");
    for (const [path, method] of [
      ["/auth/link", "POST"],
      ["/auth/logout", "POST"],
      ["/me/profile", "PATCH"],
      ["/me", "DELETE"],
      ["/me/avatar", "PUT"],
    ] as const) {
      const sameSite = await middleware(
        request(path, method, { "sec-fetch-site": "same-site", origin: "https://staging.example.org" }),
      );
      expect(sameSite.status, `${method} ${path}`).toBe(403);
      const crossSite = await middleware(request(path, method, { origin: "https://evil.example" }));
      expect(crossSite.status, `${method} ${path}`).toBe(403);
    }
  });

  it("lets this site's own pages, and plain navigations, through", async () => {
    const { middleware } = await import("@/middleware");
    const own = await middleware(
      request("/auth/link", "POST", {
        "sec-fetch-site": "same-origin",
        origin: "https://together.example.org",
      }),
    );
    expect(own.status).not.toBe(403);
    const noHeaders = await middleware(request("/auth/link", "POST", {}));
    expect(noHeaders.status).not.toBe(403);
    const link = await middleware(request("/u/kral", "GET", { "sec-fetch-site": "cross-site" }));
    expect(link.status).not.toBe(403);
  });
});
