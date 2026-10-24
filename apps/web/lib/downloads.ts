/** Which AnyPS5 file a visitor wants, from their browser, and where it is. Pure, so the front page,
 *  the product pages and the tests share it. */

export type Platform = "mac" | "windows" | "linux" | "iphone" | "android";
export const platformOrder: Platform[] = ["mac", "windows", "linux", "iphone", "android"];

export interface Asset {
  name: string;
  size: number;
  url: string;
  sha256: string | null;
}
export interface Release {
  repo: string;
  version: string;
  tag: string;
  publishedAt: string;
  url: string;
  assets: Asset[];
}
export interface Releases {
  macos: Release | null;
  desktop: Release | null;
}

export const repos = {
  mac: "utkuhalis/AnyPS5-ARM",
  desktop: "utkuhalis/AnyPS5-Desktop",
  together: "utkuhalis/AnyTogether",
} as const;

/** GitHub's link to a file of a repository's latest release, by its unchanging name. */
const latest = (repo: string, name: string) => `https://github.com/${repo}/releases/latest/download/${name}`;

/** The platform a browser runs on: the client hint when it sends one, else its user agent. iPads
 *  that call themselves a Mac are taken at their word. */
export function detectPlatform(userAgent: string | null, hint?: string | null): Platform | null {
  const platformHint = hint?.replace(/"/g, "").toLowerCase();
  if (platformHint === "macos") return "mac";
  if (platformHint === "windows") return "windows";
  if (platformHint === "android") return "android";
  if (platformHint === "ios") return "iphone";
  if (platformHint === "linux") return "linux";
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
}

export interface Pick {
  platform: Platform;
  /** What the file is, for the button's small print: "zip", "Setup.exe", "AppImage"... */
  kind: string;
  url: string;
  size: number | null;
  version: string | null;
  /** The release's page, for notes. */
  page: string;
}

type Rule = {
  repo: string;
  release: keyof Releases;
  test: (name: string) => boolean;
  fallback: string;
  kind: string;
};

/** The one file each platform's button gives, and what to give when GitHub's answer is not here. */
const main: Record<Platform, Rule> = {
  mac: {
    repo: repos.mac,
    release: "macos",
    test: (n) => n === "AnyPS5-macOS.zip",
    fallback: "AnyPS5-macOS.zip",
    kind: "zip",
  },
  windows: {
    repo: repos.desktop,
    release: "desktop",
    test: (n) => /^AnyPS5-Desktop-Setup-.*\.exe$/i.test(n),
    fallback: "AnyPS5-Desktop-windows-x64.zip",
    kind: "Setup.exe",
  },
  linux: {
    repo: repos.desktop,
    release: "desktop",
    test: (n) => /\.AppImage$/i.test(n),
    fallback: "AnyPS5-Desktop-linux-x64.tar.gz",
    kind: "AppImage",
  },
  iphone: {
    repo: repos.mac,
    release: "macos",
    test: (n) => /\.ipa$/i.test(n),
    fallback: "AnyPS5-Remote.ipa",
    kind: "IPA",
  },
  android: {
    repo: repos.mac,
    release: "macos",
    test: (n) => /\.apk$/i.test(n),
    fallback: "AnyPS5-Remote.apk",
    kind: "APK",
  },
};

/** The main download for a platform: the release's file when the release is known, else GitHub's
 *  latest-release link, which always leads to the newest file of that name. */
export function pickDownload(platform: Platform, releases: Releases | null): Pick {
  const rule = main[platform];
  const release = releases?.[rule.release] ?? null;
  const asset = release?.assets.find((a) => rule.test(a.name));
  if (release && asset)
    return {
      platform,
      kind: rule.kind,
      url: asset.url,
      size: asset.size || null,
      version: release.version,
      page: release.url,
    };
  const fallbackKind = rule.fallback.endsWith(".zip")
    ? "zip"
    : rule.fallback.endsWith(".tar.gz")
      ? "tar.gz"
      : rule.kind;
  return {
    platform,
    kind: fallbackKind,
    url: latest(rule.repo, rule.fallback),
    size: null,
    version: null,
    page: `https://github.com/${rule.repo}/releases/latest`,
  };
}

export interface FileLink {
  label: string;
  url: string;
  size: number | null;
}

/** Every file of a platform, for the platform cards: the installers first. Without GitHub's answer,
 *  the files whose names never change. */
export function filesFor(platform: Platform, releases: Releases | null): FileLink[] {
  const desktop = platform === "windows" || platform === "linux";
  const release = (desktop ? releases?.desktop : releases?.macos) ?? null;
  const wanted: Record<Platform, [string, (n: string) => boolean][]> = {
    mac: [["AnyPS5-macOS.zip", (n) => n === "AnyPS5-macOS.zip"]],
    windows: [
      ["Setup.exe", (n) => /^AnyPS5-Desktop-Setup-.*\.exe$/i.test(n)],
      ["Portable .zip", (n) => n === "AnyPS5-Desktop-windows-x64.zip"],
    ],
    linux: [
      ["AppImage", (n) => /\.AppImage$/i.test(n)],
      [".deb", (n) => /\.deb$/i.test(n)],
      [".tar.gz", (n) => n === "AnyPS5-Desktop-linux-x64.tar.gz"],
    ],
    iphone: [["AnyPS5-Remote.ipa", (n) => /\.ipa$/i.test(n)]],
    android: [["AnyPS5-Remote.apk", (n) => /\.apk$/i.test(n)]],
  };
  const found = wanted[platform].flatMap(([label, test]) => {
    const asset = release?.assets.find((a) => test(a.name));
    return asset ? [{ label, url: asset.url, size: asset.size || null }] : [];
  });
  if (found.length) return found;
  const repo = desktop ? repos.desktop : repos.mac;
  const stable: Record<Platform, [string, string][]> = {
    mac: [["AnyPS5-macOS.zip", "AnyPS5-macOS.zip"]],
    windows: [["Portable .zip", "AnyPS5-Desktop-windows-x64.zip"]],
    linux: [[".tar.gz", "AnyPS5-Desktop-linux-x64.tar.gz"]],
    iphone: [["AnyPS5-Remote.ipa", "AnyPS5-Remote.ipa"]],
    android: [["AnyPS5-Remote.apk", "AnyPS5-Remote.apk"]],
  };
  return stable[platform].map(([label, name]) => ({ label, url: latest(repo, name), size: null }));
}

export const installLine =
  "curl -fsSL https://github.com/utkuhalis/AnyPS5-ARM/releases/latest/download/install.sh | sh";

/** Totals worth showing on the front page: each only once it is past a number that does not look
 *  empty, and the row only with at least two of them. */
export interface PublicStats {
  players: number;
  hoursThisWeek: number;
  trophies: number;
  themes: number;
}
export const statFloors: PublicStats = { players: 100, hoursThisWeek: 100, trophies: 1000, themes: 12 };

export function statsWorthShowing(stats: PublicStats | null): (keyof PublicStats)[] {
  if (!stats) return [];
  const shown = (Object.keys(statFloors) as (keyof PublicStats)[]).filter(
    (key) => typeof stats[key] === "number" && stats[key] >= statFloors[key],
  );
  return shown.length >= 2 ? shown : [];
}
