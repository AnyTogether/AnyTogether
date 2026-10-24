import { describe, expect, it } from "vitest";
import { type Releases, detectPlatform, filesFor, pickDownload, statsWorthShowing } from "../lib/downloads";

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
