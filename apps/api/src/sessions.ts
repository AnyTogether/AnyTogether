import { type Database, accounts, auditLog, profiles, sessions } from "@anytogether/db";
import type { ClientKind, Tokens } from "@anytogether/shared";
import {
  ErrorCode,
  presenceHidden,
  presenceHiddenKey,
  privacyOf,
  revocationsLoadedKey,
  revokedKey,
} from "@anytogether/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { isBanned, liftExpired, restrictedSignIn } from "./moderation.js";
import { forgetPush } from "./notifications.js";
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
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId));
  // Banned or suspended: what, why and until when, and a token to appeal with.
  if (account?.status === "banned" && !(await liftExpired(ctx.db, accountId)))
    throw await restrictedSignIn(ctx, accountId);
  if (account?.email && (await isBanned(ctx.db, { email: account.email })))
    throw await restrictedSignIn(ctx, accountId);
  if (account?.status === "deleting") {
    // Signing in within the 14 days keeps the account.
    await ctx.db
      .update(accounts)
      .set({ status: "active", deleteAfter: null })
      .where(and(eq(accounts.id, accountId), eq(accounts.status, "deleting")));
    await ctx.db
      .insert(auditLog)
      .values({ id: uuidv7(), actorId: accountId, action: "account.deletion_cancelled", target: accountId });
  }
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
export async function revoke(ctx: Pick<Context, "db" | "valkey">, sessionId: string, accountId: string) {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  await ctx.valkey.set(revokedKey(sessionId), "1", "EX", revokedSeconds);
  // Its browser gets no more push notifications.
  await forgetPush(ctx.db, sessionId);
  await publish(ctx.valkey, accountId, { type: "account.signed_out", data: { sessionId } });
}

/** How long Valkey keeps a sign-out: as long as an access token of the session could be valid. */
const revokedSeconds = accessLifetime + 60;
const restoring = new WeakMap<Redis, Promise<void>>();

/** PostgreSQL keeps every sign-out (sessions.revoked_at, a ban's included); Valkey keeps a copy of
 *  the recent ones for the checks on every request, and loses it when it restarts. Copies them back
 *  once Valkey has none, in one transaction with the mark that they are there, so a restart in
 *  between leaves neither. Several callers at once share the one copy. */
export async function restoreRevocations(ctx: Pick<Context, "db" | "valkey">) {
  if (await ctx.valkey.exists(revocationsLoadedKey)) return false;
  let job = restoring.get(ctx.valkey);
  if (!job) {
    job = (async () => {
      const since = new Date(Date.now() - revokedSeconds * 1000);
      const recent = await ctx.db
        .select({ id: sessions.id, revokedAt: sessions.revokedAt })
        .from(sessions)
        .where(gt(sessions.revokedAt, since));
      const write = ctx.valkey.multi();
      for (const { id, revokedAt } of recent) {
        const left = Math.ceil(((revokedAt?.getTime() ?? 0) + revokedSeconds * 1000 - Date.now()) / 1000);
        if (left > 0) write.set(revokedKey(id), "1", "EX", left);
      }
      await write.set(revocationsLoadedKey, "1").exec();
    })().finally(() => restoring.delete(ctx.valkey));
    restoring.set(ctx.valkey, job);
  }
  await job;
  return true;
}

/** Whether the session was signed out: one Valkey round trip, and PostgreSQL only after Valkey
 *  restarted empty. */
export async function isRevoked(ctx: Pick<Context, "db" | "valkey">, sessionId: string) {
  const [revoked, loaded] = await ctx.valkey.mget(revokedKey(sessionId), revocationsLoadedKey);
  if (revoked) return true;
  if (loaded) return false;
  await restoreRevocations(ctx);
  return (await ctx.valkey.exists(revokedKey(sessionId))) > 0;
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
  if (presenceHidden(privacyOf(profile.privacy), profile.appearOffline))
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
