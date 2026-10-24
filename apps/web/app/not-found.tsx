import { strings } from "@/lib/i18n";
import Link from "next/link";

export default async function NotFound() {
  const texts = await strings();
  return (
    <section className="narrow">
      <p className="eyebrow in d1">404</p>
      <h2 className="in d2" style={{ marginTop: 16 }}>
        {texts.notFoundTitle}
      </h2>
      <p className="lead in d3">{texts.notFoundLead}</p>
      <div className="in d4">
        <Link className="pill" style={{ marginTop: 24 }} href="/">
          {texts.home}
        </Link>
      </div>
    </section>
  );
}
