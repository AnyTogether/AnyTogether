import { CopyButton } from "@/components/CopyButton";
import { type Strings, strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { api } from "@/lib/session";
import { fileSize } from "@/lib/themes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download · AnyTogether",
  description:
    "AnyPS5 for Mac, Windows and Linux, and the phone controller, from each project's latest release.",
};

interface Asset {
  name: string;
  size: number;
  url: string;
  sha256: string | null;
}
interface Release {
  repo: string;
  version: string;
  tag: string;
  publishedAt: string;
  url: string;
  assets: Asset[];
}

const installLine =
  "curl -fsSL https://github.com/utkuhalis/AnyPS5-ARM/releases/latest/download/install.sh | sh";

/** AnyPS5's downloads, from the API's cached copy of each project's latest GitHub release. */
export default async function Download() {
  const texts = await strings();
  const response = await api("/releases").catch(() => undefined);
  const releases = response?.ok
    ? ((await response.json()) as { macos: Release | null; desktop: Release | null })
    : null;
  const mac = releases?.macos ?? null;
  const pick = (test: (name: string) => boolean) => mac?.assets.find((a) => test(a.name)) ?? null;
  const zip = pick((n) => n === "AnyPS5-macOS.zip");
  const apk = pick((n) => /\.apk$/i.test(n));
  const ipa = pick((n) => /\.ipa$/i.test(n));
  const script = pick((n) => n === "install.sh");
  const date = (iso: string) =>
    iso ? new Intl.DateTimeFormat(texts.language, { dateStyle: "medium" }).format(new Date(iso)) : "";

  return (
    <section className="page downloads">
      <h2 className="in d1">{texts.downloads}</h2>
      <p className="lead in d2">{texts.downloadsLead}</p>
      {!releases && (
        <p className="notice in d2">
          {texts.releasesDown}{" "}
          <a href="https://github.com/utkuhalis/AnyPS5-ARM/releases/latest">
            github.com/utkuhalis/AnyPS5-ARM
          </a>
        </p>
      )}

      <article className="card product in d3">
        <header className="product-head">
          <span className="product-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
          </span>
          <div className="lines">
            <h3>{texts.macTitle}</h3>
            <span className="meta">{texts.macSub}</span>
          </div>
        </header>
        {mac && zip ? (
          <>
            <Version release={mac} texts={texts} date={date(mac.publishedAt)} />
            <div className="product-cta">
              <a href={zip.url} className="primary big-download">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
                {texts.downloadForMac}
                <span className="size">{fileSize(zip.size, texts.language)}</span>
              </a>
            </div>
            <Checksum asset={zip} texts={texts} />
            {script && (
              <div className="command">
                <span className="sub">{texts.installInTerminal}</span>
                <div className="command-row">
                  <code>{installLine}</code>
                  <CopyButton text={installLine} label={texts.copy} done={texts.copied} />
                </div>
              </div>
            )}
            <ol className="steps">
              <li>{texts.macStep1}</li>
              <li>{texts.macStep2}</li>
              <li>{texts.macStep3}</li>
            </ol>
          </>
        ) : (
          <GitHubOnly repo="utkuhalis/AnyPS5-ARM" texts={texts} />
        )}
      </article>

      <article className="card product in d3">
        <header className="product-head">
          <span className="product-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
              <path d="M11 18.5h2" />
            </svg>
          </span>
          <div className="lines">
            <h3>{texts.phoneTitle}</h3>
            <span className="meta">{texts.phoneSub}</span>
          </div>
        </header>
        {mac && (apk || ipa) ? (
          <>
            <Version release={mac} texts={texts} date={date(mac.publishedAt)} />
            <ul className="files">
              {(
                [
                  [apk, texts.android],
                  [ipa, texts.iphone],
                ] as [Asset | null, string][]
              ).map(([asset, label]) =>
                asset ? (
                  <li key={asset.name}>
                    <a href={asset.url} className="pill file">
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                      </svg>
                      {label}
                      <span className="meta">{fileSize(asset.size, texts.language)}</span>
                    </a>
                    <Checksum asset={asset} texts={texts} />
                  </li>
                ) : null,
              )}
            </ul>
            <ol className="steps">
              <li>{texts.phoneStep1}</li>
              <li>{texts.phoneStep2}</li>
              <li>{texts.phoneStep3}</li>
            </ol>
          </>
        ) : (
          <GitHubOnly repo="utkuhalis/AnyPS5-ARM" texts={texts} />
        )}
      </article>

      <article className="card product in d4">
        <header className="product-head">
          <span className="product-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M3 13h18M9 21h6" />
            </svg>
          </span>
          <div className="lines">
            <h3>{texts.desktopTitle}</h3>
            <span className="meta">{texts.desktopSub}</span>
          </div>
          {!releases?.desktop && <span className="tag soon">{texts.comingSoon}</span>}
        </header>
        {releases?.desktop ? (
          <>
            <Version release={releases.desktop} texts={texts} date={date(releases.desktop.publishedAt)} />
            <ul className="files">
              {releases.desktop.assets.map((asset) => (
                <li key={asset.name}>
                  <a href={asset.url} className="pill file">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                    </svg>
                    {asset.name}
                    <span className="meta">{fileSize(asset.size, texts.language)}</span>
                  </a>
                  <Checksum asset={asset} texts={texts} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="hint product-soon">{texts.desktopSoon}</p>
            <a href="https://github.com/utkuhalis/AnyPS5-Desktop" className="pill">
              {texts.watchRepo}
            </a>
          </>
        )}
      </article>
      <p className="hint-line fine in d4">{texts.onlyOurs}</p>
    </section>
  );
}

function Version({ release, texts, date }: { release: Release; texts: Strings; date: string }) {
  return (
    <p className="version-line">
      <span className="meta">{fill(texts.versionOn, { version: release.version, date })}</span>
      <a href={release.url} className="meta">
        {texts.releaseNotes}
      </a>
    </p>
  );
}

function Checksum({ asset, texts }: { asset: Asset; texts: Strings }) {
  if (!asset.sha256) return null;
  return (
    <div className="checksum">
      <span className="meta" title={fill(texts.sha256Of, { name: asset.name })}>
        SHA-256 <code>{asset.sha256}</code>
      </span>
      <CopyButton text={asset.sha256} label={texts.copy} done={texts.copied} />
    </div>
  );
}

function GitHubOnly({ repo, texts }: { repo: string; texts: Strings }) {
  return (
    <p className="hint product-soon">
      <a href={`https://github.com/${repo}/releases/latest`}>{texts.allFiles}</a>
    </p>
  );
}
