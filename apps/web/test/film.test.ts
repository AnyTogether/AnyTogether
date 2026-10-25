import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteStrings } from "../lib/i18n-site";

const media = new URL("../public/media/", import.meta.url);

describe("the AnyPS5 film", () => {
  it("has its files, and the music's licence beside them", () => {
    for (const name of [
      "anyps5-promo.webm",
      "anyps5-promo.mp4",
      "anyps5-promo-960.webp",
      "anyps5-promo-1920.webp",
    ])
      expect(existsSync(new URL(name, media)), name).toBe(true);
    const credits = readFileSync(new URL("CREDITS.md", media), "utf8");
    expect(credits).toContain("CC0 1.0 Universal");
    expect(credits).toContain("https://opengameart.org/content/calm-ambient-1-synthwave-4k");
  });

  it("is labelled in English and Turkish", () => {
    for (const language of ["en", "tr"] as const) {
      const film = siteStrings(language).landing.film;
      for (const text of Object.values(film)) expect(text.length).toBeGreaterThan(0);
    }
    expect(siteStrings("tr").landing.film.soundOn).not.toBe(siteStrings("en").landing.film.soundOn);
  });

  it("is streamed straight from the files, past the middleware", async () => {
    const { config } = await import("@/middleware");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/media/anyps5-promo.webm")).toBe(false);
    expect(matcher.test("/mac")).toBe(true);
  });
});
