import { z } from "zod";

/** Which program is asking, from the AnyTogether-Client header: "launcher-macos/0.2.13 (…)". */
export const clientKinds = ["launcher-macos", "launcher-windows", "launcher-linux", "phone", "web"] as const;
export type ClientKind = (typeof clientKinds)[number];

export const providers = ["apple", "google", "discord"] as const;
export type Provider = (typeof providers)[number];

export const EmailStart = z.object({ email: z.string().email().max(254) });
export const EmailVerify = z
  .object({
    email: z.string().email().max(254),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    link: z.string().min(20).max(200).optional(),
  })
  .refine((value) => value.code || value.link, { message: "code or link" });

/** A provider's answer: an ID token (Apple, Google native), or a code with its PKCE verifier. */
export const OidcSignIn = z
  .object({
    idToken: z.string().min(10).optional(),
    code: z.string().min(4).optional(),
    codeVerifier: z.string().min(43).max(128).optional(),
    redirectUri: z.string().url().optional(),
    nonce: z.string().max(200).optional(),
    deviceName: z.string().max(80).optional(),
  })
  .refine((value) => value.idToken || (value.code && value.codeVerifier && value.redirectUri), {
    message: "idToken, or code with codeVerifier and redirectUri",
  });

export const HandoffStart = z.object({ deviceName: z.string().min(1).max(80) });
export const DeviceStart = z.object({ deviceName: z.string().min(1).max(80) });
export const DeviceApprove = z.object({ userCode: z.string().min(6).max(12) });

export const TokenRequest = z.discriminatedUnion("grantType", [
  z.object({ grantType: z.literal("refresh_token"), refreshToken: z.string().min(20) }),
  z.object({ grantType: z.literal("device_code"), deviceCode: z.string().min(20) }),
  z.object({ grantType: z.literal("handoff"), handoffId: z.string().uuid(), secret: z.string().min(20) }),
]);

/** A browser's WebAuthn answer as JSON (base64url fields); the API checks the inside. */
const credentialJson = z
  .object({
    id: z.string().min(1).max(1400),
    rawId: z.string().min(1).max(1400),
    type: z.literal("public-key"),
    response: z.object({ clientDataJSON: z.string().max(4096) }).passthrough(),
    clientExtensionResults: z.record(z.unknown()).default({}),
    authenticatorAttachment: z.string().max(40).optional(),
  })
  .passthrough();

/** A new passkey for the signed-in account, named so it can be told apart in the list. */
export const PasskeyCreate = z.object({ name: z.string().trim().min(1).max(60), response: credentialJson });
/** Signing in with a passkey: the challenge asked for, and what the authenticator signed. */
export const PasskeyFinish = z.object({
  challengeId: z.string().min(16).max(64),
  response: credentialJson,
  deviceName: z.string().max(80).optional(),
});

export interface Passkey {
  id: string;
  name: string;
  /** Synced across the user's devices (iCloud Keychain, Google Password Manager, …). */
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Tokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  user: { id: string; handle: string; displayName: string; avatar: string | null; created: boolean };
}
