import { describe, expect, it } from "vitest";
import { type LegalBlock, type LegalDoc, legalStrings, legalUiEn, legalUiTr } from "../lib/i18n-legal";
import { inlineParts } from "../lib/inline";
import { publicPages } from "../lib/seo";

const texts = (block: LegalBlock): string[] =>
  typeof block === "string"
    ? [block]
    : "list" in block
      ? block.list
      : "items" in block
        ? block.items.flat()
        : block.table.rows.flat();

const links = (doc: LegalDoc) =>
  [...(doc.summary?.points ?? []), ...doc.sections.flatMap((s) => s.blocks.flatMap(texts))]
    .flatMap(inlineParts)
    .filter((part) => typeof part !== "string")
    .map((part) => (part as { href: string }).href);

describe("the privacy notice and the terms", () => {
  it("have the same sections, in the same order, in English and Turkish", () => {
    for (const key of ["privacy", "terms"] as const) {
      const ids = (lang: "en" | "tr") => legalStrings(lang)[key].sections.map((s) => s.id);
      expect(ids("tr")).toEqual(ids("en"));
      expect(new Set(ids("en")).size).toBe(ids("en").length);
      const shapes = (lang: "en" | "tr") =>
        legalStrings(lang)[key].sections.map((s) =>
          s.blocks.map((b) => (typeof b === "string" ? "p" : Object.keys(b)[0])),
        );
      expect(shapes("tr")).toEqual(shapes("en"));
    }
  });

  it("link only to this site, https pages and their own sections", () => {
    for (const lang of ["en", "tr"] as const)
      for (const doc of Object.values(legalStrings(lang))) {
        const ids = new Set(doc.sections.map((s) => s.id));
        for (const href of links(doc)) {
          if (href.startsWith("#")) expect(ids.has(href.slice(1))).toBe(true);
          else expect(href).toMatch(/^(\/|https:\/\/)/);
        }
      }
  });

  it("put no server address, provider or contact address in the text", () => {
    const all = JSON.stringify([legalStrings("en"), legalStrings("tr")]);
    expect(all).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(all).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(all).not.toMatch(/\b(hetzner|cloudflare|resend|aws|digitalocean|vultr|ovh)\b/i);
  });

  it("are public pages, and the sign-in line names both", () => {
    const paths = publicPages.map((p) => p.path);
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
    for (const ui of [legalUiEn, legalUiTr]) {
      expect(ui.agreeLine).toContain("{terms}");
      expect(ui.agreeLine).toContain("{privacy}");
      expect(ui.installIos).toContain("{share}");
    }
  });
});

describe("texts with links", () => {
  it("take #anchors on the same page as links", () => {
    expect(inlineParts("See [below](#contact).")).toEqual(["See ", { text: "below", href: "#contact" }, "."]);
    expect(inlineParts("[x](#a b)")).toEqual(["[x](#a b)"]);
  });
});
