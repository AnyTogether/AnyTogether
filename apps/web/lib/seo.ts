import type { MetadataRoute } from "next";

/** What search engines are pointed at: the public pages (no sign-in needed), and what they are
 *  kept out of. Pure, for app/sitemap.ts, app/robots.ts and the tests. */

export const publicPages: {
  path: string;
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly";
}[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/download", priority: 0.9, changeFrequency: "weekly" },
  { path: "/mac", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pc", priority: 0.8, changeFrequency: "monthly" },
  { path: "/phone", priority: 0.8, changeFrequency: "monthly" },
  { path: "/together", priority: 0.8, changeFrequency: "monthly" },
  { path: "/help", priority: 0.7, changeFrequency: "monthly" },
  { path: "/changelog", priority: 0.7, changeFrequency: "weekly" },
  { path: "/roadmap", priority: 0.6, changeFrequency: "weekly" },
  { path: "/projects", priority: 0.6, changeFrequency: "monthly" },
  { path: "/compatibility", priority: 0.7, changeFrequency: "daily" },
  { path: "/themes", priority: 0.6, changeFrequency: "daily" },
  { path: "/privacy", priority: 0.3, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "monthly" },
];

/** Signed-in pages, sign-in steps and the API: nothing for a search engine there. */
export const privatePaths = [
  "/api/",
  "/auth/",
  "/me/",
  "/admin",
  "/settings",
  "/messages",
  "/friends",
  "/party",
  "/notifications",
  "/link",
  "/login",
  "/watch/",
];

export function sitemapFor(origin: string, now = new Date()): MetadataRoute.Sitemap {
  return publicPages.map(({ path, priority, changeFrequency }) => ({
    url: `${origin}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}

export function robotsFor(origin: string): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: privatePaths }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
