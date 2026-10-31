import { describe, expect, it } from "vitest";
import { siteStrings } from "../lib/i18n-site";
import { pageMetadata } from "../lib/product-page";

describe("the front page", () => {
  it("says the same things in English and Turkish about the launcher's newest", () => {
    const en = siteStrings("en").landing.launcher.cards;
    const tr = siteStrings("tr").landing.launcher.cards;
    expect(tr.map((card) => card.tag)).toEqual(en.map((card) => card.tag));
    for (const card of [...en, ...tr]) {
      expect(card.title.trim()).not.toBe("");
      expect(card.detail.length).toBeGreaterThan(40);
    }
    // What is not out yet says so.
    expect(en.find((card) => card.title === "Online play")?.tag).toBe("experimental");
    expect(en.find((card) => card.title === "Play together")?.tag).toBe("soon");
    expect(siteStrings("tr").soon).not.toBe(siteStrings("en").soon);
  });

  it("names its canonical address", () => {
    expect(pageMetadata("t", "d", "/").alternates?.canonical).toBe("/");
  });
});
