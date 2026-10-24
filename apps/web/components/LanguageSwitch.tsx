"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

type Props = { current: "en" | "tr"; label: string };

/** EN · TR: plain links, so it works without JavaScript too; the page comes back in the other language. */
export function LanguageSwitch(props: Props) {
  return (
    <Suspense fallback={<Links {...props} here={null} />}>
      <WithQuery {...props} />
    </Suspense>
  );
}

function WithQuery(props: Props) {
  const query = useSearchParams().toString();
  return <Links {...props} here={query} />;
}

function Links({ current, label, here }: Props & { here: string | null }) {
  const path = usePathname();
  const next = encodeURIComponent(here ? `${path}?${here}` : path);
  return (
    <nav className="langs" aria-label={label}>
      {(["en", "tr"] as const).map((language) => (
        <a
          key={language}
          href={`/lang?to=${language}&next=${next}`}
          lang={language}
          hrefLang={language}
          aria-current={language === current ? "true" : undefined}
        >
          {language.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
