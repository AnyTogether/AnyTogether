import { DownloadIcon } from "@/components/site/Download";
import { Notes } from "@/components/site/Notes";
import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { changelogEntries, pickProject, projects } from "@/lib/changelog";
import { repos } from "@/lib/downloads";
import { language } from "@/lib/i18n";
import { changelogStrings } from "@/lib/i18n-changelog";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { loadHistory } from "@/lib/site";
import { fileSize } from "@/lib/themes";
import Link from "next/link";

export async function generateMetadata() {
  const c = changelogStrings(await language());
  return pageMetadata(c.meta.title, c.meta.description, "/changelog");
}

/** The newest releases open; older ones fold away under their version. */
const openFirst = 3;

/** Both projects' release notes from GitHub, newest first, rendered from Markdown to sanitised
 *  HTML, each with its files. */
export default async function Changelog({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await language();
  const c = changelogStrings(lang);
  const only = pickProject((await searchParams).project);
  const history = await loadHistory();
  const entries = changelogEntries(history, only);
  const repoOf = { macos: repos.mac, desktop: repos.desktop } as const;
  const [before, after] = c.current.split("{link}");

  return (
    <div className="site pg cl-page">
      <Reveal />
      <PageHead kicker={c.kicker} title={c.title} lead={c.lead}>
        {c.englishOnly && <p className="fine-note">{c.englishOnly}</p>}
      </PageHead>

      <nav className="cl-filter" aria-label={c.filter}>
        <span className="pg-label">{c.filter}</span>
        <ul>
          <li>
            <Link href="/changelog" className="cl-chip" aria-current={only ? undefined : "page"}>
              {c.all}
            </Link>
          </li>
          {projects.map((project) => (
            <li key={project}>
              <Link
                href={`/changelog?project=${project}`}
                className="cl-chip"
                aria-current={only === project ? "page" : undefined}
              >
                {c.projects[project][0]}
                <span className="meta">{c.projects[project][1]}</span>
              </Link>
            </li>
          ))}
        </ul>
        {entries.length > 0 && <span className="meta cl-count">{fill(c.count, { n: entries.length })}</span>}
      </nav>

      {!history?.macos && !history?.desktop && (
        <p className="pg-notice">
          {c.down} <a href={`https://github.com/${repos.mac}/releases`}>AnyPS5-ARM</a> ·{" "}
          <a href={`https://github.com/${repos.desktop}/releases`}>AnyPS5-Desktop</a>
        </p>
      )}
      {history && entries.length === 0 && <p className="pg-muted cl-none">{c.none}</p>}

      <ol className="cl-list">
        {entries.map((entry, index) => {
          const { release, project } = entry;
          const notes = release.notes?.trim() ?? "";
          return (
            <li
              key={entry.anchor}
              id={entry.anchor}
              className={`cl-entry${index < openFirst ? "" : " folded"}`}
              data-reveal={index > 1 ? "" : undefined}
            >
              <div className="cl-side">
                <time dateTime={release.publishedAt} className="cl-date">
                  {day(release.publishedAt, lang)}
                </time>
                <span className={`cl-project ${project}`}>{c.projects[project][0]}</span>
              </div>
              <article className="cl-body" aria-labelledby={`${entry.anchor}-title`}>
                <header className="cl-head">
                  <h2 id={`${entry.anchor}-title`}>
                    <a href={`#${entry.anchor}`} className="cl-version">
                      {release.version}
                    </a>
                  </h2>
                  {entry.latest && <span className="chip-tag preview">{c.latest}</span>}
                  {release.prerelease && <span className="chip-tag">{c.prerelease}</span>}
                  <span className="cl-name">
                    {release.name && release.name !== release.tag ? release.name : ""}
                  </span>
                </header>
                {notes &&
                  (index < openFirst ? (
                    <Notes markdown={notes} repo={repoOf[project]} />
                  ) : (
                    <details className="cl-more">
                      <summary>{c.showNotes}</summary>
                      <Notes markdown={notes} repo={repoOf[project]} />
                    </details>
                  ))}
                <div className="cl-files">
                  {release.assets.length > 0 && <h3 className="pg-label">{c.files}</h3>}
                  <ul>
                    {release.assets.map((asset) => (
                      <li key={asset.name}>
                        <a
                          href={asset.url}
                          className="file-link"
                          aria-label={`${c.downloads} ${asset.name}, ${fileSize(asset.size, lang)}`}
                        >
                          <DownloadIcon />
                          <span>{asset.name}</span>
                          <span className="meta">{fileSize(asset.size, lang)}</span>
                        </a>
                      </li>
                    ))}
                    <li>
                      <a href={release.url} className="file-link ghosted">
                        {c.onGitHub}
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </a>
                    </li>
                  </ul>
                </div>
              </article>
            </li>
          );
        })}
      </ol>

      <p className="fine-note pg-foot-note">
        {before}
        <Link href="/download">/download</Link>
        {after}
      </p>
    </div>
  );
}
