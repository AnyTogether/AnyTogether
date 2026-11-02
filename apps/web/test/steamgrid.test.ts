import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { forgetArt, gameArt, searchName, withArt } = await import("../lib/steamgrid");

const answer = (data: unknown) => Response.json({ success: true, data });

describe("game art from SteamGridDB", () => {
  let calls: string[];
  beforeEach(() => {
    forgetArt();
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
        if (url.includes("/search/autocomplete/")) return answer([{ id: 42, name: "Returnal" }]);
        if (url.includes("/grids/game/42"))
          return answer([
            { url: "https://cdn2.steamgriddb.com/grid/funny.png", thumb: "https://x/f.png", humor: true },
            {
              url: "https://cdn2.steamgriddb.com/grid/a.png",
              thumb: "https://cdn2.steamgriddb.com/thumb/a.png",
            },
          ]);
        return answer([]);
      }),
    );
    vi.stubEnv("STEAMGRIDDB_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("finds a square picture by the game's name, and asks only once", async () => {
    expect(await gameArt("Returnal™")).toBe("https://cdn2.steamgriddb.com/thumb/a.png");
    expect(calls[0]).toContain("/search/autocomplete/returnal");
    const asked = calls.length;
    expect(await gameArt("RETURNAL")).toBe("https://cdn2.steamgriddb.com/thumb/a.png");
    expect(calls.length).toBe(asked);
  });

  it("asks nothing without a key or a name", async () => {
    vi.stubEnv("STEAMGRIDDB_API_KEY", "");
    expect(await gameArt("Returnal")).toBeNull();
    vi.stubEnv("STEAMGRIDDB_API_KEY", "test-key");
    expect(await gameArt("PPSA01234")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("keeps a game's own icon, and fills only the missing ones", async () => {
    const games = [
      { titleId: "PPSA00001", iconUrl: "https://own/icon.png", name: "Mine" },
      { titleId: "PPSA00002", iconUrl: null, name: "Returnal" },
    ];
    const shown = await withArt(games, (g) => g.name);
    expect(shown.map((g) => g.iconUrl)).toEqual([
      "https://own/icon.png",
      "https://cdn2.steamgriddb.com/thumb/a.png",
    ]);
    expect(calls.some((url) => url.includes("Mine"))).toBe(false);
  });

  it("cleans names before searching", () => {
    expect(searchName("Marvel's Spider-Man 2™ (PS5)")).toBe("marvel's spider-man 2");
  });
});
