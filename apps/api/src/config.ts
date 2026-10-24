import { createRemoteJWKSet } from "jose";
import type { ProviderConfig } from "./providers.js";

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
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? "postgres://anytogether:anytogether@127.0.0.1:54329/anytogether",
    valkeyUrl: env.VALKEY_URL ?? "redis://127.0.0.1:63799",
    jwtPrivateKey: env.JWT_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined,
    publicUrl: env.PUBLIC_URL ?? "http://localhost:3000",
    mail: {
      transport: env.MAIL_TRANSPORT ?? "log",
      smtpUrl: env.SMTP_URL ?? "",
      resendKey: env.RESEND_API_KEY ?? "",
      from: env.MAIL_FROM ?? "AnyTogether <signin@kodla.agency>",
    },
    providers,
  };
}
