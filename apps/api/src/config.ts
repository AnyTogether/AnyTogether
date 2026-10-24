import { createRemoteJWKSet } from "jose";
import { defaultBlockedLinkDomains } from "./links.js";
import type { ProviderConfig } from "./providers.js";
import { type ClientIpHeader, clientIpHeaders } from "./ratelimit.js";

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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
    /** Domains messages may not link to: the built-in IP loggers unless BLOCKED_LINK_DOMAINS is set
     *  (empty turns it off). */
    blockedLinkDomains:
      env.BLOCKED_LINK_DOMAINS === undefined
        ? defaultBlockedLinkDomains
        : list(env.BLOCKED_LINK_DOMAINS).map((domain) => domain.toLowerCase()),
  };
}
