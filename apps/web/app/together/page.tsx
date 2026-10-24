import { ProductPage } from "@/components/site/ProductPage";
import { language } from "@/lib/i18n";
import { productStrings } from "@/lib/i18n-products";
import { siteStrings } from "@/lib/i18n-site";
import { productMetadata } from "@/lib/product-page";
import { currentUser } from "@/lib/session";
import Link from "next/link";

export const generateMetadata = () => productMetadata("together");

/** AnyTogether itself: the online side of AnyPS5, and running your own. */
export default async function Together() {
  const lang = await language();
  const user = await currentUser();
  const s = siteStrings(lang);
  const p = productStrings(lang);
  return (
    <ProductPage
      page={p.together}
      which="together"
      p={p}
      s={s}
      cta={
        <>
          {user ? (
            <Link href="/" className="cta primary">
              <span className="cta-label">AnyTogether</span>
            </Link>
          ) : (
            <Link href="/login" className="cta primary">
              <span className="cta-label">{s.nav.createAccount}</span>
            </Link>
          )}
          <a href="https://github.com/utkuhalis/AnyTogether" className="cta ghost">
            GitHub
          </a>
        </>
      }
    />
  );
}
