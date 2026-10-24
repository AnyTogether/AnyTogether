import { sitemapFor } from "@/lib/seo";
import { siteOrigin } from "@/lib/site";

/** The public pages, at the address the site was reached by (a self-hosted one too). */
export default async function sitemap() {
  return sitemapFor(await siteOrigin());
}
