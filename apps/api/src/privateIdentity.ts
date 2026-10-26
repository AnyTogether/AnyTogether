import { accounts, profiles } from "@anytogether/db";
import type { PrivateIdentity } from "@anytogether/shared";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "./app.js";
import type { AuthVariables } from "./middleware.js";
import { noBlockBetween } from "./people.js";

/** The friends-only name and picture (see PrivateIdentity in the shared package and
 *  docs/private-identity.md). Nothing here is ever in a public answer, an admin list or a realtime
 *  event: only the answers that call `reveal` for their reader carry it, and only for people who
 *  are that reader or the reader's accepted friends with no block either way. */

type LinkDeps = Pick<Deps, "tokens" | "publicUrl">;
const windowMs = 6 * 3_600_000;

export const privateAvatarPath = (hash: string) => `/api/v1/avatars/private/${hash}.jpg`;

/** A signed link to a private picture that works until `expires` (unix seconds). */
export function signedAvatarLink(deps: LinkDeps, hash: string, expires: number) {
  const path = privateAvatarPath(hash);
  const signature = deps.tokens.signLink(`${path}\n${expires}`);
  return new URL(`${path}?e=${expires}&s=${signature}`, deps.publicUrl).toString();
}

/** The link handed to the owner and friends: the same for everyone in a six-hour window (so it
 *  caches), working 6 to 12 hours. An ended friendship stops getting new ones. */
export function privateAvatarLink(deps: LinkDeps, hash: string, now = Date.now()) {
  return signedAvatarLink(deps, hash, ((Math.floor(now / windowMs) + 2) * windowMs) / 1000);
}

/** Whether a private picture's link is genuine and still working. */
export function checkAvatarLink(deps: LinkDeps, hash: string, query: { e?: string; s?: string }) {
  const expires = Number(query.e);
  if (!Number.isInteger(expires) || !query.s) return "invalid" as const;
  if (!deps.tokens.checkLink(`${privateAvatarPath(hash)}\n${expires}`, query.s)) return "invalid" as const;
  return expires * 1000 < Date.now() ? ("expired" as const) : ("ok" as const);
}

/** The private fields of a profile, for its owner or a friend. */
export const identityOf = (
  deps: LinkDeps,
  profile: { privateName: string | null; privateAvatar: string | null },
): PrivateIdentity => ({
  privateName: profile.privateName ?? null,
  privateAvatar: profile.privateAvatar ? privateAvatarLink(deps, profile.privateAvatar) : null,
});

/** Of `ids`, the people whose private fields `viewer` may see (themselves, and accepted friends in
 *  good standing with no block either way), with those fields. */
export async function privateIdentities(
  deps: Pick<Deps, "db" | "tokens" | "publicUrl">,
  viewer: string,
  ids: string[],
): Promise<Map<string, PrivateIdentity>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return new Map();
  const rows = await deps.db
    .select({
      id: profiles.accountId,
      privateName: profiles.privateName,
      privateAvatar: profiles.privateAvatar,
    })
    .from(profiles)
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(
      and(
        inArray(profiles.accountId, unique),
        eq(accounts.status, "active"),
        or(
          eq(profiles.accountId, viewer),
          and(
            sql`exists (select 1 from friendships f where f.state = 'accepted'
              and ((f.user_a = ${viewer}::uuid and f.user_b = ${profiles.accountId})
                or (f.user_b = ${viewer}::uuid and f.user_a = ${profiles.accountId})))`,
            noBlockBetween(viewer, profiles.accountId),
          ),
        ),
      ),
    );
  return new Map(rows.map((row) => [row.id, identityOf(deps, row)]));
}

type Card = { userId: string; handle: string };
const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const isCard = (value: Record<string, unknown>): value is Card & Record<string, unknown> =>
  typeof value.userId === "string" && typeof value.handle === "string";

function collect(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) for (const item of value) collect(item, into);
  else if (isPlain(value)) {
    if (isCard(value)) into.add(value.userId);
    for (const inner of Object.values(value)) collect(inner, into);
  }
}

function attach<T>(value: T, found: Map<string, PrivateIdentity>): T {
  if (Array.isArray(value)) return value.map((item) => attach(item, found)) as T;
  if (!isPlain(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) copy[key] = attach(inner, found);
  const identity = isCard(value) ? found.get(value.userId) : undefined;
  return (identity ? { ...copy, ...identity } : copy) as T;
}

/** The answer for `viewer`, with the private fields added to every person card ({userId, handle,
 *  ...}) whose owner is the viewer or the viewer's friend. A copy: what was published to others
 *  is left as it was. Only for answers made for one signed-in reader. */
export async function reveal<T>(
  deps: Pick<Deps, "db" | "tokens" | "publicUrl">,
  viewer: string,
  value: T,
): Promise<T> {
  const ids = new Set<string>();
  collect(value, ids);
  if (!ids.size) return value;
  const found = await privateIdentities(deps, viewer, [...ids]);
  return found.size ? attach(value, found) : value;
}

/** The answers that carry private fields for their reader, and nothing else: friends, profiles
 *  opened signed in, parties, conversations and their messages, Play Together and other game
 *  sessions, communities, the feed and notifications. Public pages, showcases, discovery,
 *  leaderboards, admin pages, the export and realtime events never do. Keep this list and
 *  docs/private-identity.md in step. */
export const revealedPaths = [
  "/me/friends",
  "/users/search",
  "/users/:handle",
  "/users/:handle/friends",
  "/users/:handle/activity",
  "/me/party",
  "/parties/:id",
  "/parties/:id/*",
  "/me/conversations",
  "/conversations",
  "/conversations/:id",
  "/conversations/:id/*",
  "/me/game-session",
  "/game-sessions",
  "/game-sessions/:id",
  "/game-sessions/:id/*",
  "/communities",
  "/communities/:id",
  "/communities/:id/*",
  "/me/communities",
  "/me/feed",
  "/me/notifications",
] as const;

/** Adds the private fields to a signed-in reader's JSON answer (see reveal). A signed-out request
 *  (a public profile) has no reader and is left alone. */
export function revealMiddleware(
  deps: Pick<Deps, "db" | "tokens" | "publicUrl">,
): MiddlewareHandler<{ Variables: Partial<AuthVariables> }> {
  return async (c, next) => {
    await next();
    const viewer = c.get("userId");
    if (!viewer || !c.res.ok || !c.res.headers.get("content-type")?.startsWith("application/json")) return;
    const answer = await c.res.clone().json();
    const revealed = await reveal(deps, viewer, answer);
    if (revealed === answer) return;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(JSON.stringify(revealed), { status: c.res.status, headers });
  };
}
