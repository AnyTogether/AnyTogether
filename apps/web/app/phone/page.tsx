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
  // Android first: most people who use the phone controller are on Android. An iPhone visitor sees
  // their own phone first. The two buttons are the same width either way.
  const iphoneFirst = visitor === "iphone";
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
            short
          />
          <DownloadCta
            platform={iphoneFirst ? "android" : "iphone"}
            releases={releases}
            s={s}
            language={lang}
            direct
            quiet
            short
          />
        </>
      }
    />
  );
}
