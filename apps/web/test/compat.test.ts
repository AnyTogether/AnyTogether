import { describe, expect, it } from "vitest";
import { type CompatGame, compatHref, compatQuery, compatView, onlineWorks } from "../lib/compat";
import { compatEn, compatTr } from "../lib/i18n-compat";

describe("the compatibility list's address", () => {
  it("reads the view from the query and ignores what it does not know", () => {
    expect(compatView({})).toEqual({
      platform: null,
      status: null,
      online: false,
      sort: "updated",
      q: "",
      n: 50,
    });
    expect(
      compatView({
        platform: "linux",
        status: "playable",
        online: "works",
        sort: "name",
        q: "  cat ",
        n: "150",
      }),
    ).toEqual({ platform: "linux", status: "playable", online: true, sort: "name", q: "cat", n: 150 });
    expect(
      compatView({ platform: "amiga", status: "great", online: "yes", sort: "random", n: "9999" }),
    ).toEqual({
      platform: null,
      status: null,
      online: false,
      sort: "updated",
      q: "",
      n: 500,
    });
    expect(compatView({ platform: ["windows", "linux"] }).platform).toBe("windows");
  });

  it("writes the view back, defaults left out, a changed filter starting from the top", () => {
    const view = compatView({ platform: "macos", q: "cat", n: "100" });
    expect(compatHref(view)).toBe("/compatibility?platform=macos&q=cat&n=100");
    expect(compatHref(view, { status: "ingame" })).toBe("/compatibility?platform=macos&status=ingame&q=cat");
    expect(compatHref(view, { online: true, sort: "status" })).toBe(
      "/compatibility?platform=macos&online=works&sort=status&q=cat",
    );
    expect(compatHref(view, { n: 150 })).toBe("/compatibility?platform=macos&q=cat&n=150");
    expect(compatHref(compatView({}), { sort: "updated" })).toBe("/compatibility");
    // The same view again keeps where the list was.
    expect(compatHref(view, { platform: "macos" })).toBe("/compatibility?platform=macos&q=cat&n=100");
  });

  it("asks the API for what the view shows", () => {
    expect(String(compatQuery(compatView({})))).toBe("limit=100");
    expect(
      String(compatQuery(compatView({ platform: "linux", status: "menus", online: "works", sort: "name" }))),
    ).toBe("limit=100&platform=linux&status=menus&online=works&sort=name");
  });

  it("marks online play that works on a platform shown", () => {
    const game: CompatGame = {
      titleId: "PPSA01234",
      name: "Cat Quest III",
      names: {},
      iconUrl: null,
      platforms: {
        macos: {
          status: "playable",
          version: "0.2.24",
          testedAt: "2026-10-26T00:00:00Z",
          reports: 2,
          online: "broken",
        },
        linux: {
          status: "ingame",
          version: "0.2.24",
          testedAt: "2026-10-26T00:00:00Z",
          reports: 1,
          online: "works",
        },
      },
    };
    expect(onlineWorks(game, ["macos", "windows", "linux"])).toBe(true);
    expect(onlineWorks(game, ["macos"])).toBe(false);
    expect(
      onlineWorks(
        {
          ...game,
          platforms: {
            macos: {
              ...(game.platforms.macos as NonNullable<typeof game.platforms.macos>),
              online: undefined,
            },
          },
        },
        ["macos"],
      ),
    ).toBe(false);
  });

  it("says every new text in both languages", () => {
    expect(Object.keys(compatTr).sort()).toEqual(Object.keys(compatEn).sort());
    for (const key of [
      "filterStatus",
      "anyStatus",
      "onlinePlay",
      "sortBy",
      "sortUpdated",
      "sortName",
      "sortStatus",
    ])
      expect(compatEn).toHaveProperty(key);
  });
});
