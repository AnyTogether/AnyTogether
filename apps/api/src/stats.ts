import { accounts, earnedTrophies, playSessions, themes } from "@anytogether/db";
import { presenceHiddenKey } from "@anytogether/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";

/** A few totals for the website's front page, and how many are online for Find players: counts
 *  only, never who. Worked out at most once a minute (the online count every half minute) and kept
 *  in Valkey, so a busy page costs the database nothing. */

export interface PublicStats {
  /** Accounts in good standing. */
  players: number;
  /** Hours played in the last seven days, all players together, rounded down. */
  hoursThisWeek: number;
  /** Trophies earned, all time. */
  trophies: number;
  /** Themes on the Theme Hub. */
  themes: number;
}

const key = "stats:public";
const keepFor = 120;

/** How many accounts are online now, for Find players: a number only, never who. */
export interface OnlineNow {
  /** Accounts online, away or in a game whose presence is not hidden. Anyone who appears offline
   *  or shows their presence to nobody is left out, because the gateway keeps nothing for them. */
  online: number;
}

const onlineKey = "stats:online";
const onlineKeepFor = 30;

export function statsRoutes(deps: Deps) {
  const app = new Hono();

  const count = async (): Promise<PublicStats> => {
    const week = new Date(Date.now() - 7 * 86_400_000);
    const total = sql<number>`count(*)::int`;
    const [[players], [played], [trophies], [shared]] = await Promise.all([
      deps.db.select({ n: total }).from(accounts).where(eq(accounts.status, "active")),
      deps.db
        .select({
          n: sql<number>`coalesce(floor(sum(extract(epoch from ${playSessions.endedAt} - ${playSessions.startedAt})) / 3600), 0)::int`,
        })
        .from(playSessions)
        .where(gt(playSessions.endedAt, week)),
      deps.db.select({ n: total }).from(earnedTrophies).where(eq(earnedTrophies.flagged, false)),
      deps.db
        .select({ n: total })
        .from(themes)
        .innerJoin(accounts, eq(accounts.id, themes.makerId))
        .where(and(eq(themes.status, "published"), eq(accounts.status, "active"))),
    ]);
    return {
      players: players?.n ?? 0,
      hoursThisWeek: played?.n ?? 0,
      trophies: trophies?.n ?? 0,
      themes: shared?.n ?? 0,
    };
  };

  /** The merged presences the gateway keeps, one per account (`presence:<id>`, gone when the
   *  account goes offline or hides its presence), counted with SCAN so Valkey is never held up.
   *  A device's own presence (`presence:<id>:<session>`) is not counted, and an account marked
   *  hidden is left out even if a presence of theirs was still kept. */
  const countOnline = async (): Promise<OnlineNow> => {
    const prefix = "presence:";
    const ids = new Set<string>();
    let cursor = "0";
    do {
      const [next, keys] = await deps.valkey.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 1000);
      cursor = next;
      for (const found of keys) if (!found.includes(":", prefix.length)) ids.add(found.slice(prefix.length));
    } while (cursor !== "0");
    const all = [...ids];
    let online = 0;
    for (let at = 0; at < all.length; at += 500) {
      const part = all.slice(at, at + 500);
      const hidden = await deps.valkey.mget(...part.map((id) => presenceHiddenKey(id)));
      online += hidden.filter((value) => value === null).length;
    }
    return { online };
  };

  app.get("/stats/online", async (c) => {
    const cached = await deps.valkey.get(onlineKey);
    const now: OnlineNow = cached ? JSON.parse(cached) : await countOnline();
    if (!cached) await deps.valkey.set(onlineKey, JSON.stringify(now), "EX", onlineKeepFor);
    c.header("cache-control", "public, max-age=30");
    return c.json(now);
  });

  app.get("/stats", async (c) => {
    const cached = await deps.valkey.get(key);
    const stats: PublicStats = cached ? JSON.parse(cached) : await count();
    if (!cached) await deps.valkey.set(key, JSON.stringify(stats), "EX", keepFor);
    c.header("cache-control", "public, max-age=60");
    return c.json(stats);
  });

  return app;
}
