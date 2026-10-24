import { describe, expect, it } from "vitest";

describe("security headers", () => {
  it("forbids framing the site and sends the usual protections", async () => {
    const { default: config } = await import("../next.config.mjs");
    const rules = await config.headers();
    const all = rules.find((rule: { source: string }) => rule.source === "/:path*");
    const headers = Object.fromEntries(
      (all?.headers ?? []).map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]),
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
