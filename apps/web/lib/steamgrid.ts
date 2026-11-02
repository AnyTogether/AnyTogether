import "server-only";

/** Game art from SteamGridDB (steamgriddb.com) for games whose launcher sent no icon: a square
 *  picture found by the game's name. Asked only from the website's server, with the key in
 *  STEAMGRIDDB_API_KEY (no key: nothing is asked and games keep their letter). Each name is asked
 *  once and the answer, found or not, is kept in memory for weeks, so a page view asks nothing. */

const api = "https://www.steamgriddb.com/api/v2";
const foundFor = 30 * 86_400_000;
const missedFor = 3 * 86_400_000;
const failedFor = 10 * 60_000;
const maxKept = 5000;
/** A page waits this long at most; an answer that comes later is still kept for next time. */
const waitMs = 1500;

type Kept = { url: string | null; until: number };
const kept = new Map<string, Kept>();
const asking = new Map<string, Promise<string | null>>();

/** "Marvel's Spider-Man 2™ (PS5)" → "marvel's spider-man 2": what is searched for and kept by. */
export function searchName(name: string) {
  return name
    .replace(/[™®©]/g, "")
    .replace(/\((?:ps[45]|playstation\s*[45])\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function keep(name: string, url: string | null, ms: number) {
  if (kept.size >= maxKept) kept.delete(kept.keys().next().value as string);
  kept.set(name, { url, until: Date.now() + ms });
}

async function ask<T>(path: string, key: string): Promise<T | null> {
  const response = await fetch(`${api}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`steamgriddb ${response.status}`);
  const body = (await response.json()) as { success?: boolean; data?: T };
  return body.success ? (body.data ?? null) : null;
}

type Picture = { url?: string; thumb?: string; nsfw?: boolean; humor?: boolean };

async function lookUp(name: string, key: string): Promise<string | null> {
  const games = await ask<{ id: number; name: string }[]>(
    `/search/autocomplete/${encodeURIComponent(name)}`,
    key,
  );
  const game = games?.[0];
  if (!game) return null;
  const clean = (list: Picture[] | null) =>
    (list ?? []).find((p) => !p.nsfw && !p.humor && (p.thumb || p.url));
  // A square grid reads best at tile size; else the game's icon.
  const square = clean(
    await ask<Picture[]>(
      `/grids/game/${game.id}?dimensions=512x512,1024x1024&types=static&nsfw=false&humor=false`,
      key,
    ),
  );
  const picture =
    square ?? clean(await ask<Picture[]>(`/icons/game/${game.id}?types=static&nsfw=false&humor=false`, key));
  const url = picture?.thumb || picture?.url || null;
  return url?.startsWith("https://") ? url : null;
}

/** The picture for one game name, or null: from memory, else asked (once at a time per name). */
export async function gameArt(name: string, key = process.env.STEAMGRIDDB_API_KEY): Promise<string | null> {
  const wanted = searchName(name);
  // A game known only by its title ID (PPSA01234) has no name to search for.
  if (!key || wanted.length < 2 || /^[a-z]{4}\d{5}$/.test(wanted)) return null;
  const known = kept.get(wanted);
  if (known && known.until > Date.now()) return known.url;
  let pending = asking.get(wanted);
  if (!pending) {
    pending = lookUp(wanted, key)
      .then((url) => {
        keep(wanted, url, url ? foundFor : missedFor);
        return url;
      })
      .catch(() => {
        keep(wanted, null, failedFor);
        return null;
      })
      .finally(() => asking.delete(wanted));
    asking.set(wanted, pending);
  }
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
  return Promise.race([pending, late]);
}

/** The games with a picture where they had none: their own icon first, then SteamGridDB's. */
export async function withArt<T extends { iconUrl: string | null; titleId: string }>(
  games: T[],
  nameOf: (game: T) => string,
  limit = 12,
): Promise<T[]> {
  if (!process.env.STEAMGRIDDB_API_KEY) return games;
  const missing = games.filter((game) => !game.iconUrl).slice(0, limit);
  if (!missing.length) return games;
  const found = new Map(
    await Promise.all(missing.map(async (game) => [game.titleId, await gameArt(nameOf(game))] as const)),
  );
  return games.map((game) => (game.iconUrl ? game : { ...game, iconUrl: found.get(game.titleId) ?? null }));
}

/** For tests: forget every kept answer. */
export function forgetArt() {
  kept.clear();
  asking.clear();
}
