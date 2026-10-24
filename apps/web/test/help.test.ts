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
    expect(helpStrings("tr").trouble.items).toHaveLength(helpStrings("en").trouble.items.length);
  });
});
