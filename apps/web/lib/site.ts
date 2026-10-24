import "server-only";
import { headers } from "next/headers";
import { type Platform, type PublicStats, type Release, type Releases, detectPlatform } from "./downloads";
import { api } from "./session";

/** The releases and totals the public pages show. Neither may hold a page up: each waits a short
 *  while and the page carries on without it. */
async function quick<T>(path: string, wait = 1500): Promise<T | null> {
  try {
    const response = await api(path, { signal: AbortSignal.timeout(wait) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export const loadReleases = () => quick<Releases>("/releases");
export const loadStats = () => quick<PublicStats>("/stats");

/** The platform the visitor's browser says it runs on. */
export async function visitorPlatform(): Promise<Platform | null> {
  const incoming = await headers();
  return detectPlatform(incoming.get("user-agent"), incoming.get("sec-ch-ua-platform"));
}

export interface History {
  macos: Release[] | null;
  desktop: Release[] | null;
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

/** Every release of both projects, for the changelog (GitHub can take a moment the first time). */
export const loadHistory = () => quick<History>("/releases/history", 4000);
/** The repositories' stars, forks and last push, for the projects page. */
export const loadProjects = () =>
  quick<{ repos: Record<string, RepoStats | null> }>("/projects", 4000).then(
    (answer) => answer?.repos ?? null,
  );

/** The site's address as the visitor reached it (any self-hosted AnyTogether too). */
export async function siteOrigin(): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const proto = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
