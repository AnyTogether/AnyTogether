import { DownloadCta } from "@/components/site/Download";
import { ProductPage } from "@/components/site/ProductPage";
import { language } from "@/lib/i18n";
import { productStrings } from "@/lib/i18n-products";
import { siteStrings } from "@/lib/i18n-site";
import { productMetadata } from "@/lib/product-page";
import { loadReleases, visitorPlatform } from "@/lib/site";

export const generateMetadata = () => productMetadata("pc");

/** AnyPS5 Desktop, the Windows and Linux launcher, and everything it does. */
export default async function Pc() {
  const lang = await language();
  const [releases, visitor] = await Promise.all([loadReleases(), visitorPlatform()]);
  const s = siteStrings(lang);
  const p = productStrings(lang);
  const linuxFirst = visitor === "linux";
  return (
    <ProductPage
      page={p.pc}
      which="pc"
      p={p}
      s={s}
      cta={
        <>
          <DownloadCta
            platform={linuxFirst ? "linux" : "windows"}
            releases={releases}
            s={s}
            language={lang}
          />
          <DownloadCta
            platform={linuxFirst ? "windows" : "linux"}
            releases={releases}
            s={s}
            language={lang}
            quiet
          />
        </>
      }
    />
  );
}
