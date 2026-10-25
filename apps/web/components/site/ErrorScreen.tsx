import { wide } from "@/components/site/fonts";
import type { ReactNode } from "react";

/** The not-found and error pages on the Cosmic night: the code large and quiet behind the title,
 *  a kicker, a two-line title, the lead, what to do next, and (for a server error) the ID the log
 *  line carries. Plain markup, so the server's not-found page and the client's error pages share
 *  it. */
export function ErrorScreen({
  code,
  kicker,
  title,
  lead,
  actions,
  reference,
}: {
  code: string;
  kicker: string;
  title: readonly [string, string];
  lead: string;
  actions: ReactNode;
  reference?: { label: string; value: string | null; none: string };
}) {
  return (
    <div className={`site pg err-page ${wide.variable}`}>
      <section className="pg-hero err-hero">
        <span className="err-code" aria-hidden="true">
          {code}
        </span>
        <p className="kicker in d1">
          <span className="err-dot" aria-hidden="true" />
          {kicker}
        </p>
        <h1 className="pg-title in d2">
          {title[0]}
          <br />
          <span className="ink-soft">{title[1]}</span>
        </h1>
        <p className="p-lead in d3">{lead}</p>
        <div className="cta-row in d3">{actions}</div>
        {reference && (
          <p className="err-ref in d4">
            {reference.value ? (
              <>
                <span className="pg-label">{reference.label}</span>
                <code>{reference.value}</code>
              </>
            ) : (
              <span className="err-none">{reference.none}</span>
            )}
          </p>
        )}
      </section>
    </div>
  );
}

/** The arrow the site's links end with. */
export const Arrow = () => (
  <svg className="ico arrow" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
