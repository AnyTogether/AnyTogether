import { appeals, bans } from "@anytogether/db";
import { AppealCreate, ErrorCode } from "@anytogether/shared";
import { and, desc, eq, or } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { revokedKey } from "./events.js";
import { body } from "./http.js";
import { appealView, liveRestriction, restrictionsOf } from "./moderation.js";
import { clientIp, rateLimiter } from "./ratelimit.js";

type AppealVariables = { userId: string };

/** An access token, or (for a banned account, which has no session) the appeal token its refused
 *  sign-in gave: either says whose restrictions these are. */
function accountOrAppealToken(deps: Deps): MiddlewareHandler<{ Variables: AppealVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw new HttpError(401, ErrorCode.unauthorized, "Sign in first");
    const token = header.slice(7);
    const access = await deps.tokens.verify(token).catch(() => null);
    if (access) {
      if (await deps.valkey.exists(revokedKey(access.sessionId)))
        throw new HttpError(401, ErrorCode.sessionRevoked, "This sign-in has ended");
      c.set("userId", access.userId);
      return next();
    }
    const appealing = await deps.tokens.verifyAppeal(token).catch(() => null);
    if (!appealing) throw new HttpError(401, ErrorCode.unauthorized, "The token is not valid");
    c.set("userId", appealing);
    return next();
  };
}

/** What a restricted account may not do and why, and appealing against it: one open appeal at a
 *  time, a few a day. Works for a banned account too, with its appeal token; mounted before the
 *  signed-in routes for that reason. */
export function appealRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AppealVariables }>();
  const signedIn = accountOrAppealToken(deps);
  const limit = rateLimiter(deps.valkey, deps.limits);
  const { db } = deps;

  app.get("/me/restrictions", signedIn, async (c) => c.json(await restrictionsOf(db, c.get("userId"))));

  app.get("/me/appeals", signedIn, async (c) => {
    const rows = await db
      .select()
      .from(appeals)
      .where(eq(appeals.accountId, c.get("userId")))
      .orderBy(desc(appeals.createdAt))
      .limit(20);
    return c.json({ appeals: rows.map(appealView) });
  });

  app.post("/me/appeals", signedIn, async (c) => {
    const me = c.get("userId");
    const input = await body(c, AppealCreate);
    await limit("appeal", me);
    await limit("appealIp", clientIp(c, deps.clientIpHeader));
    const { restrictions } = await restrictionsOf(db, me);
    const restriction = input.restrictionId
      ? restrictions.find((r) => r.id === input.restrictionId)
      : restrictions[0];
    if (!restriction) throw new HttpError(404, ErrorCode.notFound, "No such restriction in force");
    // A ban on the address alone has no account on it; the appeal still names it.
    const [row] = await db
      .select({ id: bans.id })
      .from(bans)
      .where(
        and(eq(bans.id, restriction.id), liveRestriction(), or(eq(bans.kind, "ban"), eq(bans.accountId, me))),
      );
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such restriction in force");
    const [made] = await db
      .insert(appeals)
      .values({ id: uuidv7(), accountId: me, banId: restriction.id, text: input.text })
      .onConflictDoNothing()
      .returning();
    if (!made) throw new HttpError(409, ErrorCode.appealOpen, "An appeal is open already");
    return c.json({ appeal: appealView(made) }, 201);
  });

  return app;
}
