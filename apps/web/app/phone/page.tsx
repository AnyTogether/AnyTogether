import { DownloadCta } from "@/components/site/Download";
import { ProductPage } from "@/components/site/ProductPage";
import { language } from "@/lib/i18n";
import { productStrings } from "@/lib/i18n-products";
import { siteStrings } from "@/lib/i18n-site";
import { productMetadata } from "@/lib/product-page";
import { loadReleases, visitorPlatform } from "@/lib/site";

export const generateMetadata = () => productMetadata("phone");

/** AnyPS5 Remote, the phone controller, and everything it does. */
export default async function Phone() {
  const lang = await language();
  const [releases, visitor] = await Promise.all([loadReleases(), visitorPlatform()]);
  const s = siteStrings(lang);
  const p = productStrings(lang);
  const iphoneFirst = visitor === "iphone" || visitor === "mac";
  return (
    <ProductPage
      page={p.phone}
      which="phone"
      p={p}
      s={s}
      cta={
        <>
          <DownloadCta
            platform={iphoneFirst ? "iphone" : "android"}
            releases={releases}
            s={s}
            language={lang}
            direct
          />
          <DownloadCta
            platform={iphoneFirst ? "android" : "iphone"}
            releases={releases}
            s={s}
            language={lang}
            direct
            quiet
          />
        </>
      }
    />
  );
}
