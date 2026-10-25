"use client";

import { Arrow, ErrorScreen } from "@/components/site/ErrorScreen";
import { errorStrings, reportUrl } from "@/lib/i18n-errors";
import { useEffect, useState } from "react";

/** The language the visitor chose (the lang cookie, readable here), or the page's. */
function useLanguage() {
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    const chosen = /(?:^|;\s*)lang=(\w+)/.exec(document.cookie)?.[1];
    setLanguage(chosen ?? document.documentElement.lang ?? "en");
  }, []);
  return language;
}

/** What error.tsx and global-error.tsx show: try again, go home, report it with the error ID. */
export function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = errorStrings(useLanguage()).error;
  useEffect(() => {
    // The server logged its side with this ID already (instrumentation.ts); this is the browser's.
    console.error(error.digest ? `error ${error.digest}` : error);
  }, [error]);
  return (
    <ErrorScreen
      code="500"
      kicker={t.kicker}
      title={t.title}
      lead={t.lead}
      actions={
        <>
          <button type="button" className="cta primary" onClick={reset}>
            {t.retry}
          </button>
          {/* A full load, not a client navigation: whatever broke starts afresh. */}
          <a href="/" className="cta ghost">
            {t.home}
            <Arrow />
          </a>
          <a href={reportUrl} className="cta ghost" target="_blank" rel="noreferrer">
            {t.report}
          </a>
        </>
      }
      reference={{ label: t.reference, value: error.digest ?? null, none: t.noReference }}
    />
  );
}
