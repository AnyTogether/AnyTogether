import { DownloadCta } from "@/components/site/Download";
import { ProductPage } from "@/components/site/ProductPage";
import { language } from "@/lib/i18n";
import { productStrings } from "@/lib/i18n-products";
import { siteStrings } from "@/lib/i18n-site";
import { productMetadata } from "@/lib/product-page";
import { loadReleases } from "@/lib/site";
import Link from "next/link";

export const generateMetadata = () => productMetadata("mac");

/** AnyPS5-ARM, the Mac launcher, and everything it does. */
export default async function Mac() {
  const lang = await language();
  const [releases, s, p] = [await loadReleases(), siteStrings(lang), productStrings(lang)];
  return (
    <ProductPage
      page={p.mac}
      which="mac"
      p={p}
      s={s}
      cta={
        <>
          <DownloadCta platform="mac" releases={releases} s={s} language={lang} />
          <Link href="/download" className="cta ghost">
            {s.allPlatforms}
          </Link>
        </>
      }
    />
  );
}
