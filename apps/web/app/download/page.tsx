import { CopyButton } from "@/components/CopyButton";
import { DownloadCta, DownloadIcon, PlatformIcon } from "@/components/site/Download";
import { PageHead, day } from "@/components/site/PageHead";
import { Reveal } from "@/components/site/Reveal";
import { wide } from "@/components/site/fonts";
import {
  type DownloadFile,
  type Platform,
  type Release,
  downloadGroups,
  installLine,
  repos,
} from "@/lib/downloads";
import { language } from "@/lib/i18n";
import { type DownloadPageStrings, downloadPageStrings } from "@/lib/i18n-download";
import { siteStrings } from "@/lib/i18n-site";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { loadReleases, visitorPlatform } from "@/lib/site";
import { fileSize } from "@/lib/themes";
import Link from "next/link";

export async function generateMetadata() {
  const d = downloadPageStrings(await language());
  return pageMetadata(d.meta.title, d.meta.description, "/download");
}

const productPage: Record<Platform, string> = {
  mac: "/mac",
  windows: "/pc",
  linux: "/pc",
  iphone: "/phone",
  android: "/phone",
};

/** Every file of AnyPS5-ARM's and AnyPS5 Desktop's latest releases, by platform (the visitor's
 *  first), each with its version, size, date and GitHub's SHA-256, and how to install it. */
