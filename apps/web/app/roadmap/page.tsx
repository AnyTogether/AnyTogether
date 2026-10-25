import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import { language } from "@/lib/i18n";
import { roadmapStrings } from "@/lib/i18n-roadmap";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { itemsOf, planDocs, statuses, updated } from "@/lib/roadmap";
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
            <ul className="rm-items">
              {itemsOf(status).map((item) => (
                <li key={item.id} id={item.id} className="rm-item" data-reveal>
                  <h3>{item[lang].t}</h3>
                  <p>{item[lang].d}</p>
                  <div className="rm-tags">
                    {item.shipped && <span className="rm-shipped">{item.shipped}</span>}
                    {item.areas.map((area) => (
                      <span key={area} className={`rm-area ${area}`}>
                        {r.areas[area]}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="fine-note pg-foot-note">
        {fill(r.updated, { date: day(updated, lang) })}{" "}
        <a href="https://github.com/utkuhalis/AnyTogether/issues/new">{r.suggest}</a>
      </p>
    </div>
  );
}
