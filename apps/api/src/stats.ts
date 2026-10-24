import { accounts, earnedTrophies, playSessions, themes } from "@anytogether/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";

/** A few totals for the website's front page: counts only, never who. Worked out at most once a
 *  minute and kept in Valkey, so a busy front page costs the database nothing. */

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

  app.get("/stats", async (c) => {
    const cached = await deps.valkey.get(key);
    const stats: PublicStats = cached ? JSON.parse(cached) : await count();
    if (!cached) await deps.valkey.set(key, JSON.stringify(stats), "EX", keepFor);
    c.header("cache-control", "public, max-age=60");
    return c.json(stats);
  });

  return app;
}
