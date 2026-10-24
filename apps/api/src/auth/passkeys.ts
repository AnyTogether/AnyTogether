import { auditLog, passkeys, profiles } from "@anytogether/db";
import { ErrorCode, type Passkey, PasskeyCreate, PasskeyFinish } from "@anytogether/shared";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "../app.js";
import { HttpError } from "../errors.js";
import { body, clientKind } from "../http.js";
import { type AuthVariables, requireUser } from "../middleware.js";
import { perIp, rateLimiter } from "../ratelimit.js";
import { startSession } from "../sessions.js";
import { secret } from "../tokens.js";

export const maxPasskeys = 10;
/** Seconds a challenge waits for the authenticator; it is used once, then gone. */
const challengeLifetime = 300;
const registerKey = (accountId: string) => `passkey:register:${accountId}`;
const signInKey = (challengeId: string) => `passkey:signin:${challengeId}`;

/** The relying party is the website: its host name is the RP ID and its address the only origin. */
export function relyingParty(publicUrl: string, name = "AnyTogether") {
  const url = new URL(publicUrl);
  return { id: url.hostname, origin: url.origin, name };
}

/** The WebAuthn user handle: the account's UUID as its 16 bytes (no email, no handle). */
export const userHandle = (accountId: string) => Buffer.from(accountId.replace(/-/g, ""), "hex");

const expired = () =>
  new HttpError(400, ErrorCode.challengeExpired, "This passkey request has expired; try again");
const invalid = () => new HttpError(400, ErrorCode.passkeyInvalid, "This passkey is not known here");

const shown = (row: typeof passkeys.$inferSelect): Passkey => ({
  id: row.id,
  name: row.name,
  backedUp: row.backedUp,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

/** Passkeys: added and removed by the signed-in user, and a way to sign in with no email at all
 *  (discoverable credentials, so the browser offers them by itself). */
export function passkeyRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const ctx = { db: deps.db, valkey: deps.valkey, tokens: deps.tokens };
  const rp = relyingParty(deps.publicUrl, deps.rpName);
  const limit = rateLimiter(deps.valkey, deps.limits);
  // Asking for a challenge is cheap and the sign-in page does it on every visit; trying one counts
  // as a sign-in attempt.
  app.post("/passkey/start", perIp(deps, "passkeyChallenge"));
  app.post("/passkey/finish", perIp(deps, "signIn"));

  app.post("/passkey/start", async (c) => {
    const options = await generateAuthenticationOptions({
      rpID: rp.id,
      userVerification: "preferred",
      timeout: challengeLifetime * 1000,
    });
    const challengeId = secret(18);
    await deps.valkey.set(signInKey(challengeId), options.challenge, "EX", challengeLifetime);
    return c.json({ challengeId, options });
  });

  app.post("/passkey/finish", async (c) => {
    const input = await body(c, PasskeyFinish);
    const challenge = await deps.valkey.getdel(signInKey(input.challengeId));
    if (!challenge) throw expired();
    const response = input.response as unknown as AuthenticationResponseJSON;
    const [key] = await deps.db.select().from(passkeys).where(eq(passkeys.id, response.id));
    if (!key) throw invalid();
    // A discoverable credential names its account; it has to be the one the key belongs to.
    const handle = response.response.userHandle;
    if (handle && handle !== userHandle(key.accountId).toString("base64url")) throw invalid();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(key.publicKey),
        counter: key.counter,
        transports: key.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    }).catch(() => undefined);
    // A counter that did not move forward (a cloned key) fails the check above as well.
    if (!verification?.verified) throw invalid();
    await deps.db
      .update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      })
      .where(eq(passkeys.id, key.id));
    // The same checks as every other way in: banned accounts are refused, and an account waiting
    // to be deleted is kept.
    return c.json(await startSession(ctx, key.accountId, false, clientKind(c), input.deviceName));
  });

  app.get("/passkeys", requireUser(deps), async (c) => {
    const rows = await deps.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.accountId, c.get("userId")))
      .orderBy(asc(passkeys.createdAt));
    return c.json({ passkeys: rows.map(shown), max: maxPasskeys });
  });

  /** The options for navigator.credentials.create(): a resident key, its user handle the account. */
  app.post("/passkeys/start", requireUser(deps), async (c) => {
    const me = c.get("userId");
    await limit("passkey", me);
    const existing = await deps.db
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.accountId, me));
    if (existing.length >= maxPasskeys)
      throw new HttpError(409, ErrorCode.full, `An account can have at most ${maxPasskeys} passkeys`);
    const [profile] = await deps.db
      .select({ handle: profiles.handle, displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.accountId, me));
    if (!profile) throw new HttpError(404, ErrorCode.notFound, "No profile");
    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userID: new Uint8Array(userHandle(me)),
      userName: profile.handle,
      userDisplayName: profile.displayName,
      attestationType: "none",
      // The same authenticator twice would only be a second row for one key.
      excludeCredentials: existing.map((row) => ({
        id: row.id,
        transports: row.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      timeout: challengeLifetime * 1000,
    });
    await deps.valkey.set(registerKey(me), options.challenge, "EX", challengeLifetime);
    return c.json(options);
  });

  app.post("/passkeys", requireUser(deps), async (c) => {
    const me = c.get("userId");
    const input = await body(c, PasskeyCreate);
    const challenge = await deps.valkey.getdel(registerKey(me));
    if (!challenge) throw expired();
    const verification = await verifyRegistrationResponse({
      response: input.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    }).catch(() => undefined);
    if (!verification?.verified)
      throw new HttpError(400, ErrorCode.passkeyInvalid, "The passkey could not be checked");
    const info = verification.registrationInfo;
    const row = await deps.db.transaction(async (tx) => {
      const [held] = await tx.select({ n: count() }).from(passkeys).where(eq(passkeys.accountId, me));
      if ((held?.n ?? 0) >= maxPasskeys)
        throw new HttpError(409, ErrorCode.full, `An account can have at most ${maxPasskeys} passkeys`);
      const [added] = await tx
        .insert(passkeys)
        .values({
          id: info.credential.id,
          accountId: me,
          name: input.name,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: info.credential.counter,
          transports: info.credential.transports ?? [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
        })
        .onConflictDoNothing()
        .returning();
      if (!added) throw new HttpError(409, ErrorCode.conflict, "This passkey is already added");
      await tx.insert(auditLog).values({
        id: uuidv7(),
        actorId: me,
        action: "passkey.added",
        target: me,
        data: { name: input.name },
      });
      return added;
    });
    return c.json(shown(row), 201);
  });

  app.delete("/passkeys/:id", requireUser(deps), async (c) => {
    const me = c.get("userId");
    const removed = await deps.db
      .delete(passkeys)
      .where(and(eq(passkeys.id, c.req.param("id")), eq(passkeys.accountId, me)))
      .returning({ name: passkeys.name });
    if (!removed[0]) throw new HttpError(404, ErrorCode.notFound, "No such passkey");
    await deps.db.insert(auditLog).values({
      id: uuidv7(),
      actorId: me,
      action: "passkey.removed",
      target: me,
      data: { name: removed[0].name },
    });
    return c.body(null, 204);
  });

  return app;
}
