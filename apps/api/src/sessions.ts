import { type Database, profiles, sessions } from "@anytogether/db";
import type { ClientKind, Tokens } from "@anytogether/shared";
import { ErrorCode, presenceHiddenKey, privacyOf } from "@anytogether/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { HttpError } from "./errors.js";
import { publish, revokedKey } from "./events.js";
import { type TokenSigner, accessLifetime, hash, refreshLifetimeDays, secret } from "./tokens.js";

interface Context {
  db: Database;
  valkey: Redis;
  tokens: TokenSigner;
}

/** A new signed-in device for the account, and its first tokens. */
export async function startSession(
  ctx: Context,
  accountId: string,
  created: boolean,
  client: ClientKind,
  deviceName?: string,
): Promise<Tokens> {
  const id = uuidv7();
  const refreshToken = secret();
  await ctx.db.insert(sessions).values({
    id,
    accountId,
    client,
    deviceName: deviceName ?? null,
    refreshHash: hash(refreshToken),
    expiresAt: new Date(Date.now() + refreshLifetimeDays * 86_400_000),
    lastSeenAt: new Date(),
  });
  return tokensFor(ctx, accountId, id, refreshToken, created);
}

/** A refresh token for a new pair. A refresh token used twice means it was copied: the session ends. */
export async function refresh(ctx: Context, refreshToken: string): Promise<Tokens> {
  const presented = hash(refreshToken);
  const current = await ctx.db.select().from(sessions).where(eq(sessions.refreshHash, presented));
  const session = current[0];
  if (!session) {
    const replayed = await ctx.db.select().from(sessions).where(eq(sessions.previousHash, presented));
    if (replayed[0]) {
      await revoke(ctx, replayed[0].id, replayed[0].accountId);
      throw new HttpError(401, ErrorCode.refreshReused, "This sign-in was used elsewhere and has ended");
    }
    throw new HttpError(401, ErrorCode.unauthorized, "Unknown refresh token");
  }
  if (session.revokedAt || session.expiresAt < new Date())
    throw new HttpError(401, ErrorCode.sessionRevoked, "This sign-in has ended");
  const next = secret();
  const turned = await ctx.db
    .update(sessions)
    .set({
      refreshHash: hash(next),
      previousHash: presented,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + refreshLifetimeDays * 86_400_000),
    })
    .where(and(eq(sessions.id, session.id), eq(sessions.refreshHash, presented), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (!turned[0])
    throw new HttpError(401, ErrorCode.refreshReused, "This sign-in was used elsewhere and has ended");
  return tokensFor(ctx, session.accountId, session.id, next, false);
}

/** Ends a session now: its refresh token stops working, its access tokens are refused, its
 *  sockets are told. */
export async function revoke(ctx: Context, sessionId: string, accountId: string) {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  await ctx.valkey.set(revokedKey(sessionId), "1", "EX", accessLifetime + 60);
  await publish(ctx.valkey, accountId, { type: "account.signed_out", data: { sessionId } });
}

async function tokensFor(
  ctx: Context,
  accountId: string,
  sessionId: string,
  refreshToken: string,
  created: boolean,
): Promise<Tokens> {
  const profile = (await ctx.db.select().from(profiles).where(eq(profiles.accountId, accountId)))[0];
  if (!profile) throw new HttpError(500, ErrorCode.internal, "Account without a profile");
  // Valkey keeps nothing across a restart: every sign-in and refresh tells the gateway again
  // whether this user hides their presence.
  if (privacyOf(profile.privacy).presence === "nobody")
    await ctx.valkey.set(presenceHiddenKey(accountId), "1");
  else await ctx.valkey.del(presenceHiddenKey(accountId));
  return {
    accessToken: await ctx.tokens.sign({ userId: accountId, sessionId }),
    expiresIn: accessLifetime,
    refreshToken,
    user: {
      id: accountId,
      handle: profile.handle,
      displayName: profile.displayName,
      avatar: profile.avatarUrl,
      created,
    },
  };
}
