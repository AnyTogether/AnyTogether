import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";
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

  it("keep the same number of paragraphs, list items and rows in both languages", () => {
    for (const key of ["privacy", "terms"] as const) {
      const counts = (lang: "en" | "tr") =>
        legalStrings(lang)[key].sections.map((s) => s.blocks.map((b) => texts(b).length));
      expect(counts("tr")).toEqual(counts("en"));
    }
  });

  it("cover what the service does now", () => {
    const privacy = JSON.stringify(legalStrings("en").privacy);
    for (const feature of [
      "Recently played with",
      "Communities and events",
      "join code",
      "Appear offline",
      "private name",
      "private picture",
      "Discord link",
      "game session",
      "backed up every night",
      "14 days",
      "Google Fonts",
      "relay",
      "read receipts",
      "reactions",
      "unsend",
      "delivered",
      "public profile",
      "minimal card",
    ])
      expect(privacy).toContain(feature);
    const gizlilik = JSON.stringify(legalStrings("tr").privacy);
    for (const feature of [
      "Son oynadıkların",
      "Topluluklar ve etkinlikler",
      "katılma kod",
      "Çevrimdışı görün",
      "her gece yedeklenir",
      "okundu bilgisi",
      "tepki",
      "mesaj kaldırıldı",
      "iletildi",
      "herkese açık profil",
      "en sade kart",
    ])
      expect(gizlilik).toContain(feature);
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

describe("the web app manifest", () => {
  it("installs as a standalone app with any and maskable icons at 192 and 512", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.short_name).toBeTruthy();
    for (const purpose of ["any", "maskable"])
      for (const size of ["192x192", "512x512"])
        expect(m.icons?.some((icon) => icon.purpose === purpose && icon.sizes === size)).toBe(true);
  });
});
