import { describe, expect, it } from "vitest";
import {
  type Releases,
  classifyFile,
  detectPlatform,
  downloadGroups,
  filesFor,
  pickDownload,
  statsWorthShowing,
} from "../lib/downloads";

const releases: Releases = {
  macos: {
    repo: "utkuhalis/AnyPS5-ARM",
    version: "0.2.15",
    tag: "v0.2.15-arm",
    publishedAt: "2026-10-25T00:00:00Z",
    url: "https://github.com/utkuhalis/AnyPS5-ARM/releases/tag/v0.2.15-arm",
    assets: [
      {
        name: "AnyPS5-macOS.zip",
        size: 58_000_000,
        url: "https://github.com/x/AnyPS5-macOS.zip",
        sha256: null,
      },
      {
        name: "AnyPS5-Remote.apk",
        size: 88_000_000,
        url: "https://github.com/x/AnyPS5-Remote.apk",
        sha256: null,
      },
      {
        name: "AnyPS5-Remote.ipa",
        size: 14_000_000,
        url: "https://github.com/x/AnyPS5-Remote.ipa",
        sha256: null,
      },
    ],
  },
  desktop: {
    repo: "utkuhalis/AnyPS5-Desktop",
    version: "0.1.1",
    tag: "v0.1.1",
    publishedAt: "2026-10-25T00:00:00Z",
    url: "https://github.com/utkuhalis/AnyPS5-Desktop/releases/tag/v0.1.1",
    assets: [
      {
        name: "AnyPS5-Desktop-Setup-0.1.1-x64.exe",
        size: 16_000_000,
        url: "https://github.com/x/setup.exe",
        sha256: null,
      },
      {
        name: "AnyPS5-Desktop-windows-x64.zip",
        size: 20_000_000,
        url: "https://github.com/x/win.zip",
        sha256: null,
      },
      {
        name: "AnyPS5-Desktop-0.1.1-x86_64.AppImage",
        size: 18_000_000,
        url: "https://github.com/x/a.AppImage",
        sha256: null,
      },
      {
        name: "anyps5-desktop_0.1.1_amd64.deb",
        size: 14_000_000,
        url: "https://github.com/x/a.deb",
        sha256: null,
      },
      {
        name: "AnyPS5-Desktop-linux-x64.tar.gz",
        size: 19_000_000,
        url: "https://github.com/x/a.tar.gz",
        sha256: null,
      },
    ],
  },
};

describe("the visitor's platform", () => {
  it("is read from the client hint first, then the user agent", () => {
    expect(detectPlatform("anything", '"macOS"')).toBe("mac");
    expect(detectPlatform("anything", '"Windows"')).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iphone");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("curl/8.0")).toBeNull();
    expect(detectPlatform(null)).toBeNull();
  });
});

describe("the download button", () => {
  it("gives each platform its main file, with size and version, from the release", () => {
    expect(pickDownload("mac", releases)).toMatchObject({
      url: "https://github.com/x/AnyPS5-macOS.zip",
      version: "0.2.15",
      kind: "zip",
    });
    expect(pickDownload("windows", releases)).toMatchObject({
      url: "https://github.com/x/setup.exe",
      kind: "Setup.exe",
    });
    expect(pickDownload("linux", releases)).toMatchObject({
      url: "https://github.com/x/a.AppImage",
      kind: "AppImage",
    });
    expect(pickDownload("android", releases).url).toBe("https://github.com/x/AnyPS5-Remote.apk");
    expect(pickDownload("iphone", releases).url).toBe("https://github.com/x/AnyPS5-Remote.ipa");
  });

  it("falls back to GitHub's latest-release links when the releases are not known", () => {
    expect(pickDownload("mac", null)).toMatchObject({
      url: "https://github.com/utkuhalis/AnyPS5-ARM/releases/latest/download/AnyPS5-macOS.zip",
      size: null,
      version: null,
    });
    expect(pickDownload("windows", null)).toMatchObject({
      url: "https://github.com/utkuhalis/AnyPS5-Desktop/releases/latest/download/AnyPS5-Desktop-windows-x64.zip",
      kind: "zip",
    });
    expect(pickDownload("linux", null).kind).toBe("tar.gz");
  });

  it("lists every file of a platform, installers first", () => {
    expect(filesFor("linux", releases).map((f) => f.label)).toEqual(["AppImage", ".deb", ".tar.gz"]);
    expect(filesFor("windows", releases).map((f) => f.label)).toEqual(["Setup.exe", "Portable .zip"]);
    expect(filesFor("linux", null)).toEqual([
      {
        label: ".tar.gz",
        url: "https://github.com/utkuhalis/AnyPS5-Desktop/releases/latest/download/AnyPS5-Desktop-linux-x64.tar.gz",
        size: null,
      },
    ]);
  });
});

