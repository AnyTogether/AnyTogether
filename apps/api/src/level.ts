import { type Database, library, profiles } from "@anytogether/db";
import {
  type LevelBadge,
  friendsKey,
  levelBadge,
  levelOf,
  privacyOf,
  trophyLevelOf,
} from "@anytogether/shared";
import { eq, inArray, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { publish } from "./events.js";
import { recordLevelUp } from "./feed.js";
import type { Notifier } from "./notifications.js";
import { canSee, people } from "./people.js";

type Ctx = { db: Database; valkey: Redis };

/** Works the trophy level out again from the library's points (after trophies arrived). A new,
 *  higher level is told: a notification to the person, `level.up` to them and to friends who may
 *  see their trophies, and, when `fresh` (the trophies were earned lately), a feed item. Returns
 *  the level before and after. */
export async function refreshTrophyLevel(ctx: Ctx, notes: Notifier | undefined, me: string, fresh: boolean) {
  const changed = await ctx.db.transaction(async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.accountId, me)).for("update");
    if (!profile) return null;
    const [sum] = await tx
      .select({ points: sql<number>`coalesce(sum(${library.points}), 0)::int` })
      .from(library)
      .where(eq(library.accountId, me));
    const points = Number(sum?.points ?? 0);
    const level = levelOf(points);
    if (points !== profile.trophyPoints || level !== profile.trophyLevel)
      await tx
        .update(profiles)
        .set({ trophyPoints: points, trophyLevel: level })
        .where(eq(profiles.accountId, me));
    return { profile, before: profile.trophyLevel, after: level };
  });
  if (!changed || changed.after <= changed.before) return changed;
  const { profile, after } = changed;
  const badge = levelBadge(after);
  await notes?.notify(me, { kind: "level_up", actorId: me, subjectId: "level", data: { ...badge } });
  const event = {
    type: "level.up" as const,
    data: { userId: me, handle: profile.handle, displayName: profile.displayName, ...badge },
  };
  await publish(ctx.valkey, me, event);
  if (privacyOf(profile.privacy).trophies !== "nobody")
    for (const friend of await ctx.valkey.smembers(friendsKey(me))) await publish(ctx.valkey, friend, event);
  if (fresh) await recordLevelUp(ctx, me, after);
  return changed;
}

/** The trophy level of each of `ids` that `viewer` may see (their trophies setting lets them). */
export async function levelsFor(db: Database, viewer: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const result = new Map<string, LevelBadge>();
  if (!unique.length) return result;
  const rows = await db
    .select({ id: profiles.accountId, level: profiles.trophyLevel, privacy: profiles.privacy })
    .from(profiles)
    .where(inArray(profiles.accountId, unique));
  const friends = await people(db).friendsAmong(
    viewer,
    unique.filter((id) => id !== viewer),
  );
  for (const row of rows) {
    const relation = row.id === viewer ? "me" : friends.has(row.id) ? "friend" : "other";
    if (canSee(privacyOf(row.privacy).trophies, relation)) result.set(row.id, levelBadge(row.level));
  }
  return result;
}

/** The whole level of a profile row, with the way to the next one. */
export const fullLevel = (profile: { trophyPoints: number }) => trophyLevelOf(profile.trophyPoints);
