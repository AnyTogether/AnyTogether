import { type Database, joinCodes } from "@anytogether/db";
import {
  ErrorCode,
  type JoinCode,
  type JoinCodeKind,
  type JoinCodeRedeemed,
  type JoinCodeView,
  isJoinCode,
  joinCodeAlphabet,
  joinCodeHours,
  joinCodeLength,
  joinCodeUrl,
  normalizeJoinCode,
} from "@anytogether/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { type AuthVariables, optionalUser, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import type { PartyService } from "./parties.js";
import { withoutIds } from "./publicProfiles.js";
import { clientIp, rateLimiter } from "./ratelimit.js";
import type { SharePlayService } from "./sharePlays.js";

type Row = typeof joinCodes.$inferSelect;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(joinCodeLength));
  return [...bytes].map((b) => joinCodeAlphabet[b % joinCodeAlphabet.length]).join("");
}

const noCode = () => new HttpError(404, ErrorCode.notFound, "No such code, or it stopped working");

/** The codes themselves: one working code per party or share play at a time. */
export function joinCodeStore(deps: { db: Database; publicUrl: string }) {
  const { db } = deps;
  const working = () => and(isNull(joinCodes.revokedAt), gt(joinCodes.expiresAt, new Date()));
  const asCode = (row: Row): JoinCode => ({
    code: row.code,
    url: joinCodeUrl(deps.publicUrl, row.code),
    expiresAt: row.expiresAt.toISOString(),
  });

  /** The code that works now for it, if any. */
  async function current(kind: JoinCodeKind, targetId: string) {
    const [row] = await db
      .select()
      .from(joinCodes)
      .where(and(eq(joinCodes.kind, kind), eq(joinCodes.targetId, targetId), working()));
    return row ? asCode(row) : null;
  }

  /** Every code for it stops working; how many did. */
  async function revoke(kind: JoinCodeKind, targetId: string) {
    const gone = await db
      .update(joinCodes)
      .set({ revokedAt: new Date() })
      .where(and(eq(joinCodes.kind, kind), eq(joinCodes.targetId, targetId), isNull(joinCodes.revokedAt)))
      .returning();
    return gone.filter((row) => row.expiresAt > new Date()).length;
  }

  /** A new code in place of the one before. */
  async function issue(kind: JoinCodeKind, targetId: string, by: string, hours = joinCodeHours) {
    await revoke(kind, targetId);
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [made] = await db
        .insert(joinCodes)
        .values({ code: newCode(), kind, targetId, createdBy: by, expiresAt })
        .onConflictDoNothing()
        .returning();
      if (made) return asCode(made);
    }
    throw new HttpError(409, ErrorCode.conflict, "Try again");
  }

  /** The working code as typed (case, spaces and dashes aside). */
  async function find(raw: string) {
    const code = normalizeJoinCode(raw);
    if (!isJoinCode(code)) return undefined;
    const [row] = await db
      .select()
      .from(joinCodes)
      .where(and(eq(joinCodes.code, code), working()));
    return row;
  }

  return { current, revoke, issue, find };
}
export type JoinCodeStore = ReturnType<typeof joinCodeStore>;

/** What a code opens, to anyone holding it, and asking to join with it. Mounted before the
 *  signed-in routes: reading a code needs no account (a link opened from Discord). */
export function joinCodeRoutes(
  deps: Deps,
  codes: JoinCodeStore,
  parties: PartyService,
  shares: SharePlayService,
) {
  const app = new Hono<{ Variables: Partial<AuthVariables> }>();
  const limit = rateLimiter(deps.valkey, deps.limits);

  /** The code's target while it lasts, as `me` may see it (nobody blocked either way). */
  async function open(raw: string, me: string | undefined) {
    const row = await codes.find(raw);
    if (!row) throw noCode();
    const summary =
      row.kind === "party"
        ? await parties.codeTarget(row.targetId, me)
        : await shares.codeTarget(row.targetId, me);
    if (!summary) throw noCode();
    return { row, summary };
  }

  app.get("/join/:code", optionalUser(deps), async (c) => {
    const me = c.get("userId");
    await limit("joinCodeLookup", me ?? clientIp(c, deps.clientIpHeader));
    const { row, summary } = await open(c.req.param("code"), me);
    const view: JoinCodeView = {
      code: row.code,
      kind: row.kind as JoinCodeKind,
      id: row.targetId,
      host: summary.host,
      game: summary.game,
      size: summary.size,
      max: summary.max,
      expiresAt: row.expiresAt.toISOString(),
      ...(me ? { state: summary.state } : {}),
    };
    return c.json(me ? view : withoutIds(view));
  });

  /** Asks to join with the code: the leader or host hears it and says yes or no. */
  app.post("/join/:code", requireUser(deps), async (c) => {
    const me = c.get("userId") as string;
    await limit("joinCodeLookup", me);
    await assertNotMuted(deps.db, me);
    const { row } = await open(c.req.param("code"), me);
    const outcome =
      row.kind === "party"
        ? await parties.askWithCode(row.targetId, me)
        : await shares.askWithCode(row.targetId, me);
    const answer: JoinCodeRedeemed = {
      kind: row.kind as JoinCodeKind,
      id: row.targetId,
      state: outcome.state,
    };
    return c.json(answer, outcome.made ? 201 : 200);
  });

  return app;
}
