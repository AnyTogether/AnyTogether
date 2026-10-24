import { robotsFor } from "@/lib/seo";
import { siteOrigin } from "@/lib/site";

/** Search engines may read the public pages, never the signed-in ones or the API. */
export default async function robots() {
  return robotsFor(await siteOrigin());
}
