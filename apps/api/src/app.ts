import type { Database } from "@anytogether/db";
import { ErrorCode, problem } from "@anytogether/shared";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { accountRoutes } from "./account.js";
import { authRoutes } from "./auth/routes.js";
import { avatarRoutes } from "./avatars.js";
import { callRoutes } from "./calls.js";
import { HttpError } from "./errors.js";
import { friendRoutes } from "./friends.js";
import { gameSessionRoutes } from "./gameSessions.js";
import { gameRoutes } from "./games.js";
import type { Mailer } from "./mail.js";
import { messageRoutes } from "./messages.js";
import type { AuthVariables } from "./middleware.js";
import { reportRoutes } from "./moderation.js";
import { partyRoutes, partyService } from "./parties.js";
import { profileRoutes } from "./profile.js";
import type { ProviderConfig } from "./providers.js";
import { type Limits, perIp } from "./ratelimit.js";
import { realtimeRoutes } from "./realtime.js";
import type { TokenSigner } from "./tokens.js";

export interface Deps {
  db: Database;
  valkey: Redis;
  mailer: Mailer;
  tokens: TokenSigner;
  providers: ProviderConfig;
  /** Where the website is, for links in mails and the device page. */
  publicUrl: string;
  /** Rate limits other than the defaults (the tests lower or raise them). */
  limits?: Partial<Limits>;
  /** STUN/TURN for calls; without it calls get no ICE servers beyond what the client has. */
  turn?: { secret: string; urls: string[] };
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
      ...(error instanceof HttpError ? error.headers : {}),
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
  // Health checks and the gateway's key fetches above; everything else counts per address.
  v1.use("*", perIp(deps.valkey, "ip", deps.limits));
  v1.route("/auth", authRoutes(deps));

  // Before the signed-in routes: avatars are served to anyone.
  v1.route("/", avatarRoutes(deps));
  v1.route("/", profileRoutes(deps));
  v1.route("/", accountRoutes(deps));
  v1.route("/", friendRoutes(deps));
  v1.route("/", gameRoutes(deps));
  v1.route("/", reportRoutes(deps));
  v1.route("/", messageRoutes(deps));
  const partyPieces = partyService(deps);
  v1.route("/", partyRoutes(deps, partyPieces));
  v1.route("/", callRoutes(deps, partyPieces));
  v1.route("/", gameSessionRoutes(deps));
  v1.route("/", realtimeRoutes(deps));
  app.route("/api/v1", v1);
  return app;
}
