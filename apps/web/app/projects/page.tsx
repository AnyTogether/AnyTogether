import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import { language } from "@/lib/i18n";
import { type RepoCard, projectsStrings } from "@/lib/i18n-projects";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { type RepoStats, loadProjects, loadReleases } from "@/lib/site";
import { compact } from "@/lib/themes";
import Link from "next/link";

export async function generateMetadata() {
  const p = projectsStrings(await language());
  return pageMetadata(p.meta.title, p.meta.description, "/projects");
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Every repository of AnyPS5 and AnyTogether, the upstream engine, the licences and how to help,
 *  with GitHub's numbers from the API's cache. */
export default async function Projects() {
  const lang = await language();
  const p = projectsStrings(lang);
  const [stats, releases] = await Promise.all([loadProjects(), loadReleases()]);
  const upstream = stats?.["boykopovar/AnyPS5"] ?? null;
  const [creditBefore, creditAfter] = p.upstream.credits.split("{link}");

  return (
    <div className={`site pg pj-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={p.kicker} title={p.title} lead={p.lead} />
      {!stats && <p className="pg-notice">{p.down}</p>}

      <div className="pj-repos">
        {p.repos.map((card) => (
          <Repo
            key={card.repo}
            card={card}
            stats={stats?.[card.repo] ?? null}
            release={card.release ? (releases?.[card.release] ?? null) : null}
            p={p}
            lang={lang}
          />
        ))}
      </div>

      <section className="pg-sec pj-upstream pg-panel" data-reveal aria-labelledby="upstream-title">
        <div>
          <h2 className="h-card" id="upstream-title">
            {p.upstream.title}
          </h2>
          <p className="s-lead">{p.upstream.lead}</p>
          <p className="fine-note">
            {creditBefore}
            <a href="https://github.com/mugurc/AnyPS5/tree/macos-port">mugurc/AnyPS5 macos-port</a>
            {creditAfter}
          </p>
        </div>
        <div className="pj-upstream-side">
          <Numbers stats={upstream} p={p} lang={lang} />
          <div className="pj-links">
            <a href="https://github.com/boykopovar/AnyPS5" className="file-link">
              boykopovar/AnyPS5 <Arrow />
            </a>
            <a
              href="https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up"
              className="file-link"
            >
              {p.upstream.discussions} <Arrow />
            </a>
          </div>
        </div>
      </section>

      <section className="pg-sec" data-reveal aria-labelledby="licences-title">
        <h2 className="h-card" id="licences-title">
          {p.licences.title}
        </h2>
        <ul className="rules pj-licences">
          {p.licences.items.map(([t, d]) => (
            <li key={t}>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="pg-sec" id="contribute" data-reveal aria-labelledby="contribute-title">
        <h2 className="h-card" id="contribute-title">
          {p.contribute.title}
        </h2>
        <p className="s-lead">{p.contribute.lead}</p>
        <ul className="pj-help">
          {p.contribute.items.map(([t, d, href]) => (
            <li key={t}>
              {href.startsWith("/") ? (
                <Link href={href} className="pj-help-card">
                  <b>{t}</b>
                  <span>{d}</span>
                  <Arrow />
                </Link>
              ) : (
                <a href={href} className="pj-help-card">
                  <b>{t}</b>
                  <span>{d}</span>
                  <Arrow />
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Numbers({
  stats,
  p,
  lang,
}: { stats: RepoStats | null; p: ReturnType<typeof projectsStrings>; lang: string }) {
  // Numbers worth showing: a young repository's zeros say nothing.
  const shown = stats
    ? (
        [
          [stats.stars, p.stats.stars],
          [stats.forks, p.stats.forks],
          [stats.openIssues, p.stats.issues],
        ] as const
      ).filter(([n]) => n > 0)
    : [];
  if (!shown.length) return null;
  return (
    <dl className="pj-numbers">
      {shown.map(([n, label]) => (
        <div key={label}>
          <dt>{compact(n, lang)}</dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

function Repo({
  card,
  stats,
  release,
  p,
  lang,
}: {
  card: RepoCard;
  stats: RepoStats | null;
  release: { version: string; url: string; publishedAt: string } | null;
  p: ReturnType<typeof projectsStrings>;
  lang: string;
}) {
  const id = card.repo.split("/")[1]?.toLowerCase();
  return (
    <article className="pj-repo pg-panel" id={id} aria-labelledby={`${id}-title`} data-reveal>
      <header className="pj-repo-head">
        <div>
          <p className="pj-role">{card.role}</p>
          <h2 id={`${id}-title`}>
            <a href={`https://github.com/${card.repo}`}>{card.name}</a>
            <span className="pj-lic">{card.license}</span>
          </h2>
          <p className="pj-slug">github.com/{card.repo}</p>
        </div>
        <Numbers stats={stats} p={p} lang={lang} />
      </header>
      <p className="pj-lead">{card.lead}</p>
      <div className="pj-meta">
        {release && (
          <a href={release.url} className="release">
            <span className="dot" aria-hidden="true" />
            {fill(p.latest, { version: release.version })}
            <span className="release-more">{day(release.publishedAt, lang)}</span>
          </a>
        )}
        {stats?.pushedAt && (
          <span className="meta">{fill(p.stats.pushed, { date: day(stats.pushedAt, lang) })}</span>
        )}
      </div>
      <div className={`pj-body${card.branches ? " with-branches" : ""}`}>
        <div>
          <h3 className="pg-label">{p.inside}</h3>
          <dl className="reqs pj-parts">
            {card.parts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {card.branches && (
          <div>
            <h3 className="pg-label">{p.branches}</h3>
            <ul className="pj-branches">
              {card.branches.map(([branch, line]) => (
                <li key={branch}>
                  <a href={`https://github.com/${card.repo}/tree/${branch}`}>
                    <code>{branch}</code>
                  </a>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="pj-links">
        {card.links.map(([label, href]) => (
          <a key={href} href={href} className="file-link">
            {label} <Arrow />
          </a>
        ))}
      </div>
    </article>
  );
}
