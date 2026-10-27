import { platformIcons } from "@/components/site/Download";
import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { SpecFilter } from "@/components/site/SpecFilter";
import { wide } from "@/components/site/fonts";
import { type StatusCard, type StatusColumn, statusCards, statusColumns, updated } from "@/content/status";
import { type Releases, phoneVersion } from "@/lib/downloads";
import { type Language, language } from "@/lib/i18n";
import { type SpecsStrings, specsStrings } from "@/lib/i18n-specs";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { loadReleases } from "@/lib/site";
import {
  type Published,
  type Spec,
  type SpecPlatform,
  type SpecSection,
  checked,
  codedItems,
  countOf,
  credits,
  platformsOf,
  publishedVersions,
  repositories,
  searchable,
  sections,
  specPlatforms,
  stillNext,
  totalCount,
} from "@/lib/specs";
import Link from "next/link";
import type { ReactNode } from "react";
import "../specs.css";

export async function generateMetadata() {
  const t = specsStrings(await language());
  const base = pageMetadata(t.meta.title, t.meta.description, "/specs");
  // The sheet's own picture (opengraph-image.tsx beside this page), not the site-wide one.
  const image = { url: "/specs/opengraph-image", width: 1200, height: 630, alt: t.meta.title };
  return {
    ...base,
    openGraph: { ...base.openGraph, images: [image] },
    twitter: { ...base.twitter, images: [image] },
  };
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const gh = (repo: string) => `https://github.com/${repo}`;

/** The whole ecosystem, feature by feature: the engine, the Mac launcher, AnyPS5 Desktop, the
 *  phone app, AnyTogether and the rest, then the status board and the source. The features come
 *  from lib/specs.ts, the board from content/status.ts; the release list only decides which
 *  "next release" marks still stand and names the latest versions. */
export default async function Specs() {
  const lang = await language();
  const t = specsStrings(lang);
  const releases = await loadReleases();
  const published = publishedVersions({
    macos: releases?.macos?.version,
    desktop: releases?.desktop?.version,
  });
  const total = totalCount();
  const nav = [
    ...sections.map((section) => ({ id: section.id, label: t.sections[section.id].nav })),
    { id: "status", label: t.status.nav },
    { id: "source", label: t.source.nav },
  ];

  return (
    <div className={`site pg sp-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={t.kicker} title={t.title} lead={t.lead}>
        <div className="pg-links">
          <Link href="/download" className="text-link">
            {t.links.download}
            <Arrow />
          </Link>
          <Link href="/roadmap" className="text-link">
            {t.links.roadmap}
            <Arrow />
          </Link>
          <Link href="/changelog" className="text-link">
            {t.links.changelog}
            <Arrow />
          </Link>
        </div>
      </PageHead>

      <TitleBlock t={t} lang={lang} releases={releases} published={published} total={total} />

      <nav className="sp-strip" aria-label={t.onThisPage}>
        {sections.map((section, index) => (
          <a key={section.id} href={`#${section.id}`} className="sp-cell">
            <span className="sp-cell-code">{String(index + 1).padStart(2, "0")}</span>
            <b data-count={countOf(section)}>{countOf(section)}</b>
            <span className="sp-cell-name">{t.sections[section.id].nav}</span>
          </a>
        ))}
      </nav>

      <div className="sp-bar">
        <nav className="toc sp-toc" aria-label={t.onThisPage}>
          <span className="meta">{t.onThisPage}</span>
          <ul>
            {nav.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <SpecFilter
          t={t.filter}
          platforms={t.platforms}
          icons={
            Object.fromEntries(
              specPlatforms.map((p) => [
                p,
                <svg key={p} viewBox="0 0 24 24" aria-hidden="true" className="ico">
                  {platformIcons[p]()}
                </svg>,
              ]),
            ) as Record<SpecPlatform, ReactNode>
          }
          total={total}
          language={lang}
        />
      </div>

      <dl className="sp-legend">
        <div>
          <dt>
            <span className="sp-tag exp">{t.tags.exp}</span>
          </dt>
          <dd>{t.legend.exp}</dd>
        </div>
        <div>
          <dt>
            <span className="sp-tag next">{t.tags.next}</span>
          </dt>
          <dd>{t.legend.next}</dd>
        </div>
      </dl>

      {sections.map((section, index) => (
        <SectionSheet
          key={section.id}
          section={section}
          index={index}
          t={t}
          lang={lang}
          published={published}
        />
      ))}

      <StatusBoard t={t} lang={lang} published={published} />

      <SourceList t={t} lang={lang} releases={releases} />

      <p className="fine-note pg-foot-note">
        {fill(t.checkedOn, { date: day(checked, lang) })}{" "}
        <a href="https://github.com/AnyTogether/AnyTogether/issues/new">{t.suggest}</a>
      </p>
    </div>
  );
}

/** The sheet's title block, as on a technical drawing: what it is, when it was checked, and the
 *  versions it describes. */
