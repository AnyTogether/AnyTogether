import { statusCards, statusColumns, updated } from "@/content/status";
import { specsStrings } from "@/lib/i18n-specs";
import {
  codedItems,
  isNewer,
  publishedVersions,
  repositories,
  searchable,
  sections,
  specPlatforms,
  stillNext,
  totalCount,
} from "@/lib/specs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { lang: "en" as "en" | "tr" };
vi.mock("@/lib/i18n", async (original) => ({
  ...(await original<typeof import("@/lib/i18n")>()),
  language: async () => state.lang,
}));
vi.mock("@/lib/site", () => ({ loadReleases: async () => null }));
vi.mock("next/font/google", () => ({ Archivo: () => ({ variable: "font-wide" }) }));

const version = /^\d+\.\d+\.\d+$/;

describe("the specs data", () => {
  it("has every feature in both languages, with known platforms and unique codes", () => {
    const anchors = sections.flatMap((section) =>
      codedItems(section).flatMap((g) => g.items.map((i) => i.anchor)),
    );
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors.length).toBe(totalCount());
    expect(totalCount()).toBeGreaterThan(150);
    for (const section of sections) {
      const groups = section.groups.map((g) => g.id);
      expect(new Set(groups).size).toBe(groups.length);
      for (const group of section.groups) {
        expect(group.en.trim()).not.toBe("");
        expect(group.tr.trim()).not.toBe("");
        expect(group.items.length).toBeGreaterThan(0);
        for (const item of group.items) {
          for (const text of [...item.en, ...item.tr]) expect(text.trim()).not.toBe("");
          expect(item.p.length).toBeGreaterThan(0);
          for (const p of item.p) expect(specPlatforms).toContain(p);
          if (item.next) expect(item.next.version).toMatch(version);
        }
      }
    }
  });

  it("drops a next-release mark once that version is published", () => {
    expect(isNewer("0.2.24", "0.2.23")).toBe(true);
    expect(isNewer("0.2.23", "0.2.23")).toBe(false);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    const published = publishedVersions({ macos: "0.2.23", desktop: null });
    expect(stillNext({ project: "macos", version: "0.2.23" }, published)).toBe(false);
    expect(stillNext({ project: "macos", version: "0.2.24" }, published)).toBe(true);
    // An unreachable or stale release list never moves the sheet backwards.
    expect(publishedVersions({ macos: "0.1.0" }).macos).toBe(published.macos);
  });

  it("searches without minding case, accents or the dotless i", () => {
    expect(searchable("Çözünürlük KUPALAR", "tr")).toBe("cozunurluk kupalar");
    expect(searchable("İNDİR ışık", "tr")).toBe("indir isik");
  });

  it("keeps the status board in one shape: known columns, both languages, unique ids", () => {
    const ids = statusCards.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Number.isNaN(Date.parse(updated))).toBe(false);
    for (const column of statusColumns) expect(statusCards.some((card) => card.column === column)).toBe(true);
    for (const card of statusCards) {
      expect(statusColumns).toContain(card.column);
      for (const text of [card.en.t, card.en.d, card.tr.t, card.tr.d]) expect(text.trim()).not.toBe("");
      for (const p of card.platforms) expect(specPlatforms).toContain(p);
      if (card.column === "done") expect(card.release ?? card.ships).toBeTruthy();
      if (card.ships) expect(card.ships.version).toMatch(version);
    }
  });
});

// The first render imports the whole page cold, which can take a while on a busy machine.
describe("the specs page", { timeout: 30_000 }, () => {
  beforeEach(() => {
    state.lang = "en";
  });

  const render = async () => {
    const { default: Specs } = await import("@/app/specs/page");
    return renderToStaticMarkup(await Specs());
  };

  it("renders every section with an anchor the section nav points at", async () => {
    const html = await render();
    const ids = [...sections.map((s) => s.id), "status", "source"];
    for (const id of ids) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html.match(/ data-spec="true"/g)?.length).toBe(totalCount());
    expect(html).toContain(specsStrings("en").title[0]);
    for (const card of statusCards) expect(html).toContain(`id="status-${card.id}"`);
    for (const repo of repositories) expect(html).toContain(`https://github.com/${repo.repo}`);
  });

  it("links only to anchors on the page, site paths or https addresses", async () => {
    const html = await render();
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));
    expect(hrefs.length).toBeGreaterThan(totalCount());
    for (const href of hrefs) {
      if (href.startsWith("#")) {
        expect(html).toContain(`id="${href.slice(1)}"`);
      } else if (href.startsWith("/")) {
        expect(href).toMatch(/^\/[a-z0-9/#?=&_-]*$/i);
      } else {
        const url = new URL(href);
        expect(url.protocol).toBe("https:");
        if (url.hostname === "github.com") expect(url.pathname.split("/").length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is in Turkish when the visitor chose Turkish", async () => {
    state.lang = "tr";
    const html = await render();
    const t = specsStrings("tr");
    expect(html).toContain(t.title[0]);
    expect(html).toContain(t.status.columns.planned[0]);
    expect(html).toContain(sections[0]?.groups[0]?.items[0]?.tr[0] ?? "a Turkish feature title");
  });
});
