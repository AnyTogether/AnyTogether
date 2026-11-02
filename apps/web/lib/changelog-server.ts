import "server-only";
import { type Entry, changelogEntries } from "./changelog";
import { kept } from "./kept";
import { notesToHtml } from "./markdown";
import { apiUrl } from "./session";
import type { History } from "./site";

/** A changelog entry with its notes already turned into safe HTML. */
export interface ShownEntry extends Entry {
  html: string;
}
export interface ChangelogData {
  entries: ShownEntry[];
  /** Which projects GitHub told about (through the API). */
  reached: { macos: boolean; desktop: boolean };
}

/** Both projects' releases, fetched from the API and rendered from Markdown once, then kept in
 *  memory for a quarter of an hour (the API keeps GitHub's answer as long). The page and the
 *  notes route read this copy, so no visit waits for the API or for the Markdown, and filtering
 *  needs no new answer at all. The API holds the only link to GitHub and its own cache, so this
 *  adds no GitHub calls. */
async function load(): Promise<ChangelogData> {
  const response = await fetch(`${apiUrl()}/api/v1/releases/history`, {
    cache: "no-store",
    headers: { "anytogether-client": "web/0.1" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`The API answered ${response.status}`);
  const history = (await response.json()) as History;
  // Nothing from either project is not worth keeping: ask again on the next visit.
  if (!history.macos && !history.desktop) throw new Error("GitHub did not answer");
  const entries = changelogEntries(history).map(({ release, ...rest }) => {
    const { notes, ...withoutNotes } = release;
    const markdown = notes?.trim() ?? "";
    return { ...rest, release: withoutNotes, html: markdown ? notesToHtml(markdown, release.repo) : "" };
  });
  return { entries, reached: { macos: !!history.macos, desktop: !!history.desktop } };
}

export const changelogData = kept(load, 15 * 60_000);

/** The kept changelog, or null when the API (or GitHub behind it) has not answered yet. */
export const loadChangelog = () => changelogData().catch(() => null);
