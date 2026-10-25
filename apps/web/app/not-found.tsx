import { Arrow, ErrorScreen } from "@/components/site/ErrorScreen";
import { language } from "@/lib/i18n";
import { errorStrings } from "@/lib/i18n-errors";
import Link from "next/link";

export const metadata = { title: "Not found · AnyTogether", robots: { index: false } };

export default async function NotFound() {
  const t = errorStrings(await language()).notFound;
  return (
    <ErrorScreen
      code="404"
      kicker={t.kicker}
      title={t.title}
      lead={t.lead}
      actions={
        <>
          <Link href="/" className="cta primary">
            {t.home}
            <Arrow />
          </Link>
          <Link href="/help" className="cta ghost">
            {t.help}
          </Link>
        </>
      }
    />
  );
}
