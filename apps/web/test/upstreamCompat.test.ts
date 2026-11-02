import { describe, expect, it } from "vitest";
import {
  type CompatGame,
  type UpstreamList,
  mergedRows,
  upstreamReportUrl,
  upstreamView,
  withUpstream,
} from "../lib/compat";

const list: UpstreamList = {
  available: true,
  source: "https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up",
  fetchedAt: "2026-11-02T10:00:00Z",
  games: [
    {
      titleId: "PPSA21564",
      name: "Astro Bot",
      url: "https://github.com/boykopovar/AnyPS5/discussions/357",
      status: "ingame",
      platforms: ["windows", "linux"],
      replies: 74,
      updatedAt: "2026-11-02T09:00:00Z",
    },
    {
      titleId: "PPSA06829",
      name: "Insomnis",
      url: "https://github.com/boykopovar/AnyPS5/discussions/14054",
      status: "menus",
      platforms: ["linux"],
      replies: 0,
      updatedAt: "2026-11-01T09:00:00Z",
    },
    {
      titleId: "PPSA00001",
      name: "No form",
      url: "https://github.com/boykopovar/AnyPS5/discussions/1",
      status: null,
      platforms: ["windows", "linux"],
      replies: 2,
      updatedAt: "2026-10-01T09:00:00Z",
    },
  ],
};
const ours: CompatGame = {
  titleId: "PPSA21564",
  name: "Astro Bot",
  names: { en: "Astro Bot" },
  iconUrl: null,
  platforms: {
    macos: { status: "playable", version: "0.2.30", testedAt: "2026-10-30T09:00:00Z", reports: 3 },
    windows: { status: "boots", version: "0.1.17", testedAt: "2026-10-20T09:00:00Z", reports: 1 },
  },
};

describe("Windows and Linux from the AnyPS5 project", () => {
  it("replaces our Windows and Linux with the game's thread, and keeps macOS ours", () => {
    const shown = withUpstream(ours, list.games[0]);
    expect(shown.platforms.macos?.status).toBe("playable");
    expect(shown.platforms.windows).toMatchObject({ status: "ingame", upstream: list.games[0]?.url });
    expect(shown.platforms.linux?.status).toBe("ingame");
  });

  it("lists one platform's threads, searched and filtered", () => {
    const view = { platform: "linux" as const, status: null, sort: "name" as const, q: "" };
    expect(upstreamView(list, view).map((g) => g.titleId)).toEqual(["PPSA21564", "PPSA06829", "PPSA00001"]);
    expect(upstreamView(list, { ...view, platform: "windows" }).map((g) => g.titleId)).toEqual([
      "PPSA21564",
      "PPSA00001",
    ]);
    expect(upstreamView(list, { ...view, status: "menus" }).map((g) => g.titleId)).toEqual(["PPSA06829"]);
    expect(upstreamView(list, { ...view, q: "insom" }).map((g) => g.titleId)).toEqual(["PPSA06829"]);
  });

  it("adds the games only upstream has to All, each linking to its thread", () => {
    const rows = mergedRows([ours], list, { status: null, sort: "updated", q: "" });
    expect(rows.map((r) => [r.titleId, r.external])).toEqual([
      ["PPSA21564", false],
      ["PPSA06829", true],
    ]);
    expect(rows[1]?.href).toBe("https://github.com/boykopovar/AnyPS5/discussions/14054");
  });

  it("sends a report to the game's thread, or to the category searched for its title ID", () => {
    expect(upstreamReportUrl("PPSA21564", "https://github.com/x/1")).toBe("https://github.com/x/1");
    expect(upstreamReportUrl("PPSA21564")).toContain("discussions_q=PPSA21564");
    expect(upstreamReportUrl(null)).toBe(list.source);
  });
});
