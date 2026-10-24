import { afterEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const armRelease = {
  tag_name: "v0.2.13-arm",
  name: "AnyPS5-ARM 0.2.13",
  published_at: "2026-10-24T15:11:32Z",
  html_url: "https://github.com/utkuhalis/AnyPS5-ARM/releases/tag/v0.2.13-arm",
  body: "## What's new",
  assets: [
    {
      name: "AnyPS5-macOS.zip",
      size: 43580022,
      browser_download_url:
        "https://github.com/utkuhalis/AnyPS5-ARM/releases/download/v0.2.13-arm/AnyPS5-macOS.zip",
      digest: "sha256:9bdc",
    },
    {
      name: "AnyPS5-Remote.apk",
      size: 53254825,
      browser_download_url:
        "https://github.com/utkuhalis/AnyPS5-ARM/releases/download/v0.2.13-arm/AnyPS5-Remote.apk",
      digest: "sha256:f7ba",
    },
    { name: "elsewhere.zip", size: 1, browser_download_url: "https://evil.example/x.zip" },
  ],
};

/** GitHub as the tests want it: answers per repository, and a count of calls. */
function fakeGithub(answers: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const repo = url.replace("https://api.github.com/repos/", "").replace("/releases/latest", "");
    return (answers[repo] ?? (() => new Response("{}", { status: 404 })))();
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("releases", () => {
  it("lists each project's latest release from GitHub, cached, with coming soon for none", async () => {
    const github = fakeGithub({ "utkuhalis/AnyPS5-ARM": () => Response.json(armRelease) });
    h = await harness({ githubFetch: github.fetcher });
    const answer = await h.call("GET", `${v1}/releases`);
    expect(answer.status).toBe(200);
    expect(answer.body.desktop).toBeNull();
    expect(answer.body.macos).toMatchObject({
      repo: "utkuhalis/AnyPS5-ARM",
      version: "0.2.13",
      tag: "v0.2.13-arm",
      publishedAt: "2026-10-24T15:11:32Z",
    });
    expect(answer.body.macos.assets.map((a: { name: string }) => a.name)).toEqual([
      "AnyPS5-macOS.zip",
      "AnyPS5-Remote.apk",
    ]);
    expect(answer.body.macos.assets[0].sha256).toBe("9bdc");
    await h.call("GET", `${v1}/releases`);
    expect(github.calls).toHaveLength(2);

    const phone = await h.call("GET", `${v1}/releases/latest?product=phone`);
    expect(phone.body).toMatchObject({ product: "phone", version: "0.2.13", sha256: "f7ba", size: 53254825 });
    expect((await h.call("GET", `${v1}/releases/latest?product=phone-ios`)).status).toBe(404);
    expect((await h.call("GET", `${v1}/releases/latest?product=desktop`)).status).toBe(404);
    expect((await h.call("GET", `${v1}/releases/latest?product=game`)).status).toBe(400);
  });

  it("keeps the last good answer when GitHub fails", async () => {
    let up = true;
    const github = fakeGithub({
      "utkuhalis/AnyPS5-ARM": () =>
        up ? Response.json(armRelease) : new Response("rate limited", { status: 403 }),
    });
    h = await harness({ githubFetch: github.fetcher });
    await h.call("GET", `${v1}/releases`);
    up = false;
    await h.valkey.del("releases:utkuhalis/AnyPS5-ARM");
    const answer = await h.call("GET", `${v1}/releases`);
    expect(answer.body.macos.version).toBe("0.2.13");

    await h.valkey.flushdb();
    expect((await h.call("GET", `${v1}/releases`)).status).toBe(503);
  });
});
