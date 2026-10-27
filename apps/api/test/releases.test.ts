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
  html_url: "https://github.com/AnyTogether/AnyPS5-ARM/releases/tag/v0.2.13-arm",
  body: "## What's new",
  assets: [
    {
      name: "AnyPS5-macOS.zip",
      size: 43580022,
      browser_download_url:
        "https://github.com/AnyTogether/AnyPS5-ARM/releases/download/v0.2.13-arm/AnyPS5-macOS.zip",
      digest: "sha256:9bdc",
      updated_at: "2026-10-24T15:10:00Z",
    },
    {
      name: "AnyPS5-Remote.apk",
      size: 53254825,
      browser_download_url:
        "https://github.com/AnyTogether/AnyPS5-ARM/releases/download/v0.2.13-arm/AnyPS5-Remote.apk",
      digest: "sha256:f7ba",
    },
    { name: "elsewhere.zip", size: 1, browser_download_url: "https://evil.example/x.zip" },
  ],
};

/** GitHub as the tests want it: answers per repository's latest release (or per any other path,
 *  given in full after api.github.com/), and a count of calls. */
function fakeGithub(answers: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const path = url.replace("https://api.github.com/", "");
    const repo = path.replace("repos/", "").replace("/releases/latest", "");
    return (answers[path] ?? answers[repo] ?? (() => new Response("{}", { status: 404 })))();
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("releases", () => {
  it("lists each project's latest release from GitHub, cached, with coming soon for none", async () => {
    const github = fakeGithub({ "AnyTogether/AnyPS5-ARM": () => Response.json(armRelease) });
    h = await harness({ githubFetch: github.fetcher });
    const answer = await h.call("GET", `${v1}/releases`);
    expect(answer.status).toBe(200);
    expect(answer.body.desktop).toBeNull();
    expect(answer.body.macos).toMatchObject({
      repo: "AnyTogether/AnyPS5-ARM",
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
      "AnyTogether/AnyPS5-ARM": () =>
        up ? Response.json(armRelease) : new Response("rate limited", { status: 403 }),
    });
    h = await harness({ githubFetch: github.fetcher });
    await h.call("GET", `${v1}/releases`);
    up = false;
    await h.valkey.del("releases:AnyTogether/AnyPS5-ARM");
    const answer = await h.call("GET", `${v1}/releases`);
    expect(answer.body.macos.version).toBe("0.2.13");

    await h.valkey.flushdb();
    expect((await h.call("GET", `${v1}/releases`)).status).toBe(503);
  });
});

describe("release history", () => {
  const older = {
    ...armRelease,
    tag_name: "v0.2.12-arm",
    name: "AnyPS5-ARM 0.2.12",
    published_at: "2026-10-24T00:52:00Z",
    body: "x".repeat(30_000),
  };
  const draft = { ...armRelease, tag_name: "v0.2.16-arm", draft: true };

  it("lists every published release of both projects, newest first, with whole notes, cached", async () => {
    const github = fakeGithub({
      "repos/AnyTogether/AnyPS5-ARM/releases?per_page=50": () => Response.json([draft, armRelease, older]),
      "repos/AnyTogether/AnyPS5-Desktop/releases?per_page=50": () =>
        Response.json([{ tag_name: "v0.1.1", prerelease: true, published_at: "2026-10-24T20:56:40Z" }]),
    });
    h = await harness({ githubFetch: github.fetcher });
    const answer = await h.call("GET", `${v1}/releases/history`);
    expect(answer.status).toBe(200);
    expect(answer.body.macos.map((r: { version: string }) => r.version)).toEqual(["0.2.13", "0.2.12"]);
    expect(answer.body.macos[0]).toMatchObject({ notes: "## What's new", prerelease: false });
    expect(answer.body.macos[0].assets[0]).toMatchObject({
      sha256: "9bdc",
      updatedAt: "2026-10-24T15:10:00Z",
    });
    expect(answer.body.macos[1].notes).toHaveLength(20_000);
    expect(answer.body.desktop).toEqual([
      expect.objectContaining({ version: "0.1.1", prerelease: true, assets: [] }),
    ]);
    await h.call("GET", `${v1}/releases/history`);
    expect(github.calls).toHaveLength(2);
  });

  it("answers null for a project GitHub cannot tell about, and keeps the last good answer", async () => {
    let up = true;
    const github = fakeGithub({
      "repos/AnyTogether/AnyPS5-ARM/releases?per_page=50": () =>
        up ? Response.json([armRelease]) : new Response("rate limited", { status: 403 }),
      "repos/AnyTogether/AnyPS5-Desktop/releases?per_page=50": () => new Response("down", { status: 500 }),
    });
    h = await harness({ githubFetch: github.fetcher });
    const first = await h.call("GET", `${v1}/releases/history`);
    expect(first.body.desktop).toBeNull();
    up = false;
    await h.valkey.del("releases:history:AnyTogether/AnyPS5-ARM");
    expect((await h.call("GET", `${v1}/releases/history`)).body.macos).toHaveLength(1);
  });
});

describe("projects", () => {
  it("gives each repository's stars, forks, licence and last push, cached for an hour", async () => {
    const github = fakeGithub({
      "repos/AnyTogether/AnyPS5-ARM": () =>
        Response.json({
          full_name: "AnyTogether/AnyPS5-ARM",
          description: "PS5 games on Apple silicon",
          stargazers_count: 120,
          forks_count: 9,
          open_issues_count: 4,
          license: { spdx_id: "GPL-2.0" },
          pushed_at: "2026-10-25T08:00:00Z",
          html_url: "https://github.com/AnyTogether/AnyPS5-ARM",
        }),
      "repos/AnyTogether/AnyTogether": () =>
        Response.json({ full_name: "AnyTogether/AnyTogether", license: { spdx_id: "NOASSERTION" } }),
      "repos/boykopovar/AnyPS5": () => new Response("down", { status: 502 }),
    });
    h = await harness({ githubFetch: github.fetcher });
    const answer = await h.call("GET", `${v1}/projects`);
    expect(answer.status).toBe(200);
    expect(answer.body.repos["AnyTogether/AnyPS5-ARM"]).toEqual({
      repo: "AnyTogether/AnyPS5-ARM",
      description: "PS5 games on Apple silicon",
      stars: 120,
      forks: 9,
      openIssues: 4,
      license: "GPL-2.0",
      pushedAt: "2026-10-25T08:00:00Z",
      url: "https://github.com/AnyTogether/AnyPS5-ARM",
    });
    expect(answer.body.repos["AnyTogether/AnyTogether"]).toMatchObject({ stars: 0, license: null });
    // 404 for the Desktop repository here: nothing to tell; GitHub down for upstream: unknown.
    expect(answer.body.repos["AnyTogether/AnyPS5-Desktop"]).toBeNull();
    expect(answer.body.repos["boykopovar/AnyPS5"]).toBeNull();
    const calls = github.calls.length;
    await h.call("GET", `${v1}/projects`);
    // Only the repository that failed is asked again.
    expect(github.calls.length).toBe(calls + 1);
  });
});
