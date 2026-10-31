import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import { language } from "@/lib/i18n";
import { type RoadmapStrings, roadmapStrings } from "@/lib/i18n-roadmap";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { type RoadmapItem, itemsOf, planDocs, statuses, updated } from "@/lib/roadmap";
import Link from "next/link";

export async function generateMetadata() {
  const r = roadmapStrings(await language());
  return pageMetadata(r.meta.title, r.meta.description, "/roadmap");
}

/** The public roadmap, from lib/roadmap.ts: done, in progress, next and later. */
export default async function Roadmap() {
  const lang = await language();
  const r = roadmapStrings(lang);
  return (
    <div className={`site pg rm-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={r.kicker} title={r.title} lead={r.lead}>
        <div className="pg-links">
          <a href={planDocs[lang]} className="text-link">
            {r.plan}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <Link href="/changelog" className="text-link">
            {r.changelog}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <Link href="/specs#status" className="text-link">
            {r.status}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </PageHead>

      <nav className="rm-strip" aria-label={r.kicker}>
        {statuses.map((status) => (
          <a key={status} href={`#${status}`} className={`rm-count is-${status}`}>
            <b>{itemsOf(status).length}</b>
            <span>{r.statuses[status][0]}</span>
          </a>
        ))}
      </nav>

      <div className="rm-board">
        {statuses.map((status) => (
          <section
            key={status}
            id={status}
            className={`rm-col is-${status}`}
            aria-labelledby={`${status}-title`}
          >
            <header className="rm-col-head">
              <h2 id={`${status}-title`}>
                <span className="rm-dot" aria-hidden="true" />
                {r.statuses[status][0]}
                <span className="rm-n">{itemsOf(status).length}</span>
              </h2>
              <p>{r.statuses[status][1]}</p>
            </header>
            <RoadmapItems
              items={itemsOf(status)}
              lang={lang}
              areas={r.areas}
              more={status === "done" ? r.more : null}
            />
          </section>
        ))}
      </div>

      <p className="fine-note pg-foot-note">
        {fill(r.updated, { date: day(updated, lang) })}{" "}
        <a href="https://github.com/AnyTogether/AnyTogether/issues/new">{r.suggest}</a>
      </p>
    </div>
  );
}

/** How many done items show before the rest folds away: the list only grows. */
const shownDone = 6;

/** A column's items. The done column shows its first few and folds the rest under a button that
 *  opens them (a details element: no script, and the browser opens it for a link to an item). */
function RoadmapItems({
  items,
  lang,
  areas,
  more,
}: {
  items: RoadmapItem[];
  lang: "en" | "tr";
  areas: RoadmapStrings["areas"];
  more: RoadmapStrings["more"] | null;
}) {
  const card = (item: RoadmapItem) => (
    <li key={item.id} id={item.id} className="rm-item" data-reveal>
      <h3>{item[lang].t}</h3>
      <p>{item[lang].d}</p>
      <div className="rm-tags">
        {item.shipped?.split(" · ").map((release) => (
          <span key={release} className="rm-shipped">
            {release}
          </span>
        ))}
        {item.areas.map((area) => (
          <span key={area} className={`rm-area ${area}`}>
            {areas[area]}
          </span>
        ))}
      </div>
    </li>
  );
  if (!more || items.length <= shownDone + 2) return <ul className="rm-items">{items.map(card)}</ul>;
  const rest = items.slice(shownDone);
  return (
    <>
      <ul className="rm-items">{items.slice(0, shownDone).map(card)}</ul>
      <details className="rm-more">
        <summary>
          <span className="rm-more-open">{fill(more.open, { n: rest.length })}</span>
          <span className="rm-more-close">{more.close}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <ul className="rm-items">{rest.map(card)}</ul>
      </details>
    </>
  );
}
