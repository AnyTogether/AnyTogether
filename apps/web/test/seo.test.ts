import { describe, expect, it } from "vitest";
import { privatePaths, publicPages, robotsFor, sitemapFor } from "../lib/seo";

describe("search engines", () => {
  it("get every public page in the sitemap, at the site's own address", () => {
    const urls = sitemapFor("https://together.example").map((entry) => entry.url);
    expect(urls[0]).toBe("https://together.example");
    for (const path of ["/download", "/changelog", "/roadmap", "/projects", "/help"])
      expect(urls).toContain(`https://together.example${path}`);
    expect(new Set(urls).size).toBe(publicPages.length);
  });

  it("are kept out of signed-in pages and the API, and told where the sitemap is", () => {
    const robots = robotsFor("https://together.example");
    expect(robots.sitemap).toBe("https://together.example/sitemap.xml");
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    expect(rules?.disallow).toEqual(privatePaths);
    for (const page of publicPages) expect(privatePaths.some((p) => page.path.startsWith(p))).toBe(false);
  });
});
