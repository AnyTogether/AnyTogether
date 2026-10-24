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

export interface Tokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  user: { id: string; handle: string; displayName: string; avatar: string | null; created: boolean };
}
