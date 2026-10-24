import type { Release } from "./downloads";

/** The changelog's list: both projects' releases together, newest first. Pure, for the tests. */

export type Project = "macos" | "desktop";
export const projects: Project[] = ["macos", "desktop"];

export interface Entry {
  project: Project;
  release: Release;
  /** The project's newest release that is not a pre-release. */
  latest: boolean;
  /** For links to one release: "macos-0.2.15". */
  anchor: string;
}

/** The ?project= of the page's address, when it names one. */
export function pickProject(value: string | string[] | undefined): Project | null {
  const one = Array.isArray(value) ? value[0] : value;
  return projects.includes(one as Project) ? (one as Project) : null;
}

export function changelogEntries(
  history: Partial<Record<Project, Release[] | null>> | null,
  only: Project | null = null,
): Entry[] {
  const entries: Entry[] = [];
  for (const project of projects) {
    if (only && project !== only) continue;
    const releases = history?.[project] ?? [];
    const newest = releases.find((r) => !r.prerelease);
    for (const release of releases)
      entries.push({
        project,
        release,
        latest: release === newest,
        anchor: `${project}-${release.version.replace(/[^\w.-]/g, "")}`,
      });
  }
  const time = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return entries.sort((a, b) => time(b.release.publishedAt) - time(a.release.publishedAt));
}
