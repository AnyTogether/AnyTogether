import { createHash, randomBytes } from "node:crypto";
import { type KeyLike, SignJWT, exportJWK, generateKeyPair, importPKCS8, jwtVerify } from "jose";

export const accessLifetime = 15 * 60;
export const refreshLifetimeDays = 90;
/** Seconds an appeal token works. */
export const appealLifetime = 3600;

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

/** Access tokens: EdDSA JWTs for 15 minutes. Without a key (development) one is made per run. */
export async function createTokenSigner(privateKeyPem: string | undefined, issuer: string) {
  let privateKey: KeyLike;
  let publicKey: KeyLike;
  if (privateKeyPem) {
    privateKey = await importPKCS8(privateKeyPem, "EdDSA");
    const { createPublicKey } = await import("node:crypto");
    publicKey = createPublicKey(privateKeyPem) as unknown as KeyLike;
  } else {
    ({ privateKey, publicKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" }));
  }
  const audience = "anytogether";
  /** Appeal tokens: what a banned account gets from a sign-in that proved who it is, good only for
   *  reading its restrictions and appealing (GET /me/restrictions, /me/appeals), for an hour. */
  const appealAudience = "anytogether-appeal";
  return {
    publicJwk: async () => ({ ...(await exportJWK(publicKey)), alg: "EdDSA", use: "sig", kid: "1" }),
    sign: (claims: AccessClaims) =>
      new SignJWT({ sid: claims.sessionId })
        .setProtectedHeader({ alg: "EdDSA", kid: "1" })
        .setSubject(claims.userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(`${accessLifetime}s`)
        .sign(privateKey),
    /** A document the launchers keep offline and check with the same key (the JWKS): the claims
     *  under `claim`, for `subject`, valid `days` days. */
    signDocument: (audienceName: string, subject: string, claims: Record<string, unknown>, days: number) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "EdDSA", kid: "1" })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience(audienceName)
        .setIssuedAt()
        .setExpirationTime(`${days}d`)
        .sign(privateKey),
    verifyDocument: async (token: string, audienceName: string) =>
      (await jwtVerify(token, publicKey, { issuer, audience: audienceName, algorithms: ["EdDSA"] })).payload,
    verify: async (token: string): Promise<AccessClaims> => {
      const { payload } = await jwtVerify(token, publicKey, { issuer, audience, algorithms: ["EdDSA"] });
      if (!payload.sub || typeof payload.sid !== "string") throw new Error("incomplete token");
      return { userId: payload.sub, sessionId: payload.sid };
    },
    signAppeal: (userId: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA", kid: "1" })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(appealAudience)
        .setIssuedAt()
        .setExpirationTime(`${appealLifetime}s`)
        .sign(privateKey),
    verifyAppeal: async (token: string) => {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer,
        audience: appealAudience,
        algorithms: ["EdDSA"],
      });
      if (!payload.sub) throw new Error("incomplete token");
      return payload.sub;
    },
  };
}
export type TokenSigner = Awaited<ReturnType<typeof createTokenSigner>>;

/** A random secret for a client, and the hash the server keeps of it. */
export function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hash(value: string) {
  return createHash("sha256").update(value).digest();
}
