import { describe, expect, it } from "vitest";
import { changelogEntries, pickProject } from "../lib/changelog";
import type { Release } from "../lib/downloads";

const release = (repo: string, version: string, publishedAt: string, prerelease = false): Release => ({
  repo,
  version,
  tag: `v${version}`,
  publishedAt,
  url: `https://github.com/${repo}/releases/tag/v${version}`,
  prerelease,
  assets: [],
});

const history = {
  macos: [
    release("AnyTogether/AnyPS5-ARM", "0.2.15", "2026-10-24T21:56:47Z"),
    release("AnyTogether/AnyPS5-ARM", "0.2.14", "2026-10-24T18:13:47Z"),
  ],
  desktop: [
    release("AnyTogether/AnyLauncher-Port", "0.1.2", "2026-10-25T09:00:00Z", true),
    release("AnyTogether/AnyLauncher-Port", "0.1.1", "2026-10-24T20:56:40Z"),
  ],
};

describe("the changelog", () => {
  it("puts both projects' releases together, newest first, marking each project's latest", () => {
    const entries = changelogEntries(history);
    expect(entries.map((e) => e.anchor)).toEqual([
      "desktop-0.1.2",
      "macos-0.2.15",
      "desktop-0.1.1",
      "macos-0.2.14",
    ]);
    expect(entries.filter((e) => e.latest).map((e) => e.anchor)).toEqual(["macos-0.2.15", "desktop-0.1.1"]);
  });

  it("shows one project when the address asks, and nothing when GitHub did not answer", () => {
    expect(changelogEntries(history, "desktop").map((e) => e.project)).toEqual(["desktop", "desktop"]);
    expect(changelogEntries(null)).toEqual([]);
    expect(changelogEntries({ macos: null, desktop: history.desktop })).toHaveLength(2);
    expect(pickProject("macos")).toBe("macos");
    expect(pickProject(["desktop", "x"])).toBe("desktop");
    expect(pickProject("<script>")).toBeNull();
    expect(pickProject(undefined)).toBeNull();
  });
  it("leaves the nightly builds out", () => {
    const nightly = release(
      "AnyTogether/AnyPS5-ARM",
      "0.2.16-arm-nightly.20261025.1",
      "2026-10-25T20:00:00Z",
      true,
    );
    const entries = changelogEntries({ ...history, macos: [nightly, ...history.macos] });
    expect(entries.map((e) => e.release.version)).not.toContain(nightly.version);
    expect(entries.find((e) => e.project === "macos")?.release.version).toBe("0.2.15");
  });
});
