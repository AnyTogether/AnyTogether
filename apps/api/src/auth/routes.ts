import { randomInt, timingSafeEqual } from "node:crypto";
import { accounts, sessions, signInRequests } from "@anytogether/db";
import {
  DeviceApprove,
  DeviceStart,
  EmailStart,
  EmailVerify,
  ErrorCode,
  HandoffStart,
  OidcSignIn,
  TokenRequest,
  mailLanguageOf,
  providers,
} from "@anytogether/shared";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { revokeAll } from "../account.js";
import { findOrCreateAccount } from "../accounts.js";
import type { Deps } from "../app.js";
import { HttpError } from "../errors.js";
import { body, clientKind } from "../http.js";
import { MailError } from "../mailCheck.js";
import { type AuthVariables, requireUser } from "../middleware.js";
import { bannedError, isBanned } from "../moderation.js";
import { verifyProvider } from "../providers.js";
import { perIp } from "../ratelimit.js";
import { refresh, revoke, startSession } from "../sessions.js";
import { hash, secret } from "../tokens.js";

const minutes = (count: number) => new Date(Date.now() + count * 60_000);
const same = (a: Buffer | null, b: Buffer) => a !== null && a.length === b.length && timingSafeEqual(a, b);
/** No look-alikes (0/O, 1/I): read off a screen and typed on a phone. */
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Tries for one mailed code, and wrong codes for one address in a day over all its codes. */
const maxCodeAttempts = 10;
const maxDailyFailures = 30;
const failuresKey = (address: string) => `signin-failures:${hash(address).toString("hex")}`;

/** Keeps the language a client shows on an account that has none yet (made before languages
 *  were kept, or by a client that sent none). */
async function keepLocale(deps: Deps, accountId: string, lang: string | null) {
  if (!lang) return;
  await deps.db
    .update(accounts)
    .set({ locale: lang })
    .where(and(eq(accounts.id, accountId), isNull(accounts.locale)));
}

