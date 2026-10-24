import { CopyButton } from "@/components/CopyButton";
import { type Platform, type Releases, filesFor, installLine, pickDownload } from "@/lib/downloads";
import type { SiteStrings } from "@/lib/i18n-site";
import { fill } from "@/lib/people";
import { fileSize } from "@/lib/themes";
import type { JSX } from "react";

export const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

/** The small mark of each platform, drawn in the site's line style. */
export const platformIcons: Record<Platform | "web", () => JSX.Element> = {
  mac: () => (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16.5V20" />
    </>
  ),
  windows: () => (
    <>
      <path d="M3.5 5.5l7-1v7h-7zM12.5 4.2l8-1.2v8.5h-8zM3.5 12.5h7v7l-7-1zM12.5 12.5h8V21l-8-1.2z" />
    </>
  ),
  linux: () => (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" />
    </>
  ),
  iphone: () => (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  android: () => (
    <>
      <rect x="5" y="9" width="14" height="10" rx="2" />
      <path d="M8 9a4 4 0 0 1 8 0M8.5 5.5l1 1.6M15.5 5.5l-1 1.6" />
      <circle cx="9.5" cy="12" r=".6" fill="currentColor" />
      <circle cx="14.5" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  web: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
};

export function PlatformIcon({ platform }: { platform: Platform | "web" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ico plat">
      {platformIcons[platform]()}
    </svg>
  );
}

/** The big download button: the visitor's platform, its file's kind, size and version. An iPhone
 *  gets the install steps, since an IPA needs AltStore or another signer first. */
export function DownloadCta({
  platform,
  releases,
  s,
  language,
  direct = false,
  quiet = false,
}: {
  platform: Platform | null;
  releases: Releases | null;
  s: SiteStrings;
  language: string;
  /** The file itself, even for an iPhone (on the phone page, beside its install steps). */
  direct?: boolean;
  /** The second button of a pair: outlined. */
  quiet?: boolean;
}) {
  if (!platform)
    return (
      <a href="/download" className="cta primary">
        <DownloadIcon />
        <span className="cta-label">{s.downloadAny}</span>
      </a>
    );
  const pick = pickDownload(platform, releases);
  const phone = platform === "iphone" || platform === "android";
  const label = phone
    ? fill(s.phoneFor, { platform: s.platform[platform] })
    : fill(s.downloadFor, { platform: s.platform[platform] });
  const fine = [
    pick.kind,
    pick.size ? fileSize(pick.size, language) : null,
    pick.version ? fill(s.versionShort, { version: pick.version }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <a
      href={platform === "iphone" && !direct ? "/phone#install" : pick.url}
      className={`cta ${quiet ? "ghost" : "primary"}`}
    >
      <PlatformIcon platform={platform} />
      <span className="cta-label">{label}</span>
      <span className="cta-fine">{fine}</span>
    </a>
  );
}

/** One platform's card: what it is, what it needs, and its files. */
export function PlatformCard({
  platform,
  releases,
  s,
  language,
  current,
}: {
  platform: Platform;
  releases: Releases | null;
  s: SiteStrings;
  language: string;
  current: boolean;
}) {
  const card = s.landing.platforms.cards[platform];
  const files = filesFor(platform, releases);
  const preview = platform === "windows" || platform === "linux";
  const page = platform === "mac" ? "/mac" : preview ? "/pc" : "/phone";
  return (
    <article className={`plat-card${current ? " current" : ""}`} data-reveal>
      <header>
        <PlatformIcon platform={platform} />
        <div>
          <h3>{s.platform[platform]}</h3>
          <a href={page} className="plat-product">
            {card.product}
            {preview && <span className="chip-tag">{s.preview}</span>}
          </a>
        </div>
      </header>
      <p className="plat-req">{card.req}</p>
      <ul className="plat-files">
        {files.map((file) => (
          <li key={file.url}>
            <a href={file.url} className="file-link">
              <DownloadIcon />
              <span>{file.label === "Portable .zip" ? s.portableZip : file.label}</span>
              {file.size ? <span className="meta">{fileSize(file.size, language)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
      {platform === "mac" && (
        <div className="plat-terminal">
          <span className="meta">{s.landing.platforms.orTerminal}</span>
          <div className="term-line">
            <code>{installLine}</code>
            <CopyButton text={installLine} label={s.copy} done={s.copied} />
          </div>
        </div>
      )}
    </article>
  );
}
