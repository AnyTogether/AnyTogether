import type { Database } from "@anytogether/db";
import { ErrorCode, problem } from "@anytogether/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Redis } from "ioredis";
import { accountRoutes } from "./account.js";
import { adminRoutes } from "./adminRoutes.js";
import { appealRoutes } from "./appeals.js";
import { artRoutes } from "./art.js";
import { passkeyRoutes } from "./auth/passkeys.js";
import { authRoutes } from "./auth/routes.js";
import { avatarRoutes } from "./avatars.js";
import { callRoutes } from "./calls.js";
import { type ClientGate, clientGate } from "./clientGate.js";
import { communityRoutes } from "./communities.js";
import { compatRoutes } from "./compat.js";
import { connectionRoutes } from "./connections.js";
import { discoverRoutes } from "./discover.js";
import { HttpError } from "./errors.js";
import { familyRoutes, sendFamilySummaries } from "./family.js";
import { feedRoutes } from "./feed.js";
import type { FileService } from "./files.js";
import { friendRoutes } from "./friends.js";
import { gameSessionRoutes } from "./gameSessions.js";
import { gameRoutes } from "./games.js";
import { joinCodeRoutes } from "./joinCodes.js";
import { leaderboardRoutes } from "./leaderboards.js";
import { lfgRoutes } from "./lfg.js";
import type { Mailer } from "./mail.js";
import { isStreamedUpload, mediaRoutes, mediaService } from "./media.js";
import { messageRoutes } from "./messages.js";
import { metRoutes } from "./met.js";
import type { AuthVariables } from "./middleware.js";
import { reportRoutes } from "./moderation.js";
import { type PushSender, notificationRoutes, notifier } from "./notifications.js";
import { partyRoutes, partyService } from "./parties.js";
import { revealMiddleware, revealedPaths } from "./privateIdentity.js";
import { profileRoutes } from "./profile.js";
import type { ProviderConfig } from "./providers.js";
import { publicProfileRoutes } from "./publicProfiles.js";
import { type ClientIpHeader, type Limits, perIp } from "./ratelimit.js";
import { realtimeRoutes } from "./realtime.js";
import { releaseRoutes } from "./releases.js";
import { saveRoutes } from "./saves.js";
import { sharePlayRoutes } from "./sharePlays.js";
import { showcaseRoutes } from "./showcase.js";
import { statsRoutes } from "./stats.js";
import type { BlobStore } from "./storage.js";
import { isThemeUpload, themeRoutes } from "./themes.js";
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
  /** Which header carries the caller's address for per-address limits (see ratelimit.ts). */
  clientIpHeader?: ClientIpHeader;
  /** Hosts a game's icon may come from (subdomains included); none when left out. */
  gameIconHosts?: string[];
  /** Domains messages may not link to (none when left out). */
  blockedLinkDomains?: string[];
  /** Web Push with the server's VAPID keys; without it no push notifications are sent. */
  push?: PushSender;
  /** Where theme files are kept: PostgreSQL when left out. */
  blobs?: BlobStore;
  /** Cloud saves and media (a folder or an S3 bucket, and the quota); off when left out. */
  files?: FileService;
  /** Linking Steam accounts: a Web API key for persona names (optional), and how Steam is asked
   *  (the tests answer themselves). */
  steam?: { apiKey?: string | undefined; fetch?: typeof fetch };
  /** How GitHub is asked for releases (the tests answer themselves), and a token for more calls. */
  githubFetch?: typeof fetch;
  githubToken?: string;
  /** The backup service's status file, shown on the admin page; none when left out. */
  backupStatusFile?: string;
  /** The oldest launcher and phone app versions answered (MIN_LAUNCHER_VERSION); none refused when
   *  left out. */
  clientGate?: ClientGate;
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
  // Clients too old for the server get the update screen's answer before anything else.
  v1.use("*", clientGate(deps.clientGate));
  // Health checks and the gateway's key fetches above; everything else counts per address.
  v1.use("*", perIp(deps, "ip"));
  // No request is read into memory past 8 MB (the biggest are trophy sets in many languages),
  // but a theme file, which has its own limit where it is taken.
  const capped = bodyLimit({
    maxSize: maxBodyBytes,
    onError: () => {
      throw new HttpError(413, ErrorCode.payloadTooLarge, "The request is too large");
    },
  });
  v1.use("*", (c, next) =>
    (c.req.method === "POST" && isThemeUpload(c.req.path)) || isStreamedUpload(c.req.method, c.req.path)
      ? next()
      : capped(c, next),
  );
  // Friends-only names and pictures, added for the signed-in reader to the answers listed there.
  const revealing = revealMiddleware(deps);
  for (const path of revealedPaths) v1.use(path, revealing);
  v1.route("/auth", authRoutes(deps));
  v1.route("/auth", passkeyRoutes(deps));

  // Before the signed-in routes: avatars are served to anyone, and signed file links to whoever
  // holds one.
  v1.route("/", avatarRoutes(deps));
  const media = mediaService(deps);
  v1.route("/", saveRoutes(deps));
  v1.route("/", mediaRoutes(deps, media));
  // Covers and community icons, drawn from presets.
  v1.route("/", artRoutes());
  // The Theme Hub, the compatibility list, downloads and the front page's totals are open to anyone too.
  v1.route("/", themeRoutes(deps));
  v1.route("/", compatRoutes(deps));
  v1.route("/", releaseRoutes(deps));
  v1.route("/", statsRoutes(deps));
  // Profiles read signed out; a signed-in request goes on to the routes below.
  v1.route("/", publicProfileRoutes(deps));
  // Restrictions and appeals: a banned account comes with an appeal token, not a session.
  v1.route("/", appealRoutes(deps));
  const notes = notifier(deps);
  const partyPieces = partyService(deps, notes);
  const shares = sharePlayRoutes(deps);
  const gameSessions = gameSessionRoutes(deps, notes, partyPieces);
  // What a join code opens is read signed out too (a link opened from Discord).
  v1.route("/", joinCodeRoutes(deps, partyPieces.codes, partyPieces, shares, gameSessions));
  // Before the profile routes, whose PATCH /me/* counts against the profile limit.
  const family = familyRoutes(deps, notes);
  v1.route("/", family);
  v1.route("/", profileRoutes(deps));
  v1.route("/", accountRoutes(deps));
  v1.route("/", notificationRoutes(deps, notes));
  v1.route("/", friendRoutes(deps, notes));
  v1.route("/", connectionRoutes(deps));
  v1.route("/", gameRoutes(deps, notes));
  v1.route("/", showcaseRoutes(deps));
  v1.route("/", metRoutes(deps));
  v1.route("/", feedRoutes(deps));
  v1.route("/", leaderboardRoutes(deps));
  v1.route("/", reportRoutes(deps));
  v1.route("/", messageRoutes(deps, notes));
  v1.route("/", partyRoutes(deps, partyPieces));
  const calls = callRoutes(deps, partyPieces);
  v1.route("/", calls);
  v1.route("/", gameSessions);
  v1.route("/", shares);
  const lfg = lfgRoutes(deps, notes, partyPieces, shares);
  v1.route("/", lfg);
  const communities = communityRoutes(deps, notes, partyPieces, shares);
  v1.route("/", communities);
  v1.route(
    "/",
    discoverRoutes(deps, { lfg, parties: partyPieces, shares, communities: communities.communitiesOfGame }),
  );
  v1.route("/", realtimeRoutes(deps));
  v1.route("/", adminRoutes(deps, notes));
  app.route("/api/v1", v1);
  /** Devices whose socket went: out of their calls, share plays and Play Together games. */
  const sweepDepartures = async (now = Date.now()) =>
    (await calls.sweepDepartures(now)) +
    (await shares.sweepDepartures(now)) +
    (await gameSessions.sweepDepartures(now));
  return Object.assign(app, {
    notes,
    sweepDepartures,
    sweepCalls: calls.sweepDepartures,
    sweepShares: shares.sweepDepartures,
    sweepGames: gameSessions.sweepDepartures,
    /** Looking-for-group posts whose time ran out leave the board. */
    sweepLfg: lfg.sweep,
    /** The weekly summaries for parents. */
    sendFamilySummaries: (now?: Date) => sendFamilySummaries(deps, notes, family.activityOf, now),
    media,
    /** Events starting within 15 minutes remind the people going. */
    sweepEvents: communities.sweepEvents,
  });
}
