import { ErrorCode, type PrivacySection, TitleId, privacyOf } from "@anytogether/shared";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { page, paging, readActivities } from "./feed.js";
import { libraryOf, trophiesOf, trophyCountsOf } from "./games.js";
import { findProfile } from "./people.js";
import { clientIp, rateLimiter } from "./ratelimit.js";

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
  const open = (privacy: unknown, section: PrivacySection) => privacyOf(privacy)[section] === "everyone";
  const opened = async (c: Context, section: (typeof sections)[number]) => {
    const profile = await owner(c);
    if (profile && !open(profile.privacy, section))
      throw new HttpError(403, ErrorCode.forbidden, "This is private", { section });
    return profile;
  };

  app.get("/users/:handle", async (c: Context, next: Next) => {
    const profile = await owner(c);
    if (!profile) return next();
    const visible = {
      library: open(profile.privacy, "library"),
      trophies: open(profile.privacy, "trophies"),
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
      visible,
      ...(visible.trophies ? { trophyCounts: await trophyCountsOf(deps.db, profile.accountId) } : {}),
    });
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
