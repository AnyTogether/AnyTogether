import { type Database, accounts, friendships, games, metPlayers, profiles } from "@anytogether/db";
import {
  ErrorCode,
  type MeetingSource,
  type MetPlayer,
  type MetPlayersView,
  MetSettingsUpdate,
  TitleId,
  devicePresenceKey,
  maxMetList,
  metKeepDays,
  metListDays,
  presenceDevicesKey,
  presenceKey,
} from "@anytogether/shared";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { noBlockBetween, people } from "./people.js";

type Ctx = { db: Database; valkey: Redis };

/** The game someone's presence says they are in now, when it is a real title ID. For someone whose
 *  presence is hidden (appearing offline), no merged presence is kept: their devices' own say. */
export async function playingNow(valkey: Redis, userId: string) {
  const merged = await valkey.get(presenceKey(userId));
  const devices = merged ? [] : await valkey.smembers(presenceDevicesKey(userId));
  const kept = merged
    ? [merged]
    : devices.length
      ? await valkey.mget(...devices.map((id) => devicePresenceKey(userId, id)))
      : [];
  for (const raw of kept) {
    if (!raw) continue;
    const presence = JSON.parse(raw) as { state?: string; titleId?: string };
    if (presence.state === "in_game" && TitleId.safeParse(presence.titleId).success)
      return presence.titleId as string;
  }
  return null;
}

/** `me` played with `others` (joined their party, share play or game, or was let in on a post):
 *  remembered both ways, for pairs where both remember meetings, neither blocked the other and
 *  both accounts are in good standing. Meeting again within an hour does not count twice. Never
 *  fails the action it follows. */
export async function recordMeeting(
  ctx: Ctx,
  me: string,
  others: string[],
  source: MeetingSource,
  titleId: string | null | undefined,
) {
  const rest = [...new Set(others)].filter((id) => id !== me);
  if (!rest.length) return;
  try {
    const title = titleId && TitleId.safeParse(titleId).success ? titleId : null;
    if (title) await ctx.db.insert(games).values({ titleId: title }).onConflictDoNothing();
    const willing = await ctx.db
      .select({ id: profiles.accountId })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(
        and(
          inArray(profiles.accountId, [me, ...rest]),
          eq(profiles.rememberMet, true),
          eq(accounts.status, "active"),
          sql`(${profiles.accountId} = ${me}::uuid or ${noBlockBetween(me, profiles.accountId)})`,
        ),
      );
    const ids = new Set(willing.map((w) => w.id));
    if (!ids.has(me)) return;
    const met = rest.filter((id) => ids.has(id));
    if (!met.length) return;
    await ctx.db
      .insert(metPlayers)
      .values(
        met.flatMap((other) => [
          { accountId: me, otherId: other, source, titleId: title },
          { accountId: other, otherId: me, source, titleId: title },
        ]),
      )
      .onConflictDoUpdate({
        target: [metPlayers.accountId, metPlayers.otherId],
        set: {
          source: sql`excluded.source`,
          titleId: sql`coalesce(excluded.title_id, ${metPlayers.titleId})`,
          times: sql`${metPlayers.times} + case when ${metPlayers.lastMetAt} < now() - interval '1 hour' then 1 else 0 end`,
          lastMetAt: sql`now()`,
        },
      });
  } catch (error) {
    console.error("could not remember a meeting", error);
  }
}

/** Meetings older than 90 days are forgotten. */
export async function pruneMeetings(db: Database, now = Date.now()) {
  const removed = await db
    .delete(metPlayers)
    .where(
      sql`${metPlayers.lastMetAt} < ${new Date(now - metKeepDays * 86_400_000).toISOString()}::timestamptz`,
    )
    .returning({ id: metPlayers.accountId });
  return removed.length;
}

const Days = z.coerce.number().int().min(1).max(metKeepDays);

/** "Recently played with": who the reader played with lately, to befriend or block from there. */
export function metRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);

  const rememberOf = async (me: string) =>
    (await db.select({ remember: profiles.rememberMet }).from(profiles).where(eq(profiles.accountId, me)))[0]
      ?.remember ?? true;

  app.get("/me/players-met", async (c) => {
    const me = c.get("userId");
    const raw = c.req.query("days");
    const parsed = Days.safeParse(raw ?? metListDays);
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, `days: 1 to ${metKeepDays}`);
    const days = parsed.data;
    const rows = await db
      .select({ met: metPlayers, game: games })
      .from(metPlayers)
      .innerJoin(accounts, and(eq(accounts.id, metPlayers.otherId), eq(accounts.status, "active")))
      .leftJoin(games, eq(games.titleId, metPlayers.titleId))
      .where(
        and(
          eq(metPlayers.accountId, me),
          gt(metPlayers.lastMetAt, new Date(Date.now() - days * 86_400_000)),
          noBlockBetween(me, metPlayers.otherId),
        ),
      )
      .orderBy(desc(metPlayers.lastMetAt))
      .limit(maxMetList);
    const ids = rows.map((r) => r.met.otherId);
    const cards = await who.cards(ids);
    const links = ids.length
      ? await db
          .select()
          .from(friendships)
          .where(
            or(
              and(eq(friendships.userA, me), inArray(friendships.userB, ids)),
              and(eq(friendships.userB, me), inArray(friendships.userA, ids)),
            ),
          )
      : [];
    const friendship = new Map(
      links.map((f) => [
        f.userA === me ? f.userB : f.userA,
        f.state === "accepted" ? "friends" : f.askedBy === me ? "pending_out" : "pending_in",
      ]),
    );
    const players = rows.flatMap(({ met, game }): MetPlayer[] => {
      const user = cards.get(met.otherId);
      if (!user) return [];
      return [
        {
          user,
          lastMetAt: met.lastMetAt.toISOString(),
          firstMetAt: met.firstMetAt.toISOString(),
          source: met.source as MeetingSource,
          game: game ? { titleId: game.titleId, names: game.names, iconUrl: game.iconUrl } : null,
          times: met.times,
          friendship: (friendship.get(met.otherId) ?? "none") as MetPlayer["friendship"],
        },
      ];
    });
    const view: MetPlayersView = { remember: await rememberOf(me), days, players };
    return c.json(view);
  });

  app.patch("/me/players-met", async (c) => {
    const me = c.get("userId");
    const { remember } = await body(c, MetSettingsUpdate);
    await db.update(profiles).set({ rememberMet: remember }).where(eq(profiles.accountId, me));
    // Turned off: every meeting with the account goes, both ways.
    if (!remember)
      await db.delete(metPlayers).where(or(eq(metPlayers.accountId, me), eq(metPlayers.otherId, me)));
    return c.json({ remember });
  });

  /** Forgets one person from the reader's list (they keep theirs). */
  app.delete("/me/players-met/:userId", async (c) => {
    const me = c.get("userId");
    const other = c.req.param("userId");
    if (!z.string().uuid().safeParse(other).success)
      throw new HttpError(404, ErrorCode.notFound, "Not on the list");
    const removed = await db
      .delete(metPlayers)
      .where(and(eq(metPlayers.accountId, me), eq(metPlayers.otherId, other)))
      .returning();
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "Not on the list");
    return c.body(null, 204);
  });

  return app;
}
