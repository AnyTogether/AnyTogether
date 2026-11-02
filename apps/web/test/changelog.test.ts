import { describe, expect, it } from "vitest";
import { changelogEntries, eagerAnchors, openAnchors, pickProject } from "../lib/changelog";
import type { Release } from "../lib/downloads";
import { kept } from "../lib/kept";

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
    release("AnyTogether/AnyPS5-Desktop", "0.1.2", "2026-10-25T09:00:00Z", true),
    release("AnyTogether/AnyPS5-Desktop", "0.1.1", "2026-10-24T20:56:40Z"),
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

describe("the changelog's open releases", () => {
  const many = {
    macos: ["0.2.6", "0.2.5", "0.2.4", "0.2.3", "0.2.2"].map((v, i) =>
      release("AnyTogether/AnyPS5-ARM", v, `2026-10-2${8 - i}T10:00:00Z`),
    ),
    desktop: ["0.1.4", "0.1.3", "0.1.2", "0.1.1"].map((v, i) =>
      release("AnyTogether/AnyPS5-Desktop", v, `2026-10-1${8 - i}T10:00:00Z`),
    ),
  };
  const entries = changelogEntries(many);

  it("opens the first three that match the filter", () => {
    expect([...openAnchors(entries, null)]).toEqual(["macos-0.2.6", "macos-0.2.5", "macos-0.2.4"]);
    expect([...openAnchors(entries, "desktop")]).toEqual(["desktop-0.1.4", "desktop-0.1.3", "desktop-0.1.2"]);
  });

  it("sends the notes of every release that can be open with the page", () => {
    const eager = eagerAnchors(entries);
    expect(eager.size).toBe(6);
    for (const only of [null, "macos", "desktop"] as const)
      for (const anchor of openAnchors(entries, only)) expect(eager.has(anchor)).toBe(true);
  });
});

describe("an answer kept in memory", () => {
  it("is fetched once, given at once while stale and refreshed behind it", async () => {
    let clock = 0;
    let calls = 0;
    const get = kept(
      async () => ++calls,
      1000,
      () => clock,
    );
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    clock = 1500;
    // Stale: the old answer comes back at once, a new one is on its way.
    expect(await get()).toBe(1);
    await Promise.resolve();
    expect(await get()).toBe(2);
    expect(calls).toBe(2);
  });

  it("keeps the old answer when a refresh fails, and waits again only without one", async () => {
    let clock = 0;
    let fail = false;
    const get = kept(
      async () => {
        if (fail) throw new Error("down");
        return "ok";
      },
      1000,
      () => clock,
    );
    expect(await get()).toBe("ok");
    fail = true;
    clock = 2000;
    expect(await get()).toBe("ok");
    expect(await get()).toBe("ok");
    const empty = kept(
      async () => Promise.reject(new Error("down")),
      1000,
      () => clock,
    );
    await expect(empty()).rejects.toThrow("down");
  });
});
