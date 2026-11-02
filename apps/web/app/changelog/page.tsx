import { ChangelogFilter, ReleaseNotes } from "@/components/site/ChangelogParts";
import { DownloadIcon } from "@/components/site/Download";
import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import { eagerAnchors, openAnchors, pickProject, projects } from "@/lib/changelog";
import { loadChangelog } from "@/lib/changelog-server";
import { repos } from "@/lib/downloads";
import { language } from "@/lib/i18n";
import { changelogStrings } from "@/lib/i18n-changelog";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { fileSize } from "@/lib/themes";
import Link from "next/link";

export async function generateMetadata() {
  const c = changelogStrings(await language());
  return pageMetadata(c.meta.title, c.meta.description, "/changelog");
}

/** Both projects' release notes from GitHub, newest first, rendered from Markdown to sanitised
 *  HTML, each with its files. The list is kept in memory (lib/changelog-server.ts), so a visit
 *  waits for nothing, and the project chips filter it in the browser. */
export default async function Changelog({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await language();
  const c = changelogStrings(lang);
  const only = pickProject((await searchParams).project);
  const data = await loadChangelog();
  const entries = data?.entries ?? [];
  const eager = eagerAnchors(entries);
  const open = openAnchors(entries, only);
  const [before, after] = c.current.split("{link}");
  const counts = {
    all: fill(c.count, { n: entries.length }),
    macos: fill(c.count, { n: entries.filter((e) => e.project === "macos").length }),
    desktop: fill(c.count, { n: entries.filter((e) => e.project === "desktop").length }),
  };

  return (
    <div className={`site pg cl-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={c.kicker} title={c.title} lead={c.lead}>
        {c.englishOnly && <p className="fine-note">{c.englishOnly}</p>}
      </PageHead>

      <ChangelogFilter
        initial={only}
        label={c.filter}
        all={c.all}
        projects={projects.map((id) => ({
          id,
          name: c.projects[id][0] ?? id,
          detail: c.projects[id][1] ?? "",
        }))}
        counts={counts}
      />

      {!data && (
        <p className="pg-notice">
          {c.down} <a href={`https://github.com/${repos.mac}/releases`}>{c.projects.macos[0]}</a> &amp;{" "}
          <a href={`https://github.com/${repos.desktop}/releases`}>{c.projects.desktop[0]}</a>
        </p>
      )}
      {data && entries.length === 0 && <p className="pg-muted cl-none">{c.none}</p>}

      <ol className="cl-list">
        {entries.map((entry, index) => {
          const { release, project } = entry;
          return (
            <li
              key={entry.anchor}
              id={entry.anchor}
              className={`cl-entry${open.has(entry.anchor) ? "" : " folded"}`}
              hidden={!!only && project !== only}
              data-cl-entry
              data-project={project}
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
                {entry.html && (
                  <ReleaseNotes
                    id={entry.anchor}
                    label={c.showNotes}
                    html={eager.has(entry.anchor) ? entry.html : null}
                    open={open.has(entry.anchor)}
                    github={release.url}
                    githubLabel={c.notesOnGitHub}
                  />
                )}
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
