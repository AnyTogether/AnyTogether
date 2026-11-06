import { accounts, apiTokens, games } from "@anytogether/db";
import {
  type ApiScope,
  ApiTokenCreate,
  type ApiTokenCreated,
  type ApiTokenView,
  ErrorCode,
  type GameBoard,
  type PrivacySection,
  TitleId,
  apiTokenPrefix,
  gameBoards,
  maxApiTokens,
  maxLeaderboardEntries,
  shownPrivacy,
  trophyLevelOf,
} from "@anytogether/shared";
import { and, count, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { type ChallengeService, stateOf } from "./challenges.js";
import { connectionBadges } from "./connections.js";
import { HttpError } from "./errors.js";
import { libraryOf, trophiesOf, trophyCountsOf } from "./games.js";
import { body } from "./http.js";
import { type Board, gameBoard, globalBoards, pointsBoard } from "./leaderboards.js";
import { levelsFor } from "./level.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { type ProfileRow, blockedBetween, findProfile, people } from "./people.js";
import openapi from "./publicApi.openapi.json" with { type: "json" };
import { minimalCard, withoutIds } from "./publicProfiles.js";
import { rateCounter, rateLimiter } from "./ratelimit.js";
import { lookOf } from "./showcase.js";
import { hash, secret } from "./tokens.js";

type TokenRow = typeof apiTokens.$inferSelect;
type PublicVariables = { token: TokenRow };

const viewOf = (row: TokenRow): ApiTokenView => ({
  id: row.id,
  name: row.name,
  start: row.start,
  scopes: row.scopes as ApiScope[],
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Personal API tokens, made and revoked in the account settings with a signed-in session. */
export function apiTokenRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("/me/api-tokens", requireUser(deps));
  app.use("/me/api-tokens/*", requireUser(deps));
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);

  app.get("/me/api-tokens", async (c) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.accountId, c.get("userId")))
      .orderBy(apiTokens.createdAt);
    return c.json({ tokens: rows.map(viewOf), max: maxApiTokens });
  });

  app.post("/me/api-tokens", async (c) => {
    const me = c.get("userId");
    const input = await body(c, ApiTokenCreate);
    const [held] = await db.select({ n: count() }).from(apiTokens).where(eq(apiTokens.accountId, me));
    if ((held?.n ?? 0) >= maxApiTokens)
      throw new HttpError(409, ErrorCode.conflict, `At most ${maxApiTokens} tokens; revoke one first`);
    await limit("apiToken", me);
    const token = `${apiTokenPrefix}${secret(32)}`;
    const [row] = await db
      .insert(apiTokens)
      .values({
        id: uuidv7(),
        accountId: me,
        name: input.name,
        tokenHash: hash(token),
        start: token.slice(0, 8),
        scopes: input.scopes,
      })
      .returning();
    const made: ApiTokenCreated = { ...viewOf(row as TokenRow), token };
    return c.json(made, 201);
  });

  app.delete("/me/api-tokens/:id", async (c) => {
    const me = c.get("userId");
    const id = c.req.param("id");
    await limit("apiToken", me);
    const removed = isId(id)
      ? await db
          .delete(apiTokens)
          .where(and(eq(apiTokens.id, id), eq(apiTokens.accountId, me)))
          .returning({ id: apiTokens.id })
      : [];
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "No such token");
    return c.body(null, 204);
  });

  return app;
}

/** CORS for the public API: any site's page may read it (it takes no cookies, only a token). */
const cors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "Authorization, Content-Type",
        "access-control-max-age": "86400",
      },
    });
  await next();
  c.res.headers.set("access-control-allow-origin", "*");
  c.res.headers.set(
    "access-control-expose-headers",
    "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  );
};

/** The read-only public API under /public: what anyone could see signed out (public profiles and
 *  the parts opened to everyone, the global leaderboards, challenges made for everyone), read with
 *  a personal API token. People blocked either way with the token's owner are left out. Answers
 *  carry handles, never account IDs. */
