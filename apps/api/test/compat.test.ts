import { accounts } from "@anytogether/db";
import { compareVersions } from "@anytogether/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>> | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const v1 = "/api/v1";
const report = (more: Record<string, unknown> = {}) => ({
  titleId: "PPSA01234",
  name: "Cat Quest III",
  platform: "macos",
  status: "playable",
  launcherVersion: "0.2.13",
  engineVersion: "0.2.13-arm",
  machine: "MacBook Pro (M3 Pro)",
  os: "macOS 26.1",
  fpsAvg: 58.44,
  ...more,
});

describe("compatibility", () => {
  it("compares versions by their numbers", () => {
    expect(compareVersions("0.2.13", "0.2.9")).toBe(1);
    expect(compareVersions("0.2.8", "0.2.13-arm")).toBe(-1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("takes reports from the signed-in, teaches the game's name, and works out a verdict per platform", async () => {
    h = await harness();
    const t = h;
    const utku = await t.user("utku@example.com");
    const ayse = await t.user("ayse@example.com");
    const can = await t.user("can@example.com");
    expect((await t.call("POST", `${v1}/compat/reports`, report())).status).toBe(401);
    expect(
      (await t.call("POST", `${v1}/compat/reports`, report({ status: "great" }), utku.token)).status,
    ).toBe(400);
    expect(
      (await t.call("POST", `${v1}/compat/reports`, report({ titleId: "nope" }), utku.token)).status,
    ).toBe(400);
    expect(
      (await t.call("POST", `${v1}/compat/reports`, report({ note: "see www.example.com" }), utku.token))
        .status,
    ).toBe(400);

    const first = await t.call("POST", `${v1}/compat/reports`, report({ status: "menus" }), utku.token);
    expect(first.status).toBe(201);
    expect(first.body.summary).toMatchObject({ status: "menus", version: "0.2.13", reports: 1 });
    // Two others on the same version say playable: most of them win.
    await t.call("POST", `${v1}/compat/reports`, report(), ayse.token);
    const third = await t.call("POST", `${v1}/compat/reports`, report({ name: "Another name" }), can.token);
    expect(third.body.summary).toMatchObject({ status: "playable", reports: 3 });
    // A person counts once, with their latest report.
    await t.call("POST", `${v1}/compat/reports`, report({ status: "boots" }), ayse.token);
    await t.call("POST", `${v1}/compat/reports`, report({ status: "boots" }), ayse.token);
    let game = await t.call("GET", `${v1}/compat/PPSA01234`);
    // menus 1, playable 1, boots 1: a tie goes to the better.
    expect(game.body.platforms.macos).toMatchObject({ status: "playable", reports: 5 });
    // An older version reported later does not change what the newest one reached.
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ status: "nothing", launcherVersion: "0.2.8" }),
      utku.token,
    );
    game = await t.call("GET", `${v1}/compat/PPSA01234`, undefined, utku.token);
    expect(game.body.platforms.macos).toMatchObject({ status: "playable", version: "0.2.13" });
    // A newer version starts over.
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ status: "ingame", launcherVersion: "0.3.0" }),
      can.token,
    );
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({
        platform: "windows",
        status: "boots",
        launcherVersion: "0.1.0",
        machine: "Ryzen 7 / RTX 4070",
      }),
      can.token,
    );
    game = await t.call("GET", `${v1}/compat/PPSA01234`, undefined, utku.token);
    expect(game.body).toMatchObject({
      titleId: "PPSA01234",
      name: "Cat Quest III",
      platforms: {
        macos: { status: "ingame", version: "0.3.0", reports: 7 },
        windows: { status: "boots", version: "0.1.0", reports: 1 },
      },
    });
    expect(game.body.platforms.linux).toBeUndefined();
    expect(game.body.reports).toHaveLength(8);
    expect(game.body.reports[0]).toMatchObject({ platform: "windows", mine: false });
    const mine = game.body.reports.filter((r: { mine: boolean }) => r.mine);
    expect(mine).toHaveLength(2);
    expect(game.body.reports.find((r: { status: string }) => r.status === "menus")).toMatchObject({
      machine: "MacBook Pro (M3 Pro)",
      os: "macOS 26.1",
      fpsAvg: 58.4,
      engineVersion: "0.2.13-arm",
    });
    expect(JSON.stringify(game.body)).not.toContain(utku.id);

    // Deleting one's own report works the verdict out again.
    const windowsReport = game.body.reports[0].id;
    expect(
      (await t.call("DELETE", `${v1}/compat/reports/${windowsReport}`, undefined, utku.token)).status,
    ).toBe(404);
    expect(
      (await t.call("DELETE", `${v1}/compat/reports/${windowsReport}`, undefined, can.token)).status,
    ).toBe(204);
    expect((await t.call("GET", `${v1}/compat/PPSA01234`)).body.platforms.windows).toBeUndefined();

    // A deleted account's reports stay, without anyone behind them.
    await t.deps.db.delete(accounts).where(eq(accounts.id, utku.id));
    expect((await t.call("GET", `${v1}/compat/PPSA01234`)).body.reports).toHaveLength(7);
  });

  it("lists games with reports, newest first, with search and filters", async () => {
    h = await harness();
    const t = h;
    const utku = await t.user("utku@example.com");
    await t.call("POST", `${v1}/compat/reports`, report(), utku.token);
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ titleId: "CUSA00001", name: "Old Friend", status: "menus", platform: "linux" }),
      utku.token,
    );
    // A game in the catalogue that nobody reported is not on the list.
    await t.call("PUT", `${v1}/games/PPSA09999`, { names: { en: "Untested" } }, utku.token);

    const list = await t.call("GET", `${v1}/compat`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.games.map((g: { titleId: string }) => g.titleId)).toEqual(["CUSA00001", "PPSA01234"]);
    expect(list.body.games[0]).toMatchObject({
      name: "Old Friend",
      platforms: { linux: { status: "menus" } },
    });
    const ids = async (query: string) =>
      (await t.call("GET", `${v1}/compat?${query}`)).body.games.map((g: { titleId: string }) => g.titleId);
    expect(await ids("q=cat")).toEqual(["PPSA01234"]);
    expect(await ids("q=cusa")).toEqual(["CUSA00001"]);
    expect(await ids("platform=linux")).toEqual(["CUSA00001"]);
    expect(await ids("platform=macos&status=playable")).toEqual(["PPSA01234"]);
    expect(await ids("platform=macos&status=menus")).toEqual([]);
    expect(await ids("limit=1")).toEqual(["CUSA00001"]);
    expect((await t.call("GET", `${v1}/compat?limit=1`)).body.next).toBe("1");
    expect((await t.call("GET", `${v1}/compat?platform=amiga`)).status).toBe(400);

    expect((await t.call("GET", `${v1}/compat/PPSA09999`)).body).toMatchObject({
      platforms: {},
      reports: [],
    });
    expect((await t.call("GET", `${v1}/compat/PPSA00000`)).status).toBe(404);
  });

  it("sorts by name, by status (best first) or by the latest report, and says so", async () => {
    h = await harness();
    const t = h;
    const utku = await t.user("utku@example.com");
    // Reported in this order: Zeta (menus), alpha (playable), Mid (boots, then ingame on Windows).
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ titleId: "PPSA00003", name: "Zeta", status: "menus" }),
      utku.token,
    );
    await t.call("POST", `${v1}/compat/reports`, report({ titleId: "PPSA00001", name: "alpha" }), utku.token);
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ titleId: "PPSA00002", name: "Mid", status: "boots" }),
      utku.token,
    );
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ titleId: "PPSA00002", name: "Mid", status: "ingame", platform: "windows" }),
      utku.token,
    );
    const ids = async (query: string) =>
      (await t.call("GET", `${v1}/compat?${query}`)).body.games.map((g: { titleId: string }) => g.titleId);
    expect(await ids("")).toEqual(["PPSA00002", "PPSA00001", "PPSA00003"]);
    expect(await ids("sort=updated")).toEqual(["PPSA00002", "PPSA00001", "PPSA00003"]);
    expect(await ids("sort=name")).toEqual(["PPSA00001", "PPSA00002", "PPSA00003"]);
    // A game's best platform counts: Mid is in game on Windows, so above Zeta's menus.
    expect(await ids("sort=status")).toEqual(["PPSA00001", "PPSA00002", "PPSA00003"]);
    // With a platform, that platform's verdict: on macOS Mid only boots.
    expect(await ids("sort=status&platform=macos")).toEqual(["PPSA00001", "PPSA00003", "PPSA00002"]);
    expect((await t.call("GET", `${v1}/compat?sort=name&limit=2`)).body).toMatchObject({
      next: "2",
      sort: "name",
    });
    expect(await ids("sort=name&limit=2&cursor=2")).toEqual(["PPSA00003"]);
    expect((await t.call("GET", `${v1}/compat?sort=random`)).status).toBe(400);
  });

  it("takes whether online play works, sums it up per platform and filters on it", async () => {
    h = await harness();
    const t = h;
    const utku = await t.user("utku@example.com");
    const ayse = await t.user("ayse@example.com");
    const can = await t.user("can@example.com");
    expect(
      (await t.call("POST", `${v1}/compat/reports`, report({ online: "sometimes" }), utku.token)).status,
    ).toBe(400);
    const first = await t.call("POST", `${v1}/compat/reports`, report({ online: "works" }), utku.token);
    expect(first.body.summary).toMatchObject({ online: "works" });
    // Two of three say it is broken: most of them win; a report without it does not count.
    await t.call("POST", `${v1}/compat/reports`, report({ online: "broken" }), ayse.token);
    const third = await t.call("POST", `${v1}/compat/reports`, report({ online: "broken" }), can.token);
    expect(third.body.summary).toMatchObject({ online: "broken" });
    await t.call("POST", `${v1}/compat/reports`, report(), can.token);
    expect((await t.call("GET", `${v1}/compat/PPSA01234`)).body.platforms.macos.online).toBe("broken");
    // A tie goes to works, like a status tie goes to the better one.
    await t.call("POST", `${v1}/compat/reports`, report({ online: "works" }), ayse.token);
    expect((await t.call("GET", `${v1}/compat/PPSA01234`)).body.platforms.macos.online).toBe("works");
    const reports = (await t.call("GET", `${v1}/compat/PPSA01234`)).body.reports as {
      online: string | null;
    }[];
    expect(reports.map((r) => r.online)).toContain(null);

    // Another game nobody played online, and one where it works on Linux only.
    await t.call("POST", `${v1}/compat/reports`, report({ titleId: "PPSA00002", name: "Solo" }), utku.token);
    await t.call(
      "POST",
      `${v1}/compat/reports`,
      report({ titleId: "PPSA00003", name: "Linux party", platform: "linux", online: "works" }),
      utku.token,
    );
    const ids = async (query: string) =>
      (await t.call("GET", `${v1}/compat?${query}&sort=name`)).body.games.map(
        (g: { titleId: string }) => g.titleId,
      );
    expect(await ids("online=works")).toEqual(["PPSA01234", "PPSA00003"]);
    expect(await ids("online=works&platform=linux")).toEqual(["PPSA00003"]);
    expect(await ids("online=works&platform=macos")).toEqual(["PPSA01234"]);
    expect((await t.call("GET", `${v1}/compat?online=works&platform=macos`)).body.total).toBe(1);
    expect((await t.call("GET", `${v1}/compat?online=maybe`)).status).toBe(400);
  });
});
