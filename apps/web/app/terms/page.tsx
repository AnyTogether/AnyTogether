import { LegalPage } from "@/components/site/LegalPage";
import { language } from "@/lib/i18n";
import { legalStrings } from "@/lib/i18n-legal";
import { pageMetadata } from "@/lib/product-page";
import { siteOrigin } from "@/lib/site";

export async function generateMetadata() {
  const { meta } = legalStrings(await language()).terms;
  return pageMetadata(meta.title, meta.description, "/terms");
}

/** The rules for using AnyTogether: the account, behaviour, moderation, storage and what is promised. */
export default async function Terms() {
  const lang = await language();
  return <LegalPage doc={legalStrings(lang).terms} language={lang} origin={await siteOrigin()} />;
}
