import { describe, expect, it } from "vitest";
import { languages } from "../lib/i18n";
import { productStrings } from "../lib/i18n-products";
import { siteStrings } from "../lib/i18n-site";

/** Every string in a nested object, with where it sits ("landing.film.lead"). */
function texts(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => texts(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

/** The writing rules of AGENTS.md, for the public pages (the front page, the header and footer, and
 *  the product pages), so the patterns a tester flagged do not creep back. */
describe("the public pages' copy", () => {
  for (const language of languages) {
    const all = [...texts(siteStrings(language), "site"), ...texts(productStrings(language), "products")];

    it(`has no semicolons and no "·" fragments (${language})`, () => {
      // A page title's " · AnyTogether" suffix is the one exception.
      const bad = all.filter(
        ([path, text]) => text.includes(";") || (text.includes(" · ") && !path.endsWith("meta.title")),
      );
      expect(bad).toEqual([]);
    });

    it(`ends every card description and lead with a full stop (${language})`, () => {
      const p = productStrings(language);
      const pages = [p.mac, p.pc, p.phone, p.together];
      const endings = pages.flatMap((page) => [
        page.lead,
        ...page.chapters.flatMap((c) => [c.lead, ...c.items.map((i) => i.d)]),
      ]);
      expect(endings.filter((text) => !/[.!?]$/.test(text))).toEqual([]);
    });

    it(`fills the three-column grids evenly (${language})`, () => {
      const p = productStrings(language);
      for (const page of [p.mac, p.pc, p.phone, p.together])
        for (const chapter of page.chapters)
          expect(chapter.items.length % 3, `${chapter.id}: ${chapter.items.length} items`).toBe(0);
      expect(siteStrings(language).landing.launcher.cards.length % 3).toBe(0);
    });
  }

  it("says kontrolcü and çevrimiçi in Turkish", () => {
    const all = [...texts(siteStrings("tr")), ...texts(productStrings("tr"))];
    const bad = all.filter(([, text]) => /çevrim (içi|dışı)|\bkumanda/i.test(text));
    expect(bad).toEqual([]);
  });
});
