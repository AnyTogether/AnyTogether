import type { Metadata } from "next";
import { language } from "./i18n";
import { productStrings } from "./i18n-products";

/** The picture shared links show (app/opengraph-image.jpg), named again where a page sets its own
 *  Open Graph texts, which would otherwise leave it out. */
const preview = { url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "AnyPS5 and AnyTogether" };

/** A page's title and description, for the browser and for shared links. */
export function pageMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: { siteName: "AnyTogether", type: "website", title, description, images: [preview] },
    twitter: { card: "summary_large_image", title, description, images: [preview] },
  };
}

/** The title and description of a product page, in the visitor's language. */
export async function productMetadata(key: "mac" | "pc" | "phone" | "together"): Promise<Metadata> {
  const page = productStrings(await language())[key];
  return pageMetadata(page.meta.title, page.meta.description);
}
