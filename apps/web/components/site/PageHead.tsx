import type { ReactNode } from "react";

/** The top of the reference pages (downloads, changelog, roadmap, projects, help): a kicker, a
 *  two-line title, the lead and whatever the page puts under it. */
export function PageHead({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: readonly [string, string] | string[];
  lead: string;
  children?: ReactNode;
}) {
  return (
    <section className="pg-hero">
      <p className="kicker in d1">{kicker}</p>
      <h1 className="pg-title in d2">
        {title[0]}
        <br />
        <span className="ink-soft">{title[1]}</span>
      </h1>
      <p className="p-lead in d3">{lead}</p>
      {children && <div className="pg-hero-more in d3">{children}</div>}
    </section>
  );
}

/** A day in the reader's language, the same on the server and in the browser (UTC). */
export function day(iso: string, language: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