describe("the front page's totals", () => {
  it("are shown only past numbers that do not look empty, and only two or more together", () => {
    expect(statsWorthShowing(null)).toEqual([]);
    expect(statsWorthShowing({ players: 12, hoursThisWeek: 30, trophies: 200, themes: 3 })).toEqual([]);
    expect(statsWorthShowing({ players: 500, hoursThisWeek: 30, trophies: 200, themes: 3 })).toEqual([]);
    expect(statsWorthShowing({ players: 500, hoursThisWeek: 30, trophies: 5000, themes: 3 })).toEqual([
      "players",
      "trophies",
    ]);
  });
});

describe("the downloads page", () => {
  const both: Releases = {
    desktop: releases.desktop,
    macos: releases.macos && {
      ...releases.macos,
      assets: [
        ...releases.macos.assets,
        {
          name: "install.sh",
          size: 1562,
          url: "https://github.com/x/install.sh",
          sha256: "025b",
          updatedAt: "2026-10-24T21:37:45Z",
        },
        {
          name: "AnyPS5-toolkit-macos-0.2.15-arm.zip",
          size: 40_000_000,
          url: "https://github.com/x/toolkit.zip",
          sha256: null,
        },
        // AnyPS5-ARM's release carries the Desktop files too.
        {
          name: "AnyPS5-Desktop-windows-x64.zip",
          size: 20_000_000,
          url: "https://github.com/arm/win.zip",
          sha256: null,
        },
        { name: "notes.pdf", size: 10, url: "https://github.com/x/notes.pdf", sha256: null },
      ],
    },
  };

  it("knows each file's platform and kind", () => {
    expect(classifyFile("AnyPS5-Desktop-Setup-0.1.1-x64.exe")).toMatchObject({
      platform: "windows",
      kind: "installer",
    });
    expect(classifyFile("anyps5-desktop_0.1.1_amd64.deb")).toMatchObject({ platform: "linux", kind: "deb" });
    expect(classifyFile("AnyPS5-toolkit-macos-0.2.15-arm.zip")).toMatchObject({
      platform: "mac",
      kind: "engine",
    });
    expect(classifyFile("AnyPS5-toolkit-windows-0.2.15.zip")).toMatchObject({
      platform: "windows",
      kind: "engine",
    });
    expect(classifyFile("notes.pdf")).toBeNull();
  });

  it("lists every file once, by platform, the visitor's first, installers first", () => {
    const { groups, other } = downloadGroups(both, "linux");
    expect(groups.map((g) => g.platform)).toEqual(["linux", "mac", "windows", "iphone", "android"]);
    const names = (platform: string) => groups.find((g) => g.platform === platform)?.files.map((f) => f.name);
    expect(names("mac")).toEqual(["AnyPS5-macOS.zip", "install.sh", "AnyPS5-toolkit-macos-0.2.15-arm.zip"]);
    expect(names("windows")).toEqual([
      "AnyPS5-Desktop-Setup-0.1.1-x64.exe",
      "AnyPS5-Desktop-windows-x64.zip",
    ]);
    expect(names("linux")).toEqual([
      "AnyPS5-Desktop-0.1.1-x86_64.AppImage",
      "anyps5-desktop_0.1.1_amd64.deb",
      "AnyPS5-Desktop-linux-x64.tar.gz",
    ]);
    // The Windows zip both releases carry is listed once, from AnyPS5 Desktop's.
    const zip = groups.find((g) => g.platform === "windows")?.files[1];
    expect(zip).toMatchObject({ url: "https://github.com/x/win.zip", version: "0.1.1" });
    const script = groups.find((g) => g.platform === "mac")?.files[1];
    expect(script).toMatchObject({ sha256: "025b", date: "2026-10-24T21:37:45Z", version: "0.2.15" });
    // A file without its own date gets its release's.
    expect(groups.find((g) => g.platform === "mac")?.files[0]?.date).toBe("2026-10-25T00:00:00Z");
    expect(other.map((f) => f.name)).toEqual(["notes.pdf"]);
  });

  it("falls back to the files whose names never change when GitHub's answer is not here", () => {
    const { groups, other } = downloadGroups(null, null);
    expect(groups.map((g) => g.platform)).toEqual(["mac", "windows", "linux", "iphone", "android"]);
    expect(groups[0]?.files.map((f) => f.url)).toEqual([
      "https://github.com/utkuhalis/AnyPS5-ARM/releases/latest/download/AnyPS5-macOS.zip",
      "https://github.com/utkuhalis/AnyPS5-ARM/releases/latest/download/install.sh",
    ]);
    expect(groups[1]?.files[0]).toMatchObject({ size: null, sha256: null, version: null, kind: "portable" });
    expect(other).toEqual([]);
    // Only the project GitHub did not answer for falls back.
    const half = downloadGroups({ macos: releases.macos, desktop: null }, null);
    expect(half.groups[1]?.files.map((f) => f.name)).toEqual(["AnyPS5-Desktop-windows-x64.zip"]);
    expect(half.groups[1]?.files[0]?.version).toBeNull();
  });
});
