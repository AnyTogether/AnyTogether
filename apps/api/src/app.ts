import type { Database } from "@anytogether/db";
import { ErrorCode, problem } from "@anytogether/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Redis } from "ioredis";
import { accountRoutes } from "./account.js";
import { passkeyRoutes } from "./auth/passkeys.js";
import { authRoutes } from "./auth/routes.js";
import { avatarRoutes } from "./avatars.js";
import { callRoutes } from "./calls.js";
import { HttpError } from "./errors.js";
import { feedRoutes } from "./feed.js";
import { friendRoutes } from "./friends.js";
import { gameSessionRoutes } from "./gameSessions.js";
import { gameRoutes } from "./games.js";
import { leaderboardRoutes } from "./leaderboards.js";
import type { Mailer } from "./mail.js";
import { messageRoutes } from "./messages.js";
import type { AuthVariables } from "./middleware.js";
import { reportRoutes } from "./moderation.js";
import { partyRoutes, partyService } from "./parties.js";
import { profileRoutes } from "./profile.js";
import type { ProviderConfig } from "./providers.js";
import { type Limits, perIp } from "./ratelimit.js";
import { realtimeRoutes } from "./realtime.js";
import { sharePlayRoutes } from "./sharePlays.js";
import type { TokenSigner } from "./tokens.js";

export const maxBodyBytes = 8 * 1024 * 1024;

export interface Deps {
  db: Database;
  valkey: Redis;
  mailer: Mailer;
  tokens: TokenSigner;
  providers: ProviderConfig;
  /** Where the website is, for links in mails and the device page. */
  publicUrl: string;
  /** The name passkey prompts show for the site; "AnyTogether" by default. */
  rpName?: string;
  /** Rate limits other than the defaults (the tests lower or raise them). */
  limits?: Partial<Limits>;
  /** STUN/TURN for calls; without it calls get no ICE servers beyond what the client has. */
  turn?: { secret: string; urls: string[] };
  /** Hosts a game's icon may come from (subdomains included); none when left out. */
  gameIconHosts?: string[];
  /** Domains messages may not link to (none when left out). */
  blockedLinkDomains?: string[];
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
  // No request is read into memory past 8 MB (the biggest are trophy sets in many languages).
  v1.use(
    "*",
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: () => {
        throw new HttpError(413, ErrorCode.payloadTooLarge, "The request is too large");
      },
    }),
  );
  v1.route("/auth", authRoutes(deps));
  v1.route("/auth", passkeyRoutes(deps));

  // Before the signed-in routes: avatars are served to anyone.
  v1.route("/", avatarRoutes(deps));
  v1.route("/", profileRoutes(deps));
  v1.route("/", accountRoutes(deps));
  v1.route("/", friendRoutes(deps));
  v1.route("/", gameRoutes(deps));
  v1.route("/", feedRoutes(deps));
  v1.route("/", leaderboardRoutes(deps));
  v1.route("/", reportRoutes(deps));
  v1.route("/", messageRoutes(deps));
  const partyPieces = partyService(deps);
  v1.route("/", partyRoutes(deps, partyPieces));
  const calls = callRoutes(deps, partyPieces);
  v1.route("/", calls);
  v1.route("/", gameSessionRoutes(deps));
  const shares = sharePlayRoutes(deps);
  v1.route("/", shares);
  v1.route("/", realtimeRoutes(deps));
  app.route("/api/v1", v1);
  /** Devices whose socket went: out of their calls and share plays. */
  const sweepDepartures = async (now = Date.now()) =>
    (await calls.sweepDepartures(now)) + (await shares.sweepDepartures(now));
  return Object.assign(app, {
    sweepDepartures,
    sweepCalls: calls.sweepDepartures,
    sweepShares: shares.sweepDepartures,
  });
}
