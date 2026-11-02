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

/** A nightly build of main ("0.2.20-arm-nightly.20261025.3"). */
export const isNightly = (release: Release) =>
  /nightly/i.test(release.version) || /nightly/i.test(release.tag);

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
    // Nightly builds of main are for the Nightly update channel, not the changelog.
    const releases = (history?.[project] ?? []).filter((r) => !isNightly(r));
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

/** How many releases at the top of the list show their notes open. */
export const openFirst = 3;

/** The releases whose notes come with the page: each project's newest few, so the top of the list
 *  is complete under any filter. The others' notes load when they are opened. */
export function eagerAnchors(entries: Entry[], perProject = openFirst): Set<string> {
  const seen: Partial<Record<Project, number>> = {};
  const eager = new Set<string>();
  for (const entry of entries) {
    const n = seen[entry.project] ?? 0;
    if (n < perProject) eager.add(entry.anchor);
    seen[entry.project] = n + 1;
  }
  return eager;
}

/** The releases shown open under a filter: the first few that match it. */
export function openAnchors(entries: Entry[], only: Project | null, count = openFirst): Set<string> {
  return new Set(
    entries
      .filter((entry) => !only || entry.project === only)
      .slice(0, count)
      .map((entry) => entry.anchor),
  );
}
