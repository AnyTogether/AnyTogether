import { describe, expect, it, vi } from "vitest";
import { presenceEn, presenceTr } from "../lib/i18n-presence";
import { appearOfflineAfter } from "../lib/presenceMode";

const relayBody = vi.fn(async () => Response.json({ appearOffline: true }));
vi.mock("@/lib/session", () => ({ relayBody }));

describe("appear offline on the website", () => {
  it("passes the choice on to the API's PATCH /me/presence", async () => {
    const { PATCH } = await import("../app/me/presence/route");
    const request = new Request("https://anytogether.test/me/presence", {
      method: "PATCH",
      body: JSON.stringify({ appearOffline: true }),
    });
    const response = await PATCH(request);
    expect(relayBody).toHaveBeenCalledWith(request, "/me/presence", "PATCH");
    expect(await response.json()).toEqual({ appearOffline: true });
  });

  it("follows a change made on another device, and ignores anything else", () => {
    expect(appearOfflineAfter(false, { type: "presence.mode", data: { appearOffline: true } })).toBe(true);
    expect(appearOfflineAfter(true, { type: "presence.mode", data: { appearOffline: false } })).toBe(false);
    expect(appearOfflineAfter(true, { type: "presence.updated", data: { state: "online" } })).toBe(true);
    expect(appearOfflineAfter(false, { type: "presence.mode", data: { appearOffline: "yes" } })).toBe(false);
    expect(appearOfflineAfter(false, { type: "presence.mode", data: null })).toBe(false);
  });

  it("has every text in English and Turkish", () => {
    expect(Object.keys(presenceTr).sort()).toEqual(Object.keys(presenceEn).sort());
    for (const [key, text] of Object.entries(presenceEn)) {
      expect(text, key).not.toBe("");
      expect(presenceTr[key as keyof typeof presenceTr], key).not.toBe(text);
    }
    // One word each, as the switch's two sides.
    expect([presenceEn.presenceOnline, presenceEn.presenceAppearOffline]).toEqual(["Online", "Offline"]);
    expect([presenceTr.presenceOnline, presenceTr.presenceAppearOffline]).toEqual([
      "Çevrimiçi",
      "Çevrimdışı",
    ]);
  });
});