function TitleBlock({
  t,
  lang,
  releases,
  published,
  total,
}: {
  t: SpecsStrings;
  lang: Language;
  releases: Releases | null;
  published: Published;
  total: number;
}) {
  const phone = phoneVersion(releases?.macos);
  const rows: [string, string][] = [
    [t.block.label, t.block.sheet],
    [t.block.rev, day(checked, lang)],
    [t.block.mac, `AnyPS5-ARM ${published.macos}`],
    [t.block.desktop, `AnyPS5 Desktop ${published.desktop}`],
    [t.block.phone, phone ? `AnyPS5 Remote ${phone}` : "AnyPS5 Remote"],
    [t.block.features, String(total)],
  ];
  return (
    <dl className="sp-block" aria-label={t.block.label}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Six fixed slots, one per platform, the ones a feature runs on lit: the same columns down the
 *  whole sheet, so they read like a matrix. */
function Platforms({ on, t }: { on: SpecPlatform[]; t: SpecsStrings }) {
  const names = specPlatforms.filter((p) => on.includes(p)).map((p) => t.platforms[p]);
  return (
    <span className="sp-plats" role="img" aria-label={`${t.runsOn}: ${names.join(", ")}`}>
      {specPlatforms.map((p) => (
        <svg
          key={p}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`ico${on.includes(p) ? " on" : ""}`}
          data-platform={p}
        >
          {platformIcons[p]()}
        </svg>
      ))}
    </span>
  );
}

function Tags({ item, t, published }: { item: Spec; t: SpecsStrings; published: Published }) {
  const next = stillNext(item.next, published) ? item.next : undefined;
  if (!item.exp && !next) return null;
  return (
    <span className="sp-tags">
      {item.exp && <span className="sp-tag exp">{t.tags.exp}</span>}
      {next && (
        <span className="sp-tag next">
          {next.on
            ? fill(t.tags.nextOn, { platforms: next.on.map((p) => t.platforms[p]).join(", ") })
            : t.tags.next}
        </span>
      )}
    </span>
  );
}

function SectionSheet({
  section,
  index,
  t,
  lang,
  published,
}: {
  section: SpecSection;
  index: number;
  t: SpecsStrings;
  lang: Language;
  published: Published;
}) {
  const s = t.sections[section.id];
  const all = section.groups.flatMap((g) => g.items);
  const experimental = all.filter((item) => item.exp).length;
  const upcoming = all.filter((item) => stillNext(item.next, published)).length;
  return (
    <section id={section.id} className="sp-sec" aria-labelledby={`${section.id}-title`} data-spec-section>
      <header className="sp-head" data-reveal>
        <span className="sp-num" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="sp-head-text">
          <p className="kicker">{s.kicker}</p>
          <h2 className="h-card" id={`${section.id}-title`}>
            {s.title}
          </h2>
          <p className="s-lead">{s.lead}</p>
        </div>
        <dl className="sp-head-meta">
          <div>
            <dt>{t.stats.features}</dt>
            <dd>{all.length}</dd>
          </div>
          {experimental > 0 && (
            <div>
              <dt>{t.stats.exp}</dt>
              <dd>{experimental}</dd>
            </div>
          )}
          {upcoming > 0 && (
            <div>
              <dt>{t.stats.next}</dt>
              <dd>{upcoming}</dd>
            </div>
          )}
          <div className="sp-head-plats">
            <dt>{t.runsOn}</dt>
            <dd>
              {platformsOf(section).map((p) => (
                <span key={p}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
                    {platformIcons[p]()}
                  </svg>
                  {t.platforms[p]}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </header>

      {codedItems(section).map(({ group, items }) => (
        <div key={group.id} className="sp-group" data-spec-group>
          <h3 className="sp-glabel">
            {group[lang]}
            <span>{items.length}</span>
          </h3>
          <ul className="sp-list">
            {items.map(({ item, code, anchor }) => {
              const [title, line] = item[lang];
              const words = [title, line, code, ...item.p.map((p) => t.platforms[p])];
              if (item.exp) words.push(t.tags.exp);
              if (stillNext(item.next, published)) words.push(t.tags.next);
              return (
                <li
                  key={anchor}
                  id={anchor}
                  className="sp-item"
                  data-spec
                  data-p={item.p.join(" ")}
                  data-q={searchable(words.join(" "), lang)}
                >
                  <div className="sp-item-top">
                    <a href={`#${anchor}`} className="sp-ref" aria-label={fill(t.permalink, { code })}>
                      {code}
                    </a>
                    <Platforms on={item.p} t={t} />
                  </div>
                  <h4 className="sp-name">
                    {title}
                    <Tags item={item} t={t} published={published} />
                  </h4>
                  <p className="sp-line">{line}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A card's column today: one that waits for a release moves to Done once that release is out. */
function placed(
  card: StatusCard,
  published: Published,
): { column: StatusColumn; release?: string; next: boolean } {
  if (card.ships) {
    const out = !stillNext({ project: card.ships.project, version: card.ships.version }, published);
    const name = card.ships.project === "macos" ? "AnyPS5-ARM" : "AnyPS5 Desktop";
    return out
      ? { column: "done", release: `${name} ${card.ships.version}`, next: false }
      : { column: card.column, release: undefined, next: true };
  }
  return { column: card.column, release: card.release, next: false };
}

function StatusBoard({ t, lang, published }: { t: SpecsStrings; lang: Language; published: Published }) {
  const cards = statusCards.map((card) => ({ card, ...placed(card, published) }));
  return (
    <section id="status" className="sp-sec sp-status" aria-labelledby="status-title">
      <header className="sp-head plain" data-reveal>
        <div className="sp-head-text">
          <p className="kicker">{t.status.kicker}</p>
          <h2 className="h-card" id="status-title">
            {t.status.title}
          </h2>
          <p className="s-lead">{t.status.lead}</p>
          <p className="sp-updated">
            {fill(t.status.updated, { date: day(updated, lang) })}{" "}
            <Link href="/roadmap" className="text-link">
              {t.status.roadmap}
              <Arrow />
            </Link>
          </p>
        </div>
      </header>
      <div className="sp-board">
        {statusColumns.map((column) => {
          const here = cards.filter((entry) => entry.column === column);
          // Done shows the newest first: a card that just moved over goes on top.
          if (column === "done") here.sort((a, b) => Number(!!b.card.ships) - Number(!!a.card.ships));
          return (
            <section key={column} className={`sp-col is-${column}`} aria-labelledby={`status-${column}`}>
              <header className="sp-col-head">
                <h3 id={`status-${column}`}>
                  <span className="sp-dot" aria-hidden="true" />
                  {t.status.columns[column][0]}
                  <span className="sp-col-n">{here.length}</span>
                </h3>
                <p>{t.status.columns[column][1]}</p>
              </header>
              <ul className="sp-cards">
                {here.map(({ card, release, next }) => (
                  <li key={card.id} id={`status-${card.id}`} className="sp-card">
                    <h4>{card[lang].t}</h4>
                    <p>{card[lang].d}</p>
                    <div className="sp-card-foot">
                      <Platforms on={card.platforms} t={t} />
                      {release && <span className="sp-release">{release}</span>}
                      {next && <span className="sp-tag next">{t.status.next}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function SourceList({ t, lang, releases }: { t: SpecsStrings; lang: Language; releases: Releases | null }) {
  return (
    <section id="source" className="sp-sec sp-source" aria-labelledby="source-title">
      <header className="sp-head plain" data-reveal>
        <div className="sp-head-text">
          <p className="kicker">{t.source.kicker}</p>
          <h2 className="h-card" id="source-title">
            {t.source.title}
          </h2>
          <p className="s-lead">{t.source.lead}</p>
          <Link href="/download" className="text-link">
            {t.source.downloads}
            <Arrow />
          </Link>
        </div>
      </header>

      <div className="sp-repos">
        {repositories.map((repo) => {
          const release = repo.project ? releases?.[repo.project] : null;
          return (
            <article key={repo.repo} className="sp-repo" aria-labelledby={`repo-${repo.name}`}>
              <header>
                <h3 id={`repo-${repo.name}`}>
                  <a href={gh(repo.repo)}>{repo.repo}</a>
                </h3>
                <span className="sp-license">{repo.license}</span>
              </header>
              <p className="sp-repo-lead">{repo[lang]}</p>
              <div className="sp-repo-release">
                <span className="pg-label">{t.source.latest}</span>
                {repo.project ? (
                  <a href={release?.url ?? `${gh(repo.repo)}/releases/latest`} className="sp-version">
                    {release ? release.version : t.source.releases}
                    {release?.publishedAt && (
                      <time dateTime={release.publishedAt}>{day(release.publishedAt, lang)}</time>
                    )}
                  </a>
                ) : (
                  <span className="sp-version muted">{t.source.noReleases}</span>
                )}
                {repo.project && (
                  <a href={`${gh(repo.repo)}/releases`} className="sp-small-link">
                    {t.source.releases}
                  </a>
                )}
              </div>
              <h4 className="pg-label">{t.source.branches}</h4>
              <dl className="sp-branches">
                {repo.branches.map((branch) => (
                  <div key={branch.name}>
                    <dt>
                      <a href={`${gh(repo.repo)}/tree/${branch.name}`}>
                        <code>{branch.name}</code>
                      </a>
                    </dt>
                    <dd>{branch[lang]}</dd>
                  </div>
                ))}
              </dl>
              {repo.merged && (
                <p className="sp-merged">
                  <span className="pg-label">{t.source.merged}</span>{" "}
                  {repo.merged.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ", "}
                      <code>{name}</code>
                    </span>
                  ))}
                </p>
              )}
            </article>
          );
        })}
      </div>

      <h3 className="pg-label sp-credits-title">{t.source.credits}</h3>
      <ul className="sp-credits">
        {credits.map((credit) => (
          <li key={credit.name}>
            <a href={credit.href}>{credit.name}</a>
            <p>{credit[lang]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
