import { describe, expect, it } from "vitest";
import { statusCards } from "../content/status";
import { languages } from "../lib/i18n";
import { changelogStrings } from "../lib/i18n-changelog";
import { downloadPageStrings } from "../lib/i18n-download";
import { helpStrings } from "../lib/i18n-help";
import { projectsStrings } from "../lib/i18n-projects";
import { specsStrings } from "../lib/i18n-specs";
import { roadmap } from "../lib/roadmap";

/** Every string in a nested object, with where it sits ("help.faq.items[0].a[1]"). */
function texts(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => texts(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k));
  return [];
}

/** The visible copy of the reference pages (downloads, projects, changelog, specs and its status
 *  board, help and the roadmap) in one language. */
function pageTexts(language: "en" | "tr"): [string, string][] {
  return [
    ...texts(downloadPageStrings(language), "download"),
    ...texts(projectsStrings(language), "projects"),
    ...texts(changelogStrings(language), "changelog"),
    ...texts(specsStrings(language), "specs"),
    ...texts(helpStrings(language), "help"),
    ...roadmap.flatMap((item) => texts(item[language], `roadmap.${item.id}`)),
    ...statusCards.flatMap((card) => texts(card[language], `status.${card.id}`)),
  ];
}

/** The writing rules of AGENTS.md, for the reference pages, so the patterns a tester flagged do
 *  not creep back. */
describe("the reference pages' copy", () => {
  for (const language of languages) {
    const all = pageTexts(language);

    it(`has no semicolons and no "·" fragments (${language})`, () => {
      // A page title's " · AnyTogether" suffix is the one exception.
      const bad = all.filter(
        ([path, text]) => text.includes(";") || (text.includes(" · ") && !path.endsWith("meta.title")),
      );
      expect(bad).toEqual([]);
    });

    it(`ends every roadmap and status card description with a full stop (${language})`, () => {
      const descriptions = [...roadmap, ...statusCards].map((item) => item[language].d);
      expect(descriptions.filter((text) => !text.endsWith("."))).toEqual([]);
    });
  }

  it("says kontrolcü and çevrimiçi in Turkish", () => {
    const bad = pageTexts("tr").filter(([, text]) => /çevrim (içi|dışı)|kumanda/i.test(text));
    expect(bad).toEqual([]);
  });
});
