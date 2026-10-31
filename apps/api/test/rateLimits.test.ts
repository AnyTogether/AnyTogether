import { afterEach, describe, expect, it } from "vitest";
import { defaultLimits } from "../src/ratelimit.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";

describe("settings rate limits", () => {
  it("lets the cheap switches flip many times, far more than the old shared limit of 30", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    for (let i = 0; i < 40; i++) {
      const flipped = await h.call("PATCH", `${v1}/me/presence`, { appearOffline: i % 2 === 0 }, utku.token);
      expect(flipped.status, `flip ${i + 1}`).toBe(200);
    }
    expect(defaultLimits.setting.max).toBeGreaterThanOrEqual(150);
    // Sign-in stays strict.
    expect(defaultLimits.signIn.max).toBeLessThanOrEqual(30);
  });

  it("counts each setting on its own: one used up locks nothing else", async () => {
    h = await harness({ limits: { setting: { max: 3, seconds: 3600 }, profile: { max: 3, seconds: 3600 } } });
    const utku = await h.user("utku@example.com");
    const appear = (appearOffline: boolean) =>
      h.call("PATCH", `${v1}/me/presence`, { appearOffline }, utku.token);
    for (const value of [true, false, true]) expect((await appear(value)).status).toBe(200);

    const limited = await appear(false);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
    // How long to wait, in the header and in the body (the website's relay keeps only the body).
    const wait = Number(limited.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
    expect(limited.body.retryAfter).toBe(wait);

    // Every other setting, and the profile itself, still change.
    expect(
      (await h.call("PATCH", `${v1}/me/read-receipts`, { readReceipts: false }, utku.token)).status,
    ).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/privacy`, { library: "nobody" }, utku.token)).status).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/look`, { accent: "mint" }, utku.token)).status).toBe(200);
    expect(
      (await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: true }, utku.token)).status,
    ).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/discovery`, { discoverable: false }, utku.token)).status).toBe(
      200,
    );
    expect(
      (await h.call("PATCH", `${v1}/me/notifications/settings`, { digest: false }, utku.token)).status,
    ).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/players-met`, { remember: true }, utku.token)).status).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/profile`, { bio: "hello" }, utku.token)).status).toBe(200);

    // Someone else's switches are theirs alone.
    const ayse = await h.user("ayse@example.com");
    expect((await h.call("PATCH", `${v1}/me/presence`, { appearOffline: true }, ayse.token)).status).toBe(
      200,
    );
  });

  it("counts a look change once, not twice", async () => {
    h = await harness({ limits: { setting: { max: 4, seconds: 3600 } } });
    const utku = await h.user("utku@example.com");
    const accents = ["blue", "mint", "coral", "violet"];
    for (const accent of accents)
      expect((await h.call("PATCH", `${v1}/me/look`, { accent }, utku.token)).status, accent).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/look`, { accent: "gold" }, utku.token)).status).toBe(429);
  });

  it("keeps name and bio changes on their own limit", async () => {
    h = await harness({ limits: { profile: { max: 2, seconds: 3600 } } });
    const utku = await h.user("utku@example.com");
    const bio = (text: string) => h.call("PATCH", `${v1}/me/profile`, { bio: text }, utku.token);
    expect((await bio("one")).status).toBe(200);
    expect((await bio("two")).status).toBe(200);
    expect((await bio("three")).status).toBe(429);
    // The switches are not touched by it.
    expect((await h.call("PATCH", `${v1}/me/presence`, { appearOffline: true }, utku.token)).status).toBe(
      200,
    );
  });
});
