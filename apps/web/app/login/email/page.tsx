import { MagicLink } from "@/components/MagicLink";
import { strings } from "@/lib/i18n";
import { Suspense } from "react";

export default async function EmailLink() {
  const texts = await strings();
  return (
    <section className="narrow">
      <h2 className="in d1">{texts.loginTitle}</h2>
      <div className="card in d2">
        <Suspense>
          <MagicLink checking={texts.checking} failed={texts.failed} />
        </Suspense>
      </div>
    </section>
  );
}
