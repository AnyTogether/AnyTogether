import { ErrorCode } from "@anytogether/shared";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { revokedKey } from "./events.js";

export type AuthVariables = { userId: string; sessionId: string };

/** A valid access token whose session has not been signed out. */
export function requireUser(
  deps: Pick<Deps, "tokens" | "valkey">,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
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
    c.set("userId", claims.userId);
    c.set("sessionId", claims.sessionId);
    await next();
  };
}
