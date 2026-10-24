import { ErrorCode } from "@anytogether/shared";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Identity } from "./accounts.js";
import { HttpError } from "./errors.js";

export interface ProviderConfig {
  google: { clientIds: string[]; keys: JWTVerifyGetKey };
  apple: { clientIds: string[]; keys: JWTVerifyGetKey };
  discord: { clientId: string; clientSecret: string; fetch: typeof fetch };
}

interface SignIn {
  idToken?: string | undefined;
  code?: string | undefined;
  codeVerifier?: string | undefined;
  redirectUri?: string | undefined;
  nonce?: string | undefined;
}

const issuers = {
  google: ["https://accounts.google.com", "accounts.google.com"],
  apple: ["https://appleid.apple.com"],
};

/** Who the provider says this is: an ID token checked against its keys and our client IDs (Apple,
 *  Google), or a code exchanged with PKCE for the user (Discord). */
export async function verifyProvider(
  config: ProviderConfig,
  provider: "apple" | "google" | "discord",
  input: SignIn,
): Promise<Identity> {
  if (provider === "discord") return discord(config.discord, input);
  const settings = config[provider];
  if (settings.clientIds.length === 0)
    throw new HttpError(400, ErrorCode.providerDisabled, `Sign in with ${provider} is not set up`);
  if (!input.idToken) throw new HttpError(400, ErrorCode.badRequest, "idToken is required");
  try {
    const { payload } = await jwtVerify(input.idToken, settings.keys, {
      issuer: issuers[provider],
      audience: settings.clientIds,
    });
    if (input.nonce && payload.nonce !== input.nonce) throw new Error("nonce");
    const verified = payload.email_verified === true || payload.email_verified === "true";
    return {
      provider,
      subject: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : undefined,
      emailVerified: verified,
      name: typeof payload.name === "string" ? payload.name : undefined,
      avatarUrl: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, ErrorCode.providerRejected, `${provider} did not confirm this sign-in`);
  }
}

async function discord(settings: ProviderConfig["discord"], input: SignIn): Promise<Identity> {
  if (!settings.clientId)
    throw new HttpError(400, ErrorCode.providerDisabled, "Sign in with Discord is not set up");
  if (!input.code || !input.codeVerifier || !input.redirectUri)
    throw new HttpError(400, ErrorCode.badRequest, "code, codeVerifier and redirectUri are required");
  const exchange = await settings.fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    }),
  });
  if (!exchange.ok)
    throw new HttpError(401, ErrorCode.providerRejected, "Discord did not confirm this sign-in");
  const token = (await exchange.json()) as { access_token?: string };
  const me = await settings.fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!me.ok) throw new HttpError(401, ErrorCode.providerRejected, "Discord did not confirm this sign-in");
  const user = (await me.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    email?: string | null;
    verified?: boolean;
    avatar?: string | null;
  };
  return {
    provider: "discord",
    subject: user.id,
    email: user.email ?? undefined,
    emailVerified: user.verified === true,
    name: user.global_name ?? user.username,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
      : undefined,
  };
}
