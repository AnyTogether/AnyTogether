import { CopyButton } from "@/components/CopyButton";
import { type Platform, type Releases, filesFor, installLine, pickDownload } from "@/lib/downloads";
import type { SiteStrings } from "@/lib/i18n-site";
import { fill } from "@/lib/people";
import { fileSize } from "@/lib/themes";
import type { JSX } from "react";
import { brandPaths } from "./brandPaths";

export const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

/** The mark of each platform. The operating systems wear their own logos, filled (Apple, Android
 *  and Tux from Simple Icons, CC0), so each is known at a glance; the web is the site's line globe.
 *  Every mark sits in the same square box, so none can stretch or shift its neighbours. */
const brand = (d: string) => () => <path d={d} className="brand" />;
export const platformIcons: Record<Platform | "web", () => JSX.Element> = {
  mac: brand(brandPaths.apple),
  windows: () => (
    <path
      className="brand"
      d="M3 5.2l7.6-1.05v7.3H3zM11.6 4l9.4-1.3v8.75h-9.4zM3 12.5h7.6v7.35L3 18.8zM11.6 12.5H21v8.8L11.6 20z"
    />
  ),
  linux: brand(brandPaths.linux),
  iphone: brand(brandPaths.apple),
  android: brand(brandPaths.android),
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

/** The big download button: the visitor's platform and its file's size. An iPhone
 *  gets the install steps, since an IPA needs AltStore or another signer first. */
export function DownloadCta({
  platform,
  releases,
  s,
  language,
  direct = false,
  quiet = false,
  short = false,
}: {
  platform: Platform | null;
  releases: Releases | null;
  s: SiteStrings;
  language: string;
  /** The file itself, even for an iPhone (on the phone page, beside its install steps). */
  direct?: boolean;
  /** The second button of a pair: outlined. */
  quiet?: boolean;
  /** Just the platform's name, where the page already says what it is (the phone page). */
  short?: boolean;
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
  const label = short
    ? s.platform[platform]
    : phone
      ? fill(s.phoneFor, { platform: s.platform[platform] })
      : fill(s.downloadFor, { platform: s.platform[platform] });
  // Only the file's size: the platform names the file, and the release is named at the top of the
  // page. Kept short so a pair of buttons fits side by side at the same width.
  const size = pick.size ? fileSize(pick.size, language) : null;
  return (
    <a
      href={platform === "iphone" && !direct ? "/phone#install" : pick.url}
      className={`cta ${quiet ? "ghost" : "primary"}`}
    >
      <PlatformIcon platform={platform} />
      <span className="cta-label">{label}</span>
      {size && <span className="cta-fine">{size}</span>}
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