export default async function Download() {
  const lang = await language();
  const [releases, visitor] = await Promise.all([loadReleases(), visitorPlatform()]);
  const s = siteStrings(lang);
  const d = downloadPageStrings(lang);
  const { groups, other } = downloadGroups(releases, visitor);
  const latest: [string, string, Release | null][] = [
    ["AnyPS5-ARM", repos.mac, releases?.macos ?? null],
    ["AnyPS5 Desktop", repos.desktop, releases?.desktop ?? null],
  ];

  return (
    <div className={`site pg dl-page ${wide.variable}`}>
      <Reveal />
      <PageHead kicker={d.kicker} title={d.title} lead={d.lead}>
        <div className="cta-row">
          <DownloadCta platform={visitor} releases={releases} s={s} language={lang} direct />
          <a href={`https://github.com/${repos.mac}/releases`} className="cta ghost">
            {d.allReleases}
          </a>
        </div>
        <ul className="pg-chips">
          {latest.map(([name, repo, release]) => (
            <li key={repo}>
              <a href={release?.url ?? `https://github.com/${repo}/releases/latest`} className="release">
                <span className="dot" aria-hidden="true" />
                {release ? fill(d.latestOf, { name, version: release.version }) : name}
                {release?.publishedAt && (
                  <span className="release-more">
                    {fill(d.releasedOn, { date: day(release.publishedAt, lang) })}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
        <div className="pg-links">
          <Link href="/specs" className="text-link">
            {d.specs}
            <svg viewBox="0 0 24 24" aria-hidden="true" className="ico arrow">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </PageHead>

      {!releases && <p className="pg-notice">{d.down}</p>}

      <nav className="toc" aria-label={d.onThisPage}>
        <span className="meta">{d.onThisPage}</span>
        <ul>
          {groups.map((group) => (
            <li key={group.platform}>
              <a href={`#${group.platform}`}>{s.platform[group.platform]}</a>
            </li>
          ))}
          <li>
            <a href="#verify">{d.verify.kicker}</a>
          </li>
        </ul>
      </nav>

      {groups.map((group) => (
        <section
          key={group.platform}
          id={group.platform}
          className={`dl-plat${group.platform === visitor ? " current" : ""}`}
          aria-labelledby={`${group.platform}-title`}
          data-reveal
        >
          <header className="dl-plat-head">
            <PlatformIcon platform={group.platform} />
            <div>
              <h2 id={`${group.platform}-title`}>
                {s.platform[group.platform]}
                {group.platform === visitor && <span className="chip-tag preview">{d.yourSystem}</span>}
              </h2>
              <Link href={productPage[group.platform]} className="plat-product">
                {d.products[group.platform]}
                {(group.platform === "windows" || group.platform === "linux") && (
                  <span className="chip-tag">{s.preview}</span>
                )}
              </Link>
            </div>
          </header>
          <div className="dl-plat-body">
            {group.files.length ? (
              <ul className="dl-files">
                {group.files.map((file) => (
                  <FileRow key={file.name} file={file} d={d} lang={lang} />
                ))}
              </ul>
            ) : (
              <p className="pg-muted">{d.noFiles}</p>
            )}
            <div className="dl-guide">
              <h3 className="pg-label">{d.install}</h3>
              <ol className="install-steps">
                {d.guides[group.platform].steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <h3 className="pg-label">{d.requirements}</h3>
              <dl className="reqs">
                {d.guides[group.platform].requirements.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      ))}

      {other.length > 0 && (
        <section className="dl-plat" id="other" aria-labelledby="other-title" data-reveal>
          <header className="dl-plat-head">
            <div>
              <h2 id="other-title">{d.otherTitle}</h2>
              <p className="plat-product">{d.otherLead}</p>
            </div>
          </header>
          <ul className="dl-files">
            {other.map((file) => (
              <FileRow key={file.name} file={file} d={d} lang={lang} />
            ))}
          </ul>
        </section>
      )}

      <section className="pg-sec dl-verify" id="verify" data-reveal>
        <div>
          <h2 className="h-card">{d.verify.title}</h2>
          <p className="s-lead">{d.verify.lead}</p>
        </div>
        <dl className="dl-commands">
          {(
            [
              [d.verify.mac, "shasum -a 256 AnyPS5-macOS.zip"],
              [d.verify.linux, "sha256sum AnyPS5-Desktop-linux-x64.tar.gz"],
              [d.verify.windows, "Get-FileHash .\\AnyPS5-Desktop-windows-x64.zip"],
            ] as const
          ).map(([label, command]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="term-line">
                <code>{command}</code>
                <CopyButton text={command} label={d.copy} done={d.copied} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="fine-note pg-foot-note">
        {d.onlyOurs} {d.older.split("{link}")[0]}
        <Link href="/changelog">{d.changelog}</Link>
        {d.older.split("{link}")[1]}
      </p>
    </div>
  );
}

function FileRow({ file, d, lang }: { file: DownloadFile; d: DownloadPageStrings; lang: string }) {
  const [kind, what] = d.kinds[file.kind];
  return (
    <li className="dl-file">
      <div className="dl-file-top">
        <div className="dl-file-name">
          <span className="dl-kind">{kind}</span>
          <code>{file.name}</code>
        </div>
        <a
          href={file.url}
          className="file-link dl-get"
          aria-label={fill(d.downloadName, { name: file.name })}
        >
          <DownloadIcon />
          <span>{d.download}</span>
        </a>
      </div>
      <p className="dl-what">{what}</p>
      {(file.version || file.size || file.date) && (
        <dl className="dl-meta">
          {file.version && (
            <div>
              <dt>{d.version}</dt>
              <dd>{file.version}</dd>
            </div>
          )}
          {file.size && (
            <div>
              <dt>{d.size}</dt>
              <dd>{fileSize(file.size, lang)}</dd>
            </div>
          )}
          {file.date && (
            <div>
              <dt>{d.date}</dt>
              <dd>
                <time dateTime={file.date}>{day(file.date, lang)}</time>
              </dd>
            </div>
          )}
        </dl>
      )}
      {file.kind === "script" && (
        <div className="term-line">
          <code>{installLine}</code>
          <CopyButton text={installLine} label={d.copy} done={d.copied} />
        </div>
      )}
      {file.sha256 && (
        <div className="dl-sum">
          <span className="dl-sum-label">{d.sha}</span>
          <code title={file.sha256}>{file.sha256}</code>
          <CopyButton
            text={file.sha256}
            label={d.copy}
            done={d.copied}
            name={fill(d.copySha, { name: file.name })}
          />
        </div>
      )}
    </li>
  );
}
