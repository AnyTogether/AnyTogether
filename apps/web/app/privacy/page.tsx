import { LegalPage } from "@/components/site/LegalPage";
import { language } from "@/lib/i18n";
import { legalStrings } from "@/lib/i18n-legal";
import { pageMetadata } from "@/lib/product-page";
import { siteOrigin } from "@/lib/site";

export async function generateMetadata() {
  const { meta } = legalStrings(await language()).privacy;
  return pageMetadata(meta.title, meta.description, "/privacy");
}

/** What AnyTogether keeps about people, who sees it, how long it stays, and how to take it away. */
export default async function Privacy() {
  const lang = await language();
  return <LegalPage doc={legalStrings(lang).privacy} language={lang} origin={await siteOrigin()} />;
}
