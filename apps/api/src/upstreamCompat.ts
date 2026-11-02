import type { Redis } from "ioredis";

/** Windows and Linux compatibility from the upstream AnyPS5 project (boykopovar/AnyPS5): its
 *  "Game bring-up" discussions, one thread per title ID, where reports for those platforms go.
 *  Read with GitHub's GraphQL API (it needs GITHUB_TOKEN; without one there is nothing to read),
 *  kept in Valkey for six hours and the last good list for a week, so a page view asks GitHub
 *  nothing. A thread's "Furthest point" (the discussion form's dropdown) is its status. */

export const upstreamRepo = { owner: "boykopovar", name: "AnyPS5" } as const;
export const upstreamCategory = "game-bring-up";
export const upstreamCategoryUrl = `https://github.com/${upstreamRepo.owner}/${upstreamRepo.name}/discussions/categories/${upstreamCategory}`;

export type UpstreamStatus = "nothing" | "boots" | "menus" | "ingame";
export type UpstreamPlatform = "windows" | "linux";

export interface UpstreamGame {
  titleId: string;
  name: string;
  url: string;
  /** From the thread's "Furthest point"; null when the thread does not use the form. */
  status: UpstreamStatus | null;
  /** What the first report says it ran on; both when it does not say. */
  platforms: UpstreamPlatform[];
  replies: number;
  updatedAt: string;
}

export interface UpstreamList {
  source: string;
  fetchedAt: string;
  games: UpstreamGame[];
}

const key = "upstream-compat:v1";
const fresh = 6 * 3600;
const stale = 7 * 86_400;
const pages = 10;

/** The form's choices, as GitHub writes them into the thread's body. */
const reached: [RegExp, UpstreamStatus][] = [
  [/^in[ -]?game/i, "ingame"],
  [/^menu/i, "menus"],
  [/^logos?\b|loading/i, "boots"],
  [/^stops before|^does not convert/i, "nothing"],
];

/** The text under a "### Heading" of a discussion form's body. */
function field(body: string, heading: string) {
  const at = new RegExp(`^#{2,4}\\s*${heading}\\s*$`, "im").exec(body);
  if (!at) return null;
  const rest = body.slice(at.index + at[0].length);
  const end = rest.search(/^#{2,4}\s/m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

export function statusOfThread(body: string): UpstreamStatus | null {
  const value = field(body, "Furthest point")?.split("\n")[0]?.trim() ?? "";
  if (!value || value === "_No response_") return null;
  return reached.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function platformsOfThread(title: string, body: string): UpstreamPlatform[] {
  const system = `${title}\n${field(body, "System tested") ?? body.slice(0, 600)}`;
  const windows = /\bwindows\b|\bwin1[01]\b/i.test(system);
  const linux = /\blinux\b|\barch\b|ubuntu|fedora|debian|steamos|mesa|radv|proton|bazzite|nixos/i.test(
    system,
  );
  if (windows && !linux) return ["windows"];
  if (linux && !windows) return ["linux"];
  return ["windows", "linux"];
}

/** "Astro Bot (PPSA21564)" → the title ID and the name; null for a thread without one. */
export function gameOfThread(title: string, body: string): { titleId: string; name: string } | null {
  const id = /\b([A-Z]{4}\d{5})\b/.exec(title) ?? /\b([A-Z]{4}\d{5})\b/.exec(field(body, "Title") ?? "");
  if (!id?.[1]) return null;
  const name =
    title
      .replace(/\(\s*[A-Z]{4}\d{5}\s*\)/, "")
      .replace(/\b[A-Z]{4}\d{5}\b/, "")
      .replace(/\s+(on|—|-|–)\s+(linux|windows).*$/i, "")
      .replace(/[\s:—–-]+$/, "")
      .trim() || id[1];
  return { titleId: id[1], name: name.slice(0, 120) };
}

type Node = {
  title: string;
  url: string;
  body: string;
  updatedAt: string;
  comments: { totalCount: number };
};

async function read(fetcher: typeof fetch, token: string): Promise<UpstreamGame[]> {
  const ask = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "AnyTogether",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const answer = (await response.json()) as { data?: unknown; errors?: unknown };
    if (answer.errors || !answer.data) throw new Error("GitHub GraphQL refused the query");
    return answer.data as Record<string, unknown>;
  };
  const category = (await ask(
    "query($owner:String!,$name:String!,$slug:String!){repository(owner:$owner,name:$name){discussionCategory(slug:$slug){id}}}",
    { ...upstreamRepo, slug: upstreamCategory },
  )) as { repository?: { discussionCategory?: { id?: string } | null } | null };
  const categoryId = category.repository?.discussionCategory?.id;
  if (!categoryId) throw new Error("no game bring-up category");
  const byId = new Map<string, UpstreamGame>();
  let cursor: string | null = null;
  for (let page = 0; page < pages; page++) {
    const data = (await ask(
      "query($owner:String!,$name:String!,$category:ID!,$after:String){repository(owner:$owner,name:$name){discussions(first:100,after:$after,categoryId:$category,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{title url body updatedAt comments{totalCount}}}}}",
      { ...upstreamRepo, category: categoryId, after: cursor },
    )) as {
      repository?: {
        discussions?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] };
      };
    };
    const list = data.repository?.discussions;
    if (!list) break;
    for (const node of list.nodes) {
      const game = gameOfThread(node.title, node.body);
      // Newest first: the first thread of a title ID is the one kept.
      if (!game || byId.has(game.titleId) || !node.url.startsWith("https://github.com/")) continue;
      byId.set(game.titleId, {
        ...game,
        url: node.url,
        status: statusOfThread(node.body),
        platforms: platformsOfThread(node.title, node.body),
        replies: node.comments.totalCount,
        updatedAt: node.updatedAt,
      });
    }
    if (!list.pageInfo.hasNextPage) break;
    cursor = list.pageInfo.endCursor;
  }
  return [...byId.values()];
}

/** The list, from Valkey or GitHub; null when there is no token or GitHub never answered. */
export async function upstreamCompat(deps: {
  valkey: Redis;
  githubToken?: string | undefined;
  githubFetch?: typeof fetch | undefined;
}): Promise<UpstreamList | null> {
  const kept = await deps.valkey.get(key);
  if (kept) return JSON.parse(kept);
  if (!deps.githubToken) return null;
  // One process asks at a time; the others use the last good list (or none) meanwhile.
  if ((await deps.valkey.set(`${key}:lock`, "1", "EX", 60, "NX")) !== "OK") {
    const old = await deps.valkey.get(`${key}:stale`);
    return old ? JSON.parse(old) : null;
  }
  try {
    const games = await read(deps.githubFetch ?? fetch, deps.githubToken);
    const list: UpstreamList = { source: upstreamCategoryUrl, fetchedAt: new Date().toISOString(), games };
    const text = JSON.stringify(list);
    await deps.valkey.multi().set(key, text, "EX", fresh).set(`${key}:stale`, text, "EX", stale).exec();
    return list;
  } catch (error) {
    console.error("upstream compatibility failed", error);
    const old = await deps.valkey.get(`${key}:stale`);
    if (old) {
      // Asked again in ten minutes, not on every view while GitHub is away.
      await deps.valkey.set(key, old, "EX", 600);
      return JSON.parse(old);
    }
    return null;
  } finally {
    await deps.valkey.del(`${key}:lock`);
  }
}