export function publicApiRoutes(deps: Deps, challengeService: ChallengeService) {
  const app = new Hono<{ Variables: PublicVariables }>();
  const { db, valkey } = deps;
  const counter = rateCounter(valkey, deps.limits);
  const boards = globalBoards(deps);
  const { cards } = people(db);

  app.use("/public/*", cors);
  // The document needs no token.
  app.get("/public/openapi.json", (c) => {
    c.header("cache-control", "public, max-age=3600");
    return c.json(openapi);
  });

  /** A valid token of an account in good standing; each request counts against the token's
   *  minute and day and the account's minute, and the headers say how many are left. */
  const authenticate: MiddlewareHandler<{ Variables: PublicVariables }> = async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!given.startsWith(apiTokenPrefix))
      throw new HttpError(
        401,
        ErrorCode.unauthorized,
        "An API token is needed (Authorization: Bearer atp_...)",
      );
    const [found] = await db
      .select({ token: apiTokens })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(and(eq(apiTokens.tokenHash, hash(given)), eq(accounts.status, "active")));
    if (!found) throw new HttpError(401, ErrorCode.unauthorized, "This API token is not valid");
    const token = found.token;
    const minute = await counter("publicApi", token.id);
    await counter("publicApiAccount", token.accountId);
    await counter("publicApiDay", token.id);
    c.header("ratelimit-limit", String(minute.limit));
    c.header("ratelimit-remaining", String(minute.remaining));
    c.header("ratelimit-reset", String(minute.reset));
    // When it was last used, written at most once a minute.
    if (await valkey.set(`api:used:${token.id}`, "1", "EX", 60, "NX"))
      await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
    c.set("token", token);
    await next();
  };
  app.use("/public/*", authenticate);

  const need = (c: Context<{ Variables: PublicVariables }>, scope: ApiScope) => {
    if (!(c.get("token").scopes as string[]).includes(scope))
      throw new HttpError(403, ErrorCode.forbidden, `This token cannot read that; it needs ${scope}`, {
        scope,
      });
  };
  const owner = (c: Context<{ Variables: PublicVariables }>) => c.get("token").accountId;
  const query = (c: Context, name: string) => c.req.query(name);
  const limitOf = (c: Context) => {
    const raw = query(c, "limit");
    const limit = raw === undefined ? maxLeaderboardEntries : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLeaderboardEntries)
      throw new HttpError(400, ErrorCode.badRequest, `limit: 1 to ${maxLeaderboardEntries}`);
    return limit;
  };

  app.get("/public/token", (c) => {
    const token = c.get("token");
    return c.json({ name: token.name, scopes: token.scopes, createdAt: token.createdAt.toISOString() });
  });

  // Profiles, as a signed-out reader sees them.
  const person = async (c: Context<{ Variables: PublicVariables }>) => {
    need(c, "profiles:read");
    const profile = await findProfile(db, c.req.param("handle") ?? "");
    if (!profile || (await blockedBetween(db, owner(c), profile.accountId)))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    return profile;
  };
  const open = (profile: ProfileRow, section: PrivacySection) =>
    shownPrivacy(profile.privacy, profile.publicProfile)[section] === "everyone";
  const opened = async (c: Context<{ Variables: PublicVariables }>, section: "library" | "trophies") => {
    const profile = await person(c);
    if (!profile.publicProfile)
      throw new HttpError(403, ErrorCode.forbidden, "This profile is private", { section: "profile" });
    if (!open(profile, section))
      throw new HttpError(403, ErrorCode.forbidden, "This is private", { section });
    return profile;
  };

  app.get("/public/users/:handle", async (c) => {
    const profile = await person(c);
    const visible = {
      library: open(profile, "library"),
      trophies: open(profile, "trophies"),
      friends: false,
      presence: false,
    };
    const card = {
      handle: profile.handle,
      displayName: profile.displayName,
      avatar: profile.avatarUrl,
      bio: profile.bio,
      country: profile.country,
      publicProfile: profile.publicProfile,
      visible,
      connections: await connectionBadges(db, profile.accountId),
      ...(visible.trophies ? { trophyCounts: await trophyCountsOf(db, profile.accountId) } : {}),
      trophyLevel: visible.trophies ? trophyLevelOf(profile.trophyPoints) : null,
      ...(await lookOf(db, deps.publicUrl, profile)),
    };
    return c.json(withoutIds(profile.publicProfile ? card : minimalCard(card)));
  });

  app.get("/public/users/:handle/library", async (c) => {
    const profile = await opened(c, "library");
    return c.json(withoutIds(await libraryOf(db, null, profile)));
  });

  app.get("/public/users/:handle/trophies", async (c) => {
    const profile = await opened(c, "trophies");
    const titleId = query(c, "titleId");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    return c.json(withoutIds(await trophiesOf(db, null, profile, titleId)));
  });

  // Games and the global leaderboards.
  const gameRow = async (titleId: string | undefined) => {
    const parsed = TitleId.safeParse(titleId);
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const [game] = await db.select().from(games).where(eq(games.titleId, parsed.data));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    return game;
  };

  app.get("/public/games/:titleId", async (c) => {
    need(c, "leaderboards:read");
    const game = await gameRow(c.req.param("titleId"));
    return c.json({ titleId: game.titleId, names: game.names, iconUrl: game.iconUrl });
  });

  const board = async (c: Context<{ Variables: PublicVariables }>, which: Board) => {
    if (query(c, "scope") !== undefined && query(c, "scope") !== "global")
      throw new HttpError(400, ErrorCode.badRequest, "scope: only global boards are public");
    const limit = limitOf(c);
    // A few more than asked, for the people left out for the token's owner.
    const { entries, total, at } = await boards.top(which, limit + 20);
    const ids = entries.map((e) => e.id);
    const [blocked, byId, levels] = await Promise.all([
      people(db).blockedAmong(owner(c), ids),
      cards(ids),
      levelsFor(db, owner(c), ids),
    ]);
    const shown = entries
      .filter((e) => !blocked.has(e.id))
      .slice(0, limit)
      .flatMap((e) => {
        const user = byId.get(e.id);
        const level = levels.get(e.id);
        return user ? [{ rank: e.rank, user, value: e.value, ...(level ? { level } : {}) }] : [];
      });
    return withoutIds({ board: which.board, entries: shown, total, updatedAt: at });
  };

  app.get("/public/leaderboards/points", async (c) => {
    need(c, "leaderboards:read");
    return c.json({ ...(await board(c, pointsBoard)), game: null });
  });

  app.get("/public/games/:titleId/leaderboard", async (c) => {
    need(c, "leaderboards:read");
    const by = (query(c, "by") ?? "points") as GameBoard;
    if (!gameBoards.includes(by))
      throw new HttpError(400, ErrorCode.badRequest, `by: one of ${gameBoards.join(", ")}`);
    const game = await gameRow(c.req.param("titleId"));
    const answer = await board(c, gameBoard(game.titleId, by));
    return c.json({ ...answer, game: { titleId: game.titleId, names: game.names, iconUrl: game.iconUrl } });
  });

  // Challenges made for everyone.
  const publicView = <T extends Record<string, unknown>>(view: T) => {
    const { joined: _j, mine: _m, canCancel: _c, myStanding: _s, around: _a, ...rest } = view;
    const strip = (standing: unknown) => {
      if (!standing || typeof standing !== "object") return standing;
      const { me: _me, ...kept } = standing as Record<string, unknown>;
      return kept;
    };
    return withoutIds({
      ...rest,
      leader: strip(rest.leader),
      ...(Array.isArray(rest.standings) ? { standings: rest.standings.map(strip) } : {}),
    });
  };

  app.get("/public/challenges", async (c) => {
    need(c, "challenges:read");
    const state = query(c, "state");
    if (state !== undefined && !["upcoming", "active", "ended"].includes(state))
      throw new HttpError(400, ErrorCode.badRequest, "state: upcoming, active or ended");
    const titleId = query(c, "titleId");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const rows = await challengeService.list(owner(c), { state, titleId, publicOnly: true });
    const views = await challengeService.views(rows, owner(c), "public");
    return c.json({ challenges: views.map((v) => publicView(v as unknown as Record<string, unknown>)) });
  });

  app.get("/public/challenges/:id", async (c) => {
    need(c, "challenges:read");
    const row = await challengeService.visible(c.req.param("id"), owner(c)).catch(() => undefined);
    if (!row || row.audience !== "public" || stateOf(row) === "cancelled")
      throw new HttpError(404, ErrorCode.notFound, "No such challenge");
    const detail = await challengeService.detail(row, owner(c), "public");
    return c.json(publicView(detail as unknown as Record<string, unknown>));
  });

  // Nothing else under /public: no writes in this version.
  app.all("/public/*", () => {
    throw new HttpError(404, ErrorCode.notFound, "Not found");
  });

  return app;
}
