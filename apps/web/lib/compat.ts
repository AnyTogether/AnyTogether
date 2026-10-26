/** The compatibility list as the API shows it (the website keeps its own copy of the shapes). */
export type CompatStatus = "nothing" | "boots" | "menus" | "ingame" | "playable";
export type CompatPlatform = "macos" | "windows" | "linux";
export const compatStatuses: CompatStatus[] = ["playable", "ingame", "menus", "boots", "nothing"];
export const compatPlatforms: CompatPlatform[] = ["macos", "windows", "linux"];
export const platformNames: Record<CompatPlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export type CompatOnline = "works" | "broken";
export const compatOnline: CompatOnline[] = ["works", "broken"];
/** The list's order: the latest report first (the API's default), by name, or best status first. */
export type CompatSort = "updated" | "name" | "status";
export const compatSorts: CompatSort[] = ["updated", "name", "status"];

export interface CompatSummary {
  status: CompatStatus;
  version: string;
  testedAt: string;
  reports: number;
  /** What most said about online play; null (or missing, from an older API) when nobody tried. */
  online?: CompatOnline | null;
}

export interface CompatGame {
  titleId: string;
  name: string | null;
  names: Record<string, string>;
  iconUrl: string | null;
  platforms: Partial<Record<CompatPlatform, CompatSummary>>;
}

export interface CompatReportView {
  id: string;
  platform: CompatPlatform;
  status: CompatStatus;
  launcherVersion: string;
  engineVersion: string | null;
  gameVersion: string | null;
  machine: string | null;
  os: string | null;
  fpsAvg: number | null;
  online?: CompatOnline | null;
  note: string | null;
  createdAt: string;
  mine: boolean;
}

export const isTitleId = (value: string) => /^[A-Z]{4}[0-9]{5}$/.test(value);

/** What /compatibility shows, all of it in the address so a view can be shared and the back
 *  button works: the platform, a status, online play, the order, the search and how many. */
export interface CompatView {
  platform: CompatPlatform | null;
  status: CompatStatus | null;
  online: boolean;
  sort: CompatSort;
  q: string;
  n: number;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The view from the address's query; anything unknown is left at its default. */
export function compatView(query: Record<string, string | string[] | undefined>): CompatView {
  const pick = <T extends string>(list: readonly T[], value: string | undefined) =>
    list.find((item) => item === value) ?? null;
  return {
    platform: pick(compatPlatforms, first(query.platform)),
    status: pick(compatStatuses, first(query.status)),
    online: first(query.online) === "works",
    sort: pick(compatSorts, first(query.sort)) ?? "updated",
    q: (first(query.q) ?? "").trim().slice(0, 80),
    n: Math.min(Math.max(Number(first(query.n)) || 50, 50), 500),
  };
}

/** The address of the view with `change` made; defaults are left out, and changing a filter or
 *  the order starts again from the top of the list. */
export function compatHref(view: CompatView, change: Partial<CompatView> = {}) {
  const next = { ...view, ...change };
  const filtersChanged = (["platform", "status", "online", "sort", "q"] as const).some(
    (key) => key in change && change[key] !== view[key],
  );
  const out = new URLSearchParams();
  if (next.platform) out.set("platform", next.platform);
  if (next.status) out.set("status", next.status);
  if (next.online) out.set("online", "works");
  if (next.sort !== "updated") out.set("sort", next.sort);
  if (next.q) out.set("q", next.q);
  if (!filtersChanged && next.n > 50) out.set("n", String(next.n));
  return `/compatibility${out.size ? `?${out}` : ""}`;
}

/** The API query for a view (the list asks for pages of 100). */
export function compatQuery(view: CompatView) {
  return new URLSearchParams({
    limit: "100",
    ...(view.q ? { q: view.q } : {}),
    ...(view.platform ? { platform: view.platform } : {}),
    ...(view.status ? { status: view.status } : {}),
    ...(view.online ? { online: "works" } : {}),
    ...(view.sort !== "updated" ? { sort: view.sort } : {}),
  });
}

/** Online play works on one of the platforms shown. */
export const onlineWorks = (game: CompatGame, platforms: CompatPlatform[]) =>
  platforms.some((platform) => game.platforms[platform]?.online === "works");
