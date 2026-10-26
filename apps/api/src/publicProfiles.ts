import { ErrorCode, type PrivacySection, TitleId, shownPrivacy, trophyLevelOf } from "@anytogether/shared";
import type { Context, MiddlewareHandler, Next } from "hono";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { connectionBadges } from "./connections.js";
import { HttpError } from "./errors.js";
import { page, paging, readActivities } from "./feed.js";
import { libraryOf, trophiesOf, trophyCountsOf } from "./games.js";
import type { AuthVariables } from "./middleware.js";
import { type ProfileRow, areFriends, findProfile } from "./people.js";
import { clientIp, rateLimiter } from "./ratelimit.js";
import { lookOf, showcaseOf } from "./showcase.js";

/** Stands in for the reader of a signed-out request: no account has it, so no friendship or block
 *  matches and nothing is "mine". */
const nobody = "00000000-0000-0000-0000-000000000000";
const sections = ["library", "trophies"] as const;

/** The same answer without account IDs: a signed-out reader learns handles, never IDs. */
export function withoutIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutIds) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const kept: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) if (key !== "userId") kept[key] = withoutIds(inner);
    return kept as T;
  }
  return value;
}

/** Profiles for readers who are not signed in (link previews, a profile shared on Discord): the
 *  card, and the library, trophies and activity only where the person opened them to everyone.
 *  A request with an access token goes on to the signed-in routes, unchanged. Mounted before
 *  them, as every route anyone may call is. */
export function publicProfileRoutes(deps: Deps) {
  const app = new Hono();
  const limit = rateLimiter(deps.valkey, deps.limits);

  /** The person behind the handle, for a signed-out request; null when the request is signed in
   *  (or is not about a profile) and belongs to the routes after this one. */
  const owner = async (c: Context) => {
    if (c.req.header("authorization")) return null;
    const handle = c.req.param("handle") ?? "";
    if (handle === "search") return null;
    await limit("publicProfile", clientIp(c, deps.clientIpHeader));
    const profile = await findProfile(deps.db, handle);
    if (!profile) throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    return profile;
  };
  const open = (profile: ProfileRow, section: PrivacySection) =>
    shownPrivacy(profile.privacy, profile.publicProfile)[section] === "everyone";
  const opened = async (c: Context, section: (typeof sections)[number]) => {
    const profile = await owner(c);
    if (profile && !open(profile, section))
      throw new HttpError(403, ErrorCode.forbidden, "This is private", { section });
    return profile;
  };

  app.get("/users/:handle", async (c: Context, next: Next) => {
    const profile = await owner(c);
    if (!profile) return next();
    const visible = {
      library: open(profile, "library"),
      trophies: open(profile, "trophies"),
      friends: false,
      presence: false,
    };
    return c.json({
      handle: profile.handle,
      displayName: profile.displayName,
      avatar: profile.avatarUrl,
      bio: profile.bio,
      country: profile.country,
      friendship: "none",
      signedIn: false,
      publicProfile: profile.publicProfile,
      visible,
      connections: await connectionBadges(deps.db, profile.accountId),
      ...(visible.trophies ? { trophyCounts: await trophyCountsOf(deps.db, profile.accountId) } : {}),
      trophyLevel: visible.trophies ? trophyLevelOf(profile.trophyPoints) : null,
      ...(await lookOf(deps.db, deps.publicUrl, profile)),
    });
  });

  app.get("/users/:handle/showcase", async (c: Context, next: Next) => {
    const profile = await owner(c);
    if (!profile) return next();
    return c.json(await showcaseOf(deps.db, nobody, profile, "other"));
  });

  app.get("/users/:handle/library", async (c: Context, next: Next) => {
    const profile = await opened(c, "library");
    if (!profile) return next();
    return c.json(await libraryOf(deps.db, null, profile));
  });

  app.get("/users/:handle/trophies", async (c: Context, next: Next) => {
    const profile = await opened(c, "trophies");
    if (!profile) return next();
    const titleId = c.req.query("titleId");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    return c.json(await trophiesOf(deps.db, null, profile, titleId));
  });

  app.get("/users/:handle/activity", async (c: Context, next: Next) => {
    const profile = await owner(c);
    if (!profile) return next();
    const options = paging((name) => c.req.query(name));
    // As someone who is no friend: items whose section the person opened to everyone.
    const items = await readActivities(
      deps.db,
      nobody,
      { owner: profile.accountId, relation: "other" },
      options,
    );
    return c.json(withoutIds(page(items, options.limit)));
  });

  return app;
}

/** The keys of a profile answer a stranger still gets with the public profile off: who it is, and
 *  how they stand with the reader (to send a friend request). */
const minimalKeys = ["userId", "handle", "displayName", "avatar", "friendship", "signedIn"] as const;

/** The minimal card in place of a profile answer: the same keys as ever (launchers decode them),
 *  with everything past the name and picture empty. */
export function minimalCard(answer: Record<string, unknown>) {
  const kept: Record<string, unknown> = {};
  for (const key of minimalKeys) if (key in answer) kept[key] = answer[key];
  return {
    ...kept,
    bio: null,
    country: null,
    publicProfile: false,
    visible: { library: false, trophies: false, friends: false, presence: false },
    connections: [],
    trophyLevel: null,
    cover: null,
    accent: null,
  };
}

/** The public profile switch, for every profile answer at once: GET /users/:handle and everything
 *  under it (library, trophies, friends, activity, showcase, gallery, posts, trophy comparison,
 *  and whatever comes later), signed out or signed in. While the person has it off, a reader who
 *  is neither them nor an accepted friend gets the minimal card for the profile and 403
 *  (`section: "profile"`) for its parts. Mounted once on /users/:handle/* (which takes the card
 *  too) before the routes; it looks at their answer, so a 404 (no such handle, a block either way)
 *  stays exactly what it was. */
export function profileGate(
  deps: Pick<Deps, "db">,
): MiddlewareHandler<{ Variables: Partial<AuthVariables> }> {
  return async (c, next) => {
    await next();
    if (c.req.method !== "GET" || !c.res.ok) return;
    const handle = c.req.param("handle") ?? "";
    if (!handle || handle === "search") return;
    const profile = await findProfile(deps.db, handle);
    if (!profile || profile.publicProfile) return;
    const viewer = c.get("userId");
    if (viewer && (viewer === profile.accountId || (await areFriends(deps.db, viewer, profile.accountId))))
      return;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    headers.set("cache-control", "private, no-store");
    // /api/v1/users/<handle> is the card; anything after the handle is a part of the profile.
    const segments = c.req.path.split("/").filter(Boolean);
    const isCard = segments.length === segments.lastIndexOf("users") + 2;
    if (isCard && c.res.headers.get("content-type")?.startsWith("application/json")) {
      const answer = (await c.res.clone().json()) as Record<string, unknown>;
      c.res = new Response(JSON.stringify(minimalCard(answer)), { status: 200, headers });
      return;
    }
    // The code stays "forbidden" for the launchers that know it; `section` says why.
    const refusal = new HttpError(403, ErrorCode.forbidden, "This profile is private", {
      section: "profile",
    });
    headers.set("content-type", "application/problem+json");
    c.res = new Response(JSON.stringify(refusal.toProblem()), { status: 403, headers });
  };
}
