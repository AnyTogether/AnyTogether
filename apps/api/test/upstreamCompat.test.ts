import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gameOfThread, platformsOfThread, statusOfThread, upstreamCompat } from "../src/upstreamCompat.js";

const formBody = (reached: string, system: string) =>
  `### Existing thread\n\n- [x] I searched\n\n### Title\n\nInsomnis (PPSA06829)\n\n### System tested\n\n${system}\n\n### Furthest point\n\n${reached}\n\n### What is shown\n\nThe opening scene.`;

describe("reading the upstream game bring-up threads", () => {
  it("takes the status from the form's furthest point", () => {
    expect(statusOfThread(formBody("In game", "Arch Linux"))).toBe("ingame");
    expect(statusOfThread(formBody("Menu", "Windows 11"))).toBe("menus");
    expect(statusOfThread(formBody("Logos or loading screen", "x"))).toBe("boots");
    expect(statusOfThread(formBody("Stops before the first frame", "x"))).toBe("nothing");
    expect(statusOfThread(formBody("Does not convert", "x"))).toBe("nothing");
    expect(statusOfThread("## Tested\n\nIt runs, more or less.")).toBeNull();
  });

  it("knows the platform from the system tested, both when it cannot tell", () => {
    expect(platformsOfThread("Insomnis (PPSA06829)", formBody("Menu", "Linux 7.2, RADV Mesa"))).toEqual([
      "linux",
    ]);
    expect(platformsOfThread("X (PPSA00001)", formBody("Menu", "Windows 11, RTX 5080"))).toEqual(["windows"]);
    expect(platformsOfThread("X (PPSA00001)", formBody("Menu", "a computer"))).toEqual(["windows", "linux"]);
    expect(platformsOfThread("Hollow Knight: Silksong (PPSA12544) on Linux", "free text")).toEqual(["linux"]);
  });

  it("finds the title ID and the name in the thread's title", () => {
    expect(gameOfThread("Astro Bot (PPSA21564)", "")).toEqual({ titleId: "PPSA21564", name: "Astro Bot" });
    expect(gameOfThread("Another Crab's Treasure — PPSA20423", "")).toEqual({
      titleId: "PPSA20423",
      name: "Another Crab's Treasure",
    });
    expect(gameOfThread("Hollow Knight: Silksong (PPSA12544) on Linux", "")?.name).toBe(
      "Hollow Knight: Silksong",
    );
    expect(gameOfThread("A question about shaders", "")).toBeNull();
  });
});

describe("the kept upstream list", () => {
  let valkey: Redis;
  beforeEach(async () => {
    valkey = new Redis(process.env.TEST_VALKEY_URL ?? "redis://127.0.0.1:63799/1");
    await valkey.del("upstream-compat:v1", "upstream-compat:v1:stale", "upstream-compat:v1:lock");
  });
  afterEach(() => valkey.disconnect());

  it("is nothing without a token, and asks GitHub once with one", async () => {
    expect(await upstreamCompat({ valkey })).toBeNull();
    let asked = 0;
    const githubFetch = (async (_url: string, init: RequestInit) => {
      asked++;
      const { query } = JSON.parse(String(init.body)) as { query: string };
      if (query.includes("discussionCategory"))
        return Response.json({ data: { repository: { discussionCategory: { id: "C1" } } } });
      return Response.json({
        data: {
          repository: {
            discussions: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  title: "Insomnis (PPSA06829)",
                  url: "https://github.com/boykopovar/AnyPS5/discussions/14054",
                  body: formBody("In game", "Linux 7.2.11 (Arch)"),
                  updatedAt: "2026-11-02T10:00:00Z",
                  comments: { totalCount: 1 },
                },
              ],
            },
          },
        },
      });
    }) as typeof fetch;
    const list = await upstreamCompat({ valkey, githubToken: "t", githubFetch });
    expect(list?.games).toEqual([
      {
        titleId: "PPSA06829",
        name: "Insomnis",
        url: "https://github.com/boykopovar/AnyPS5/discussions/14054",
        status: "ingame",
        platforms: ["linux"],
        replies: 1,
        updatedAt: "2026-11-02T10:00:00Z",
      },
    ]);
    const before = asked;
    await upstreamCompat({ valkey, githubToken: "t", githubFetch });
    expect(asked).toBe(before);
  });
});
