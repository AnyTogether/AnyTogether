import { describe, expect, it } from "vitest";
import { helpStrings } from "../lib/i18n-help";
import { inlineParts, plainText } from "../lib/inline";

describe("texts with links", () => {
  it("split into text and links, site paths and https only", () => {
    expect(inlineParts("See [the list](/compatibility) or [GitHub](https://github.com/x).")).toEqual([
      "See ",
      { text: "the list", href: "/compatibility" },
      " or ",
      { text: "GitHub", href: "https://github.com/x" },
      ".",
    ]);
    expect(inlineParts("[bad](javascript:alert(1)) [http](http://x.example)")).toEqual([
      "[bad](javascript:alert(1)) [http](http://x.example)",
    ]);
    expect(plainText("a [b](/c) d")).toBe("a b d");
  });
});

describe("the help page", () => {
  it("has the same questions, in the same order, in English and Turkish", () => {
    const ids = (lang: "en" | "tr") => helpStrings(lang).faq.items.map((item) => item.id);
    expect(ids("tr")).toEqual(ids("en"));
    expect(new Set(ids("en")).size).toBe(ids("en").length);
    const fixes = (lang: "en" | "tr") => helpStrings(lang).trouble.items.map((item) => item.id);
    expect(fixes("tr")).toEqual(fixes("en"));
    // Every question and fix opens from its own address (/help#fix-linux), so no id twice.
    expect(new Set([...ids("en"), ...fixes("en")]).size).toBe(ids("en").length + fixes("en").length);
  });
});

describe("the help page's install cards", () => {
  it("keep to three short steps and one needs line per platform, in both languages", () => {
    for (const lang of ["en", "tr"] as const) {
      const cards = helpStrings(lang).install.platforms;
      expect(Object.keys(cards).sort()).toEqual(["android", "iphone", "linux", "mac", "windows"]);
      for (const card of Object.values(cards)) {
        expect(card.steps.length).toBeLessThanOrEqual(3);
        for (const text of [...card.steps, card.needs]) {
          expect(text.length).toBeLessThanOrEqual(90);
          expect(text.endsWith(".")).toBe(true);
        }
      }
    }
  });
});
