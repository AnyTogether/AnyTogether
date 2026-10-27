import { ErrorCode } from "@anytogether/shared";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";

/** AnyPS5's downloads, from each project's latest GitHub release (the release stays the source),
 *  the release history for the changelog, and the repositories' numbers for the projects page.
 *  Answers are kept in Valkey (ten minutes for the latest release, a quarter of an hour for the
 *  history, an hour for the numbers), and the last good one for a week in case GitHub is down or
 *  the address runs out of its 60 calls an hour: together they take about 24 calls an hour. */

export const releaseRepos = {
  /** The macOS launcher, with the phone app's APK and IPA beside it. */
  macos: "AnyTogether/AnyPS5-ARM",
  /** The Windows and Linux launcher. */
  desktop: "AnyTogether/AnyLauncher-Port",
} as const;
type Product = keyof typeof releaseRepos;

/** The repositories the projects page lists, the upstream engine last. */
export const projectRepos = [
  "AnyTogether/AnyPS5-ARM",
  "AnyTogether/AnyLauncher-Port",
  "AnyTogether/AnyTogether",
  "boykopovar/AnyPS5",
] as const;

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  sha256: string | null;
  /** When the file was last uploaded, as GitHub says. */
  updatedAt: string;
}

export interface Release {
  repo: string;
  version: string;
  tag: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

export interface RepoStats {
  repo: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  pushedAt: string;
  url: string;
}

const fresh = 600;
const freshHistory = 900;
const freshRepo = 3600;
const stale = 7 * 86_400;
/** The main file of each product, by name. */
const mainAsset: Record<string, (name: string) => boolean> = {
  launcher: (name) => name === "AnyPS5-macOS.zip",
  macos: (name) => name === "AnyPS5-macOS.zip",
  phone: (name) => /\.apk$/i.test(name),
  "phone-ios": (name) => /\.ipa$/i.test(name),
  desktop: (name) => /\.(zip|exe|msi|AppImage|tar\.gz)$/i.test(name),
};

function parse(repo: string, raw: unknown, notesUpTo = 8000): Release | null {
  const r = raw as {
    tag_name?: string;
    name?: string;
    published_at?: string;
    html_url?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: {
      name?: string;
      size?: number;
      browser_download_url?: string;
      digest?: string | null;
      updated_at?: string;
    }[];
  };
  if (!r?.tag_name || r.draft) return null;
  return {
    repo,
    tag: r.tag_name,
    // "v0.2.13-arm" is version 0.2.13.
    version: r.tag_name.replace(/^v/, "").replace(/-[a-z]+$/i, ""),
    name: r.name || r.tag_name,
    publishedAt: r.published_at ?? "",
    url: r.html_url ?? `https://github.com/${repo}/releases`,
    notes: (r.body ?? "").slice(0, notesUpTo),
    prerelease: !!r.prerelease,
    assets: (r.assets ?? [])
      .filter((a) => a.name && a.browser_download_url?.startsWith("https://github.com/"))
      .map((a) => ({
        name: a.name as string,
        size: a.size ?? 0,
        url: a.browser_download_url as string,
        sha256: a.digest?.startsWith("sha256:") ? a.digest.slice(7) : null,
        updatedAt: a.updated_at ?? "",
      })),
  };
}

function parseRepo(repo: string, raw: unknown): RepoStats | null {
  const r = raw as {
    full_name?: string;
    description?: string | null;
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    license?: { spdx_id?: string | null } | null;
    pushed_at?: string;
    html_url?: string;
  };
  if (!r?.full_name) return null;
  const license = r.license?.spdx_id;
  return {
    repo,
    description: (r.description ?? "").slice(0, 300),
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssues: r.open_issues_count ?? 0,
    license: license && license !== "NOASSERTION" ? license : null,
    pushedAt: r.pushed_at ?? "",
    url: `https://github.com/${repo}`,
  };
}

export function releaseRoutes(deps: Deps) {
  const app = new Hono();
  const fetcher = deps.githubFetch ?? fetch;

  /** A GitHub answer, parsed and kept: null when GitHub has no such thing (404). Fails only when
   *  GitHub fails and no earlier answer is kept. */
  const cached = async <T>(
    key: string,
    path: string,
    read: (raw: unknown) => T | null,
    keepFor: number,
  ): Promise<T | null> => {
    const kept = await deps.valkey.get(key);
    if (kept) return JSON.parse(kept);
    try {
      const response = await fetcher(`https://api.github.com/${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "AnyTogether",
          ...(deps.githubToken ? { authorization: `Bearer ${deps.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 404) {
        await deps.valkey.set(key, "null", "EX", keepFor);
        return null;
      }
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const text = JSON.stringify(read(await response.json()));
      await deps.valkey.multi().set(key, text, "EX", keepFor).set(`${key}:stale`, text, "EX", stale).exec();
      return JSON.parse(text);
    } catch (error) {
      const old = await deps.valkey.get(`${key}:stale`);
      if (old) {
        // Asked again in a minute, not on every request while GitHub is away.
        await deps.valkey.set(key, old, "EX", 60);
        return JSON.parse(old);
      }
      console.error(`GitHub ${path} failed`, error);
      throw new HttpError(503, ErrorCode.internal, "GitHub is not available right now");
    }
  };

  /** The latest release of a repository, or null when it has none yet. */
  const latest = (repo: string) =>
    cached(`releases:${repo}`, `repos/${repo}/releases/latest`, (raw) => parse(repo, raw), fresh);

  /** A repository's releases, newest first, drafts left out; null when GitHub cannot say. */
  const history = (repo: string) =>
    cached(
      `releases:history:${repo}`,
      `repos/${repo}/releases?per_page=50`,
      (raw) =>
        (Array.isArray(raw) ? raw : [])
          .map((r) => parse(repo, r, 20_000))
          .filter((r): r is Release => r !== null),
      freshHistory,
    ).catch(() => null);

  app.get("/releases", async (c) => {
    const [macos, desktop] = await Promise.all([
      latest(releaseRepos.macos),
      latest(releaseRepos.desktop).catch(() => null),
    ]);
    c.header("cache-control", "public, max-age=300");
    return c.json({ macos, desktop });
  });

  /** One product's latest file: launcher (macOS), phone (APK), phone-ios (IPA) or desktop. */
  app.get("/releases/latest", async (c) => {
    const product = c.req.query("product") ?? "launcher";
    const pick = mainAsset[product];
    if (!pick)
      throw new HttpError(400, ErrorCode.badRequest, `product: one of ${Object.keys(mainAsset).join(", ")}`);
    const repo = releaseRepos[(product === "desktop" ? "desktop" : "macos") as Product];
    const release = await latest(repo);
    const asset = release?.assets.find((a) => pick(a.name));
    if (!release || !asset) throw new HttpError(404, ErrorCode.notFound, "No release yet");
    c.header("cache-control", "public, max-age=300");
    return c.json({
      product,
      version: release.version,
      tag: release.tag,
      publishedAt: release.publishedAt,
      notes: release.notes,
      page: release.url,
      url: asset.url,
      size: asset.size,
      sha256: asset.sha256,
    });
  });

  /** Every release of both projects, newest first, for the changelog. A project GitHub cannot
   *  tell about right now is null. */
  app.get("/releases/history", async (c) => {
    const [macos, desktop] = await Promise.all([history(releaseRepos.macos), history(releaseRepos.desktop)]);
    c.header("cache-control", "public, max-age=300");
    return c.json({ macos, desktop });
  });

  /** The project's repositories by name, with their stars, forks and last push; null for one
   *  GitHub cannot tell about right now. */
  app.get("/projects", async (c) => {
    const repos = await Promise.all(
      projectRepos.map((repo) =>
        cached(`repo:${repo}`, `repos/${repo}`, (raw) => parseRepo(repo, raw), freshRepo).catch(() => null),
      ),
    );
    c.header("cache-control", "public, max-age=600");
    return c.json({ repos: Object.fromEntries(projectRepos.map((repo, i) => [repo, repos[i] ?? null])) });
  });

  return app;
}
