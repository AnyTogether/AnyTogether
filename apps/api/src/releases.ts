import { ErrorCode } from "@anytogether/shared";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";

/** AnyPS5's downloads, from each project's latest GitHub release (the release stays the source).
 *  Answers are kept in Valkey for ten minutes, and the last good one for a week in case GitHub
 *  is down or the address runs out of its 60 calls an hour. */

export const releaseRepos = {
  /** The macOS launcher, with the phone app's APK and IPA beside it. */
  macos: "utkuhalis/AnyPS5-ARM",
  /** The Windows and Linux launcher. */
  desktop: "utkuhalis/AnyPS5-Desktop",
} as const;
type Product = keyof typeof releaseRepos;

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  sha256: string | null;
}

export interface Release {
  repo: string;
  version: string;
  tag: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string;
  assets: ReleaseAsset[];
}

const fresh = 600;
const stale = 7 * 86_400;
/** The main file of each product, by name. */
const mainAsset: Record<string, (name: string) => boolean> = {
  launcher: (name) => name === "AnyPS5-macOS.zip",
  macos: (name) => name === "AnyPS5-macOS.zip",
  phone: (name) => /\.apk$/i.test(name),
  "phone-ios": (name) => /\.ipa$/i.test(name),
  desktop: (name) => /\.(zip|exe|msi|AppImage|tar\.gz)$/i.test(name),
};

function parse(repo: string, raw: unknown): Release | null {
  const r = raw as {
    tag_name?: string;
    name?: string;
    published_at?: string;
    html_url?: string;
    body?: string;
    draft?: boolean;
    assets?: { name?: string; size?: number; browser_download_url?: string; digest?: string | null }[];
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
    notes: (r.body ?? "").slice(0, 8000),
    assets: (r.assets ?? [])
      .filter((a) => a.name && a.browser_download_url?.startsWith("https://github.com/"))
      .map((a) => ({
        name: a.name as string,
        size: a.size ?? 0,
        url: a.browser_download_url as string,
        sha256: a.digest?.startsWith("sha256:") ? a.digest.slice(7) : null,
      })),
  };
}

export function releaseRoutes(deps: Deps) {
  const app = new Hono();
  const fetcher = deps.githubFetch ?? fetch;

  /** The latest release of a repository, or null when it has none yet. */
  const latest = async (repo: string): Promise<Release | null> => {
    const key = `releases:${repo}`;
    const cached = await deps.valkey.get(key);
    if (cached) return JSON.parse(cached);
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "AnyTogether",
          ...(deps.githubToken ? { authorization: `Bearer ${deps.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 404) {
        await deps.valkey.set(key, "null", "EX", fresh);
        return null;
      }
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const release = parse(repo, await response.json());
      const text = JSON.stringify(release);
      await deps.valkey.multi().set(key, text, "EX", fresh).set(`${key}:stale`, text, "EX", stale).exec();
      return release;
    } catch (error) {
      const old = await deps.valkey.get(`${key}:stale`);
      if (old) {
        // Asked again in a minute, not on every request while GitHub is away.
        await deps.valkey.set(key, old, "EX", 60);
        return JSON.parse(old);
      }
      console.error(`release check for ${repo} failed`, error);
      throw new HttpError(503, ErrorCode.internal, "Releases are not available right now");
    }
  };

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

  return app;
}
