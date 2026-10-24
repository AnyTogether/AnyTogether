import { createHash, randomBytes } from "node:crypto";
import { type KeyLike, SignJWT, exportJWK, generateKeyPair, importPKCS8, jwtVerify } from "jose";

export const accessLifetime = 15 * 60;
export const refreshLifetimeDays = 90;

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
    verify: async (token: string): Promise<AccessClaims> => {
      const { payload } = await jwtVerify(token, publicKey, { issuer, audience, algorithms: ["EdDSA"] });
      if (!payload.sub || typeof payload.sid !== "string") throw new Error("incomplete token");
      return { userId: payload.sub, sessionId: payload.sid };
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
