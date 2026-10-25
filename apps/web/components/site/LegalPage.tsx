import { PageHead } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { Rich } from "@/components/site/Rich";
import { wide } from "@/components/site/fonts";
import type { Language } from "@/lib/i18n";
import { type LegalBlock, type LegalDoc, legalUpdated, officialOrigin } from "@/lib/i18n-legal";
import { fill } from "@/lib/people";
import Link from "next/link";

const two = (n: number) => String(n).padStart(2, "0");

/** The day the texts changed, in the reader's language ("25 October 2026", "25 Ekim 2026"). */
export function legalDate(language: Language) {
  return new Intl.DateTimeFormat(language === "tr" ? "tr-TR" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${legalUpdated}T12:00:00Z`));
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string")
    return (
      <p>
        <Rich text={block} />
      </p>
    );
  if ("list" in block)
    return (
      <ul className="lg-list">
        {block.list.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  if ("items" in block)
    return (
      <dl className="lg-items">
        {block.items.map(([term, text]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>
              <Rich text={text} />
            </dd>
          </div>
        ))}
      </dl>
    );
  const { head, rows } = block.table;
  return (
    <table className="lg-table">
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, what, how]) => (
          <tr key={name}>
            <th scope="row" data-label={head[0]}>
              <code>{name}</code>
            </th>
            <td data-label={head[1]}>{what}</td>
            <td data-label={head[2]}>{how}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The privacy notice or the terms: the date they last changed at the top, a note when this is
 *  someone else's AnyTogether server, the sections with a contents list beside them (above them on
 *  a phone), and the way to the other document. */
export function LegalPage({ doc, language, origin }: { doc: LegalDoc; language: Language; origin: string }) {
  const date = legalDate(language);
  const host = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  })();
  const elsewhere = origin.replace(/\/$/, "") !== officialOrigin;

  return (
    <div className={`site pg lg-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={doc.kicker} title={doc.title} lead={doc.lead}>
        <p className="lg-updated">
          <span className="lg-dot" aria-hidden="true" />
          <time dateTime={legalUpdated}>{fill(doc.updated, { date })}</time>
          <span className="lg-sep" aria-hidden="true">
            /
          </span>
          <Link href={doc.next.href}>{doc.next.label}</Link>
        </p>
      </PageHead>
      {elsewhere && (
        <p className="pg-notice lg-elsewhere" role="note">
          {fill(doc.otherServer, { host })}
        </p>
      )}

      <div className="lg-body">
        <nav className="toc lg-toc" aria-label={doc.tocLabel}>
          <span className="meta">{doc.tocLabel}</span>
          <ul>
            {doc.sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <span className="lg-n" aria-hidden="true">
                    {two(index + 1)}
                  </span>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="lg-doc">
          {doc.summary && (
            <section className="lg-summary" aria-labelledby="lg-summary">
              <h2 id="lg-summary">{doc.summary.title}</h2>
              <ul>
                {doc.summary.points.map((point) => (
                  <li key={point}>
                    <Rich text={point} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {doc.sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="lg-sec"
              aria-labelledby={`${section.id}-title`}
            >
              <h2 id={`${section.id}-title`}>
                <span className="lg-n" aria-hidden="true">
                  {two(index + 1)}
                </span>
                {section.title}
              </h2>
              <div className="lg-text">
                {section.blocks.map((block, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of one fixed text
                  <Block key={n} block={block} />
                ))}
              </div>
            </section>
          ))}
          <footer className="lg-end">
            <span className="pg-label">{fill(doc.updated, { date })}</span>
            <Link href={doc.next.href} className="lg-next">
              {doc.next.label}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </footer>
        </article>
      </div>
    </div>
  );
}
