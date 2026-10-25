import type { Strings } from "@/lib/i18n";
import Link from "next/link";
import type { ReactNode } from "react";

/** A template with {terms} and {privacy} in it, the blanks turned into links to the two pages. */
function withLinks(template: string, links: Record<"terms" | "privacy", ReactNode>) {
  return template.split(/(\{terms\}|\{privacy\})/).map((part, index) => {
    if (part === "{terms}" || part === "{privacy}") {
      const key = part.slice(1, -1) as "terms" | "privacy";
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
      return <span key={index}>{links[key]}</span>;
    }
    return part;
  });
}

/** Under the sign-in choices: signing in (which makes the account the first time) accepts both. */
export function AgreeLine({ texts }: { texts: Strings }) {
  return (
    <p className="agree-line in d3">
      {withLinks(texts.agreeLine, {
        terms: <Link href="/terms">{texts.termsLink}</Link>,
        privacy: <Link href="/privacy">{texts.privacyLink}</Link>,
      })}
    </p>
  );
}

/** In Settings, under "Your data": where the privacy notice and the terms are. */
export function LegalLinks({ texts }: { texts: Strings }) {
  return (
    <p className="legal-links">
      {withLinks(texts.legalLinks, {
        terms: <Link href="/terms">{texts.termsOfUse}</Link>,
        privacy: <Link href="/privacy">{texts.privacyLink}</Link>,
      })}
    </p>
  );
}
