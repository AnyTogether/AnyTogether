import { createRemoteJWKSet } from "jose";
import { defaultBlockedLinkDomains } from "./links.js";
import type { ProviderConfig } from "./providers.js";
import { type ClientIpHeader, clientIpHeaders } from "./ratelimit.js";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** A size in megabytes from the environment, or the default when unset or not a positive number. */
const megabytes = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 1024 * 1024);
};

/** Settings from the environment (see .env.example). */
export function config(env = process.env) {
  const providers: ProviderConfig = {
    google: {
      clientIds: list(env.GOOGLE_CLIENT_IDS),
      keys: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
    },
    apple: {
      clientIds: list(env.APPLE_CLIENT_IDS),
      keys: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
    },
    discord: { clientId: env.DISCORD_CLIENT_ID ?? "", clientSecret: env.DISCORD_CLIENT_SECRET ?? "", fetch },
  };
  const ipHeader = (env.CLIENT_IP_HEADER ?? "cf-connecting-ip").toLowerCase();
  if (!clientIpHeaders.includes(ipHeader as ClientIpHeader))
    throw new Error(`CLIENT_IP_HEADER must be one of ${clientIpHeaders.join(", ")}`);
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? "postgres://anytogether:anytogether@127.0.0.1:54329/anytogether",
    valkeyUrl: env.VALKEY_URL ?? "redis://127.0.0.1:63799",
    jwtPrivateKey: env.JWT_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined,
    publicUrl: env.PUBLIC_URL ?? "http://localhost:3000",
    /** Passkeys belong to PUBLIC_URL's host name; this is the name their prompts show. */
    rpName: env.WEBAUTHN_RP_NAME || "AnyTogether",
    mail: {
      transport: env.MAIL_TRANSPORT ?? "log",
      smtpUrl: env.SMTP_URL ?? "",
      resendKey: env.RESEND_API_KEY ?? "",
      from: env.MAIL_FROM ?? "AnyTogether <signin@kodla.agency>",
    },
    providers,
    /** TURN REST: the secret shared with the relay, and the STUN/TURN URLs handed to clients. */
    turn: { secret: env.TURN_SECRET ?? "", urls: list(env.TURN_URLS) },
    /** Where the caller's address is read from for per-address limits (CLIENT_IP_HEADER). */
    clientIpHeader: ipHeader as ClientIpHeader,
    /** Hosts game icons may come from (GAME_ICON_HOSTS); launchers load them for everyone who
     *  sees the game, so none are kept unless set. */
    gameIconHosts: list(env.GAME_ICON_HOSTS).map((host) => host.toLowerCase()),
    /** Optional: a GitHub token, so release checks get more than 60 calls an hour. */
    githubToken: env.GITHUB_TOKEN || undefined,
    /** Domains messages may not link to: the built-in IP loggers unless BLOCKED_LINK_DOMAINS is set
     *  (empty turns it off). */
    /** Web Push: the VAPID key pair (npx web-push generate-vapid-keys) and a mailto: or https:
     *  contact for push services. Without all three no push notifications are sent. */
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY ?? "",
      privateKey: env.VAPID_PRIVATE_KEY ?? "",
      subject: env.VAPID_SUBJECT ?? "",
    },
    /** Cloud saves and media: a folder (STORAGE_DIR) or an S3-compatible bucket (S3_*); neither
     *  keeps them off. STORAGE_QUOTA_MB per account for both, SAVE_MAX_MB per save archive. */
    storage: {
      dir: env.STORAGE_DIR ?? "",
      s3: {
        endpoint: env.S3_ENDPOINT ?? "",
        bucket: env.S3_BUCKET ?? "",
        accessKey: env.S3_ACCESS_KEY ?? "",
        secretKey: env.S3_SECRET_KEY ?? "",
        region: env.S3_REGION ?? "auto",
      },
      stagingDir: env.STORAGE_STAGING_DIR ?? "",
      quotaBytes: megabytes(env.STORAGE_QUOTA_MB, 100),
      saveMaxBytes: megabytes(env.SAVE_MAX_MB, 50),
      urlSecret: env.FILE_LINK_SECRET || undefined,
    },
    blockedLinkDomains:
      env.BLOCKED_LINK_DOMAINS === undefined
        ? defaultBlockedLinkDomains
        : list(env.BLOCKED_LINK_DOMAINS).map((domain) => domain.toLowerCase()),
  };
}