export function authRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const ctx = { db: deps.db, valkey: deps.valkey, tokens: deps.tokens };
  const signIn = perIp(deps, "signIn");
  for (const path of ["/email/start", "/email/verify", "/oidc/*", "/handoff/start", "/device"])
    app.post(path, signIn);
  app.post("/token", perIp(deps, "token"));

  /** Which provider sign-ins a website or app can offer here, with what they need to start one
   *  (Discord's client ID, public anyway). Discord needs its client secret set to be offered. */
  app.get("/providers", (c) => {
    const discord = deps.providers.discord;
    return c.json({
      discord: discord.clientId && discord.clientSecret ? { clientId: discord.clientId } : null,
      google: deps.providers.google.clientIds.length > 0,
      apple: deps.providers.apple.clientIds.length > 0,
    });
  });

  app.post("/email/start", async (c) => {
    const input = await body(c, EmailStart);
    const address = input.email.toLowerCase();
    // A banned address: refused, but when an account has it the code is still mailed, so its
    // owner can sign in to read why and appeal (the sign-in itself is refused with the details).
    const banned = await isBanned(deps.db, { email: address });
    const owner = banned
      ? (await deps.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, address)))[0]
      : undefined;
    if (banned && !owner) throw bannedError();
    const recent = await deps.db
      .select({ id: signInRequests.id })
      .from(signInRequests)
      .where(
        and(
          eq(signInRequests.kind, "email"),
          eq(signInRequests.email, address),
          gt(signInRequests.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );
    if (recent.length >= 5)
      throw new HttpError(429, ErrorCode.rateLimited, "Too many codes for this address; try again later");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const link = secret(24);
    await deps.db.insert(signInRequests).values({
      id: uuidv7(),
      kind: "email",
      email: address,
      codeHash: hash(code),
      linkHash: hash(link),
      expiresAt: minutes(10),
    });
    const url = new URL("/login/email", deps.publicUrl);
    url.searchParams.set("email", address);
    url.searchParams.set("token", link);
    // One language: the page's the person is on, else their account's, else their browser's,
    // else English.
    const [account] = await deps.db
      .select({ locale: accounts.locale })
      .from(accounts)
      .where(eq(accounts.email, address));
    const lang =
      mailLanguageOf(input.lang) ??
      mailLanguageOf(account?.locale) ??
      mailLanguageOf(c.req.header("accept-language")) ??
      "en";
    try {
      await deps.mailer.signInCode(address, code, url.toString(), lang);
    } catch (error) {
      // Logged with its class where it failed; the person is told to try later.
      if (error instanceof MailError)
        throw new HttpError(
          503,
          ErrorCode.mailUnavailable,
          "The sign-in mail could not be sent; try again later",
          {},
          { "retry-after": "60" },
        );
      throw error;
    }
    if (banned) throw bannedError({ codeSent: true });
    return c.body(null, 202);
  });

  app.post("/email/verify", async (c) => {
    const input = await body(c, EmailVerify);
    const address = input.email.toLowerCase();
    const request = (
      await deps.db
        .select()
        .from(signInRequests)
        .where(
          and(
            eq(signInRequests.kind, "email"),
            eq(signInRequests.email, address),
            isNull(signInRequests.consumedAt),
          ),
        )
        .orderBy(desc(signInRequests.createdAt))
        .limit(1)
    )[0];
    if (!request || request.expiresAt < new Date())
      throw new HttpError(400, ErrorCode.codeExpired, "This code has expired; ask for a new one");
    const locked = () => new HttpError(400, ErrorCode.codeLocked, "Too many wrong codes; ask for a new one");
    // Wrong codes for one address over a day, whichever code they were for: a new code does not
    // bring new guesses.
    const failures = failuresKey(address);
    if (Number(await deps.valkey.get(failures)) >= maxDailyFailures) throw locked();
    // Each try takes one of the code's ten before it is checked, so tries sent at once count too.
    const counted = await deps.db
      .update(signInRequests)
      .set({ attempts: sql`${signInRequests.attempts} + 1` })
      .where(and(eq(signInRequests.id, request.id), lt(signInRequests.attempts, maxCodeAttempts)))
      .returning({ id: signInRequests.id });
    if (!counted[0]) throw locked();
    const right = input.code
      ? same(request.codeHash, hash(input.code))
      : same(request.linkHash, hash(input.link ?? ""));
    if (!right) {
      await deps.valkey.multi().incr(failures).expire(failures, 86_400, "NX").exec();
      throw new HttpError(400, ErrorCode.codeInvalid, "That code is not right");
    }
    const consumed = await deps.db
      .update(signInRequests)
      .set({ consumedAt: new Date() })
      .where(and(eq(signInRequests.id, request.id), isNull(signInRequests.consumedAt)))
      .returning({ id: signInRequests.id });
    if (!consumed[0]) throw new HttpError(400, ErrorCode.codeExpired, "This code was already used");
    const lang = mailLanguageOf(input.lang) ?? mailLanguageOf(c.req.header("accept-language"));
    const { accountId, created } = await findOrCreateAccount(deps.db, {
      provider: "email",
      subject: address,
      email: address,
      emailVerified: true,
      locale: lang,
    });
    await keepLocale(deps, accountId, lang);
    return c.json(await startSession(ctx, accountId, created, clientKind(c)));
  });

  app.post("/oidc/:provider", async (c) => {
    const provider = c.req.param("provider") as (typeof providers)[number];
    if (!providers.includes(provider)) throw new HttpError(404, ErrorCode.notFound, "Unknown provider");
    const input = await body(c, OidcSignIn);
    const identity = await verifyProvider(deps.providers, provider, input);
    const lang = mailLanguageOf(input.lang) ?? mailLanguageOf(c.req.header("accept-language"));
    const { accountId, created } = await findOrCreateAccount(deps.db, { ...identity, locale: lang });
    await keepLocale(deps, accountId, lang);
    return c.json(await startSession(ctx, accountId, created, clientKind(c), input.deviceName));
  });

  app.post("/handoff/start", async (c) => {
    const { deviceName } = await body(c, HandoffStart);
    const id = uuidv7();
    const handoffSecret = secret();
    await deps.db.insert(signInRequests).values({
      id,
      kind: "handoff",
      secretHash: hash(handoffSecret),
      client: clientKind(c),
      deviceName,
      expiresAt: minutes(5),
    });
    return c.json({ handoffId: id, secret: handoffSecret, expiresIn: 300 }, 201);
  });

  app.post("/handoff/:id/approve", requireUser(deps), async (c) => {
    const approved = await deps.db
      .update(signInRequests)
      .set({ approvedBy: c.get("userId") })
      .where(
        and(
          eq(signInRequests.id, c.req.param("id")),
          eq(signInRequests.kind, "handoff"),
          isNull(signInRequests.approvedBy),
          isNull(signInRequests.consumedAt),
          gt(signInRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: signInRequests.id });
    if (!approved[0]) throw new HttpError(404, ErrorCode.notFound, "No such request, or it has expired");
    return c.body(null, 204);
  });

  app.post("/device", async (c) => {
    const { deviceName } = await body(c, DeviceStart);
    const deviceCode = secret();
    const pick = () => Array.from({ length: 4 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join("");
    const userCode = `${pick()}-${pick()}`;
    await deps.db.insert(signInRequests).values({
      id: uuidv7(),
      kind: "device",
      secretHash: hash(deviceCode),
      userCode,
      client: clientKind(c),
      deviceName,
      expiresAt: minutes(10),
    });
    return c.json(
      {
        deviceCode,
        userCode,
        verificationUri: new URL("/link", deps.publicUrl).toString(),
        expiresIn: 600,
        interval: 5,
      },
      201,
    );
  });

  app.post("/device/approve", requireUser(deps), async (c) => {
    const { userCode } = await body(c, DeviceApprove);
    const approved = await deps.db
      .update(signInRequests)
      .set({ approvedBy: c.get("userId") })
      .where(
        and(
          eq(signInRequests.userCode, userCode.toUpperCase()),
          eq(signInRequests.kind, "device"),
          isNull(signInRequests.approvedBy),
          gt(signInRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: signInRequests.id });
    if (!approved[0]) throw new HttpError(404, ErrorCode.notFound, "No such code, or it has expired");
    return c.body(null, 204);
  });

  app.post("/token", async (c) => {
    const input = await body(c, TokenRequest);
    if (input.grantType === "refresh_token") return c.json(await refresh(ctx, input.refreshToken));
    const kind = input.grantType === "handoff" ? "handoff" : "device";
    const presented = hash(input.grantType === "handoff" ? input.secret : input.deviceCode);
    const request = (
      await deps.db
        .select()
        .from(signInRequests)
        .where(
          input.grantType === "handoff"
            ? eq(signInRequests.id, input.handoffId)
            : eq(signInRequests.secretHash, presented),
        )
    )[0];
    if (!request || request.kind !== kind || !same(request.secretHash, presented))
      throw new HttpError(400, ErrorCode.denied, "Unknown request");
    if (request.consumedAt || request.expiresAt < new Date())
      throw new HttpError(400, ErrorCode.expired, "This request has expired");
    if (kind === "device" && request.lastPolledAt && Date.now() - request.lastPolledAt.getTime() < 4000) {
      throw new HttpError(400, ErrorCode.slowDown, "Ask less often");
    }
    await deps.db
      .update(signInRequests)
      .set({ lastPolledAt: new Date() })
      .where(eq(signInRequests.id, request.id));
    if (!request.approvedBy) throw new HttpError(400, ErrorCode.pending, "Not approved yet");
    const consumed = await deps.db
      .update(signInRequests)
      .set({ consumedAt: new Date() })
      .where(and(eq(signInRequests.id, request.id), isNull(signInRequests.consumedAt)))
      .returning({ id: signInRequests.id });
    if (!consumed[0]) throw new HttpError(400, ErrorCode.expired, "This request was already used");
    return c.json(
      await startSession(
        ctx,
        request.approvedBy,
        false,
        (request.client as never) ?? clientKind(c),
        request.deviceName ?? undefined,
      ),
    );
  });

  app.post("/logout", requireUser(deps), async (c) => {
    await revoke(ctx, c.get("sessionId"), c.get("userId"));
    return c.body(null, 204);
  });

  app.get("/sessions", requireUser(deps), async (c) => {
    const rows = await deps.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.accountId, c.get("userId")),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
    return c.json({
      sessions: rows.map((row) => ({
        id: row.id,
        client: row.client,
        deviceName: row.deviceName,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        current: row.id === c.get("sessionId"),
      })),
    });
  });

  /** Signs out everywhere; with ?keep=current, everywhere but here. */
  app.delete("/sessions", requireUser(deps), async (c) => {
    const keep = c.req.query("keep") === "current" ? c.get("sessionId") : undefined;
    const ended = await revokeAll(ctx, c.get("userId"), keep);
    return c.json({ signedOut: ended });
  });

  app.delete("/sessions/:id", requireUser(deps), async (c) => {
    const row = (
      await deps.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, c.req.param("id")), eq(sessions.accountId, c.get("userId"))))
    )[0];
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such session");
    await revoke(ctx, row.id, row.accountId);
    return c.body(null, 204);
  });

  return app;
}
