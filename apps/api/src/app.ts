import { type Database, accounts, profiles } from "@anytogether/db";
import { ErrorCode, problem } from "@anytogether/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { authRoutes } from "./auth/routes.js";
import { HttpError } from "./errors.js";
import type { Mailer } from "./mail.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { ProviderConfig } from "./providers.js";
import type { TokenSigner } from "./tokens.js";

export interface Deps {
  db: Database;
  valkey: Redis;
  mailer: Mailer;
  tokens: TokenSigner;
  providers: ProviderConfig;
  /** Where the website is, for links in mails and the device page. */
  publicUrl: string;
}

export function createApp(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.onError((error, c) => {
    const body =
      error instanceof HttpError
        ? error.toProblem()
        : problem(500, ErrorCode.internal, "Something went wrong");
    if (!(error instanceof HttpError)) console.error(error);
    return c.newResponse(JSON.stringify(body), body.status as 400, {
      "content-type": "application/problem+json",
    });
  });
  app.notFound((c) =>
    c.newResponse(JSON.stringify(problem(404, ErrorCode.notFound, "Not found")), 404, {
      "content-type": "application/problem+json",
    }),
  );

  const v1 = new Hono<{ Variables: AuthVariables }>();
  v1.get("/health", (c) => c.json({ ok: true }));
  v1.get("/.well-known/jwks.json", async (c) => c.json({ keys: [await deps.tokens.publicJwk()] }));
  v1.route("/auth", authRoutes(deps));

  v1.get("/me", requireUser(deps), async (c) => {
    const userId = c.get("userId");
    const [account] = await deps.db.select().from(accounts).where(eq(accounts.id, userId));
    const [profile] = await deps.db.select().from(profiles).where(eq(profiles.accountId, userId));
    if (!account || !profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return c.json({
      account: { id: account.id, email: account.email, createdAt: account.createdAt },
      profile: {
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        avatar: profile.avatarUrl,
        country: profile.country,
      },
    });
  });

  app.route("/api/v1", v1);
  return app;
}
