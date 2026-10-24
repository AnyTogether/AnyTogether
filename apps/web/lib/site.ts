import "server-only";
import { headers } from "next/headers";
import { type Platform, type PublicStats, type Releases, detectPlatform } from "./downloads";
import { api } from "./session";

/** The releases and totals the public pages show. Neither may hold a page up: each waits a short
 *  while and the page carries on without it. */
async function quick<T>(path: string): Promise<T | null> {
  try {
    const response = await api(path, { signal: AbortSignal.timeout(1500) });
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
