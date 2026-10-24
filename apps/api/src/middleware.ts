import { ErrorCode } from "@anytogether/shared";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { revokedKey } from "./events.js";
import { rateLimiter } from "./ratelimit.js";

export type AuthVariables = { userId: string; sessionId: string };

/** A valid access token whose session has not been signed out; each request also counts against
 *  the account's limit. */
export function requireUser(
  deps: Pick<Deps, "tokens" | "valkey" | "limits">,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const limit = rateLimiter(deps.valkey, deps.limits);
  return async (c, next) => {
    // Several route groups each ask; the first one that checked is enough.
    if (c.get("userId")) return next();
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) throw new HttpError(401, ErrorCode.unauthorized, "Sign in first");
    let claims: Awaited<ReturnType<Deps["tokens"]["verify"]>>;
    try {
      claims = await deps.tokens.verify(header.slice(7));
    } catch {
      throw new HttpError(401, ErrorCode.unauthorized, "The access token is not valid");
    }
    if (await deps.valkey.exists(revokedKey(claims.sessionId)))
      throw new HttpError(401, ErrorCode.sessionRevoked, "This sign-in has ended");
    await limit("account", claims.userId);
    c.set("userId", claims.userId);
    c.set("sessionId", claims.sessionId);
    await next();
  };
}

/** For routes anyone may call: a valid access token tells who asks (for "liked", "mine"); a
 *  missing or bad one is the same as none. */
export function optionalUser(
  deps: Pick<Deps, "tokens" | "valkey">,
): MiddlewareHandler<{ Variables: Partial<AuthVariables> }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (header.startsWith("Bearer ") && !c.get("userId")) {
      try {
        const claims = await deps.tokens.verify(header.slice(7));
        if (!(await deps.valkey.exists(revokedKey(claims.sessionId)))) {
          c.set("userId", claims.userId);
          c.set("sessionId", claims.sessionId);
        }
      } catch {
        // Signed out, as far as this route cares.
      }
    }
    await next();
  };
}
