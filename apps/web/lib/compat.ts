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
  /** Set when the verdict is the upstream AnyPS5 project's thread for the game. */
  upstream?: string;
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

/** Windows and Linux from the upstream AnyPS5 project's game bring-up threads (GET
 *  /compat/upstream): one thread per title ID, its "Furthest point" as the status. */
export interface UpstreamGame {
  titleId: string;
  name: string;
  url: string;
  status: Exclude<CompatStatus, "playable"> | null;
  platforms: ("windows" | "linux")[];
  replies: number;
  updatedAt: string;
}
export interface UpstreamList {
  available: boolean;
  source: string;
  fetchedAt: string | null;
  games: UpstreamGame[];
}
export const upstreamPlatforms: CompatPlatform[] = ["windows", "linux"];
export const upstreamBringUp = "https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up";

/** Where a Windows or Linux report goes: the game's thread when there is one, else the category,
 *  searched for its title ID (the form there asks to look first). */
export function upstreamReportUrl(titleId: string | null, thread?: string | null) {
  if (thread) return thread;
  return isTitleId(titleId ?? "") ? `${upstreamBringUp}?discussions_q=${titleId}` : upstreamBringUp;
}

/** The upstream threads by title ID, for the platforms each one covers. */
export function upstreamByTitle(list: UpstreamList | null) {
  return new Map((list?.available ? list.games : []).map((game) => [game.titleId, game]));
}

/** A game's row with Windows and Linux taken from upstream where its thread covers them; our own
 *  reports stay where upstream has nothing. */
export function withUpstream(game: CompatGame, upstream: UpstreamGame | undefined): CompatGame {
  if (!upstream?.status) return game;
  const platforms = { ...game.platforms };
  for (const p of upstream.platforms)
    platforms[p] = {
      status: upstream.status,
      version: "AnyPS5",
      testedAt: upstream.updatedAt,
      reports: upstream.replies + 1,
      online: null,
      upstream: upstream.url,
    };
  return { ...game, platforms };
}

/** The upstream list as /compatibility shows it for Windows or Linux: that platform's threads,
 *  searched, with a status filter, in the page's order. */
export function upstreamView(
  list: UpstreamList | null,
  view: Pick<CompatView, "platform" | "status" | "sort" | "q">,
): UpstreamGame[] {
  const q = view.q.trim().toLowerCase();
  const rank: Record<string, number> = { ingame: 0, menus: 1, boots: 2, nothing: 3 };
  return (list?.games ?? [])
    .filter((game) => !view.platform || game.platforms.includes(view.platform as "windows" | "linux"))
    .filter((game) => !view.status || game.status === view.status)
    .filter((game) => !q || game.name.toLowerCase().includes(q) || game.titleId.toLowerCase().includes(q))
    .sort((a, b) =>
      view.sort === "name"
        ? a.name.localeCompare(b.name)
        : view.sort === "status"
          ? (rank[a.status ?? ""] ?? 4) - (rank[b.status ?? ""] ?? 4) || a.name.localeCompare(b.name)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
}

/** A row of the list: our game (its page here), or one only the upstream project has (its thread
 *  there). */
export type CompatRow = CompatGame & { href: string; external: boolean };

/** The "All" list with the upstream project's games added: our games with Windows and Linux from
 *  upstream where it has them, then every game only upstream has, filtered and in the view's
 *  order like the rest. */
export function mergedRows(
  ours: CompatGame[],
  list: UpstreamList | null,
  view: Pick<CompatView, "status" | "sort" | "q">,
): CompatRow[] {
  const threads = upstreamByTitle(list);
  const known = new Set(ours.map((game) => game.titleId));
  const rows: CompatRow[] = ours.map((game) => ({
    ...withUpstream(game, threads.get(game.titleId)),
    href: `/compatibility/${game.titleId}`,
    external: false,
  }));
  for (const thread of upstreamView(list, { platform: null, status: null, sort: view.sort, q: view.q })) {
    if (known.has(thread.titleId) || !thread.status) continue;
    rows.push({
      ...withUpstream(
        {
          titleId: thread.titleId,
          name: thread.name,
          names: { en: thread.name },
          iconUrl: null,
          platforms: {},
        },
        thread,
      ),
      href: thread.url,
      external: true,
    });
  }
  const order = ["nothing", "boots", "menus", "ingame", "playable"];
  const best = (row: CompatRow) =>
    Math.max(-1, ...Object.values(row.platforms).map((s) => order.indexOf(s?.status ?? "")));
  const latest = (row: CompatRow) =>
    Object.values(row.platforms).reduce((max, s) => (s && s.testedAt > max ? s.testedAt : max), "");
  const name = (row: CompatRow) => (row.names.en ?? row.name ?? row.titleId).toLowerCase();
  return rows
    .filter((row) => !view.status || Object.values(row.platforms).some((s) => s?.status === view.status))
    .sort((a, b) =>
      view.sort === "name"
        ? name(a).localeCompare(name(b))
        : view.sort === "status"
          ? best(b) - best(a) || latest(b).localeCompare(latest(a))
          : latest(b).localeCompare(latest(a)),
    );
}
