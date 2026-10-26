import { type Database, compatReports, compatSummaries, games } from "@anytogether/db";
import {
  type CompatGame,
  type CompatOnline,
  type CompatPlatform,
  CompatReport,
  type CompatReportView,
  type CompatStatus,
  type CompatSummary,
  ErrorCode,
  TitleId,
  compareVersions,
  compatOnline,
  compatPageSize,
  compatSorts,
  compatStatuses,
  maxCompatPage,
  platforms,
} from "@anytogether/shared";
import { type SQL, and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, optionalUser, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";

const rank = (status: string) => compatStatuses.indexOf(status as CompatStatus);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const nameOf = (names: Record<string, string>) => names.en ?? Object.values(names)[0] ?? null;

/** Works out one game's verdict on one platform again: of the reports on the newest launcher
 *  version anyone tested (each person's latest only), the status most of them gave; a tie goes to
 *  the better one. */
export async function refreshSummary(db: Database, titleId: string, platform: CompatPlatform) {
  const rows = await db
    .select()
    .from(compatReports)
    .where(and(eq(compatReports.titleId, titleId), eq(compatReports.platform, platform)))
    .orderBy(desc(compatReports.createdAt))
    .limit(1000);
  if (!rows.length) {
    await db
      .delete(compatSummaries)
      .where(and(eq(compatSummaries.titleId, titleId), eq(compatSummaries.platform, platform)));
    return null;
  }
  const newest = rows.map((r) => r.launcherVersion).reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
  const seen = new Set<string>();
  const votes = new Map<string, number>();
  for (const row of rows) {
    if (compareVersions(row.launcherVersion, newest) !== 0) continue;
    // Reports of deleted accounts each count once; a person counts once, with their latest.
    const who = row.accountId ?? row.id;
    if (seen.has(who)) continue;
    seen.add(who);
    votes.set(row.status, (votes.get(row.status) ?? 0) + 1);
  }
  const [status] = [...votes.entries()].sort((a, b) => b[1] - a[1] || rank(b[0]) - rank(a[0]))[0] ?? [
    "nothing",
  ];
  // Online play: each person's latest report that says, on any version; a tie goes to works.
  const said = new Set<string>();
  const online = { works: 0, broken: 0 };
  for (const row of rows) {
    if (row.online !== "works" && row.online !== "broken") continue;
    const who = row.accountId ?? row.id;
    if (said.has(who)) continue;
    said.add(who);
    online[row.online] += 1;
  }
  const summary = {
    titleId,
    platform,
    status,
    version: newest,
    testedAt: rows[0]?.createdAt ?? new Date(),
    reports: rows.length,
    online: (said.size ? (online.works >= online.broken ? "works" : "broken") : null) as CompatOnline | null,
  };
  await db
    .insert(compatSummaries)
    .values(summary)
    .onConflictDoUpdate({
      target: [compatSummaries.titleId, compatSummaries.platform],
      set: {
        status,
        version: newest,
        testedAt: summary.testedAt,
        reports: summary.reports,
        online: summary.online,
      },
    });
  return summary;
}

const summaryOf = (row: typeof compatSummaries.$inferSelect): CompatSummary => ({
  status: row.status as CompatStatus,
  version: row.version,
  testedAt: row.testedAt.toISOString(),
  reports: row.reports,
  online: row.online === "works" || row.online === "broken" ? row.online : null,
});

/** The compatibility list: verdicts per game and platform for anyone, reports from the
 *  signed-in. Mounted before the routes that need a signed-in user. */
export function compatRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);
  const maybe = optionalUser(deps) as unknown as ReturnType<typeof requireUser>;

  const withSummaries = async (rows: (typeof games.$inferSelect)[]): Promise<CompatGame[]> => {
    const summaries = rows.length
      ? await db
          .select()
          .from(compatSummaries)
          .where(
            inArray(
              compatSummaries.titleId,
              rows.map((r) => r.titleId),
            ),
          )
      : [];
    return rows.map((game) => ({
      titleId: game.titleId,
      name: nameOf(game.names),
      names: game.names,
      iconUrl: game.iconUrl,
      platforms: Object.fromEntries(
        summaries.filter((s) => s.titleId === game.titleId).map((s) => [s.platform, summaryOf(s)]),
      ),
    }));
  };

  app.get("/compat", async (c) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 80);
    const platform = c.req.query("platform");
    const status = c.req.query("status");
    const online = c.req.query("online");
    const sort = c.req.query("sort") || "updated";
    if (platform && !(platforms as readonly string[]).includes(platform))
      throw new HttpError(400, ErrorCode.badRequest, `platform: one of ${platforms.join(", ")}`);
    if (status && !(compatStatuses as readonly string[]).includes(status))
      throw new HttpError(400, ErrorCode.badRequest, `status: one of ${compatStatuses.join(", ")}`);
    if (online && !(compatOnline as readonly string[]).includes(online))
      throw new HttpError(400, ErrorCode.badRequest, `online: one of ${compatOnline.join(", ")}`);
    if (!(compatSorts as readonly string[]).includes(sort))
      throw new HttpError(400, ErrorCode.badRequest, `sort: one of ${compatSorts.join(", ")}`);
    const size = Math.min(Math.max(Number(c.req.query("limit")) || compatPageSize, 1), maxCompatPage);
    const offset = Math.min(Math.max(Number(c.req.query("cursor")) || 0, 0), 100_000);
    const reported: SQL[] = [eq(compatSummaries.titleId, games.titleId)];
    if (platform) reported.push(eq(compatSummaries.platform, platform));
    if (status) reported.push(eq(compatSummaries.status, status));
    // The filters hold on one platform together: "online works on Linux", not on any two.
    if (online) reported.push(eq(compatSummaries.online, online));
    const where: SQL[] = [
      exists(
        db
          .select({ one: sql`1` })
          .from(compatSummaries)
          .where(and(...reported)),
      ),
    ];
    if (q) {
      const term = `%${escapeLike(q)}%`;
      where.push(or(ilike(games.titleId, term), sql`${games.names}::text ilike ${term}`) as SQL);
    }
    const onPlatform = platform ? sql`and s.platform = ${platform}` : sql``;
    const latest = sql`(select max(s.tested_at) from compat_summaries s where s.title_id = ${games.titleId} ${onPlatform})`;
    // Best status first: the game's best verdict (on the platform asked for, if any).
    const best = sql`(select max(array_position(array['nothing','boots','menus','ingame','playable']::text[], s.status))
      from compat_summaries s where s.title_id = ${games.titleId} ${onPlatform})`;
    const name = sql`lower(coalesce(${games.names}->>'en', (select v from jsonb_each_text(${games.names}) as n(k, v) order by k limit 1), ${games.titleId}))`;
    const order =
      sort === "name"
        ? [name, games.titleId]
        : sort === "status"
          ? [sql`${best} desc nulls last`, desc(latest), games.titleId]
          : [desc(latest), games.titleId];
    const rows = await db
      .select()
      .from(games)
      .where(and(...where))
      .orderBy(...order)
      .limit(size + 1)
      .offset(offset);
    const [total] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(games)
      .where(and(...where));
    c.header("cache-control", "public, max-age=30");
    return c.json({
      games: await withSummaries(rows.slice(0, size)),
      total: total?.n ?? 0,
      sort,
      next: rows.length > size ? String(offset + size) : null,
    });
  });

  app.get("/compat/:titleId", maybe, async (c) => {
    const parsed = TitleId.safeParse(c.req.param("titleId"));
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const me = c.get("userId") as string | undefined;
    const [game] = await db.select().from(games).where(eq(games.titleId, parsed.data));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const [shown] = await withSummaries([game]);
    const rows = await db
      .select()
      .from(compatReports)
      .where(eq(compatReports.titleId, game.titleId))
      .orderBy(desc(compatReports.createdAt))
      .limit(50);
    const reports: CompatReportView[] = rows.map((r) => ({
      id: r.id,
      platform: r.platform as CompatPlatform,
      status: r.status as CompatStatus,
      launcherVersion: r.launcherVersion,
      engineVersion: r.engineVersion,
      gameVersion: r.gameVersion,
      machine: r.machine,
      os: r.os,
      fpsAvg: r.fpsAvg === null ? null : Math.round(r.fpsAvg * 10) / 10,
      online: r.online === "works" || r.online === "broken" ? r.online : null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      mine: Boolean(me && r.accountId === me),
    }));
    return c.json({ ...shown, reports });
  });

  app.post("/compat/reports", requireUser(deps), async (c) => {
    const me = c.get("userId");
    const input = await body(c, CompatReport);
    await limit("compatReport", me);
    // A game nobody taught yet is added with the name given; a known name is never replaced.
    await db
      .insert(games)
      .values({ titleId: input.titleId, names: input.name ? { en: input.name } : {}, taughtBy: me })
      .onConflictDoNothing();
    if (input.name)
      await db
        .update(games)
        .set({ names: { en: input.name } })
        .where(
          and(eq(games.titleId, input.titleId), eq(games.locked, false), sql`${games.names} = '{}'::jsonb`),
        );
    const [report] = await db
      .insert(compatReports)
      .values({
        id: uuidv7(),
        accountId: me,
        titleId: input.titleId,
        platform: input.platform,
        status: input.status,
        launcherVersion: input.launcherVersion,
        engineVersion: input.engineVersion ?? null,
        gameVersion: input.gameVersion || null,
        machine: input.machine || null,
        os: input.os || null,
        fpsAvg: input.fpsAvg ?? null,
        online: input.online ?? null,
        note: input.note || null,
      })
      .returning({ id: compatReports.id });
    const summary = await refreshSummary(db, input.titleId, input.platform);
    return c.json(
      { id: report?.id, summary: summary && summaryOf({ ...summary, testedAt: summary.testedAt }) },
      201,
    );
  });

  app.delete("/compat/reports/:id", requireUser(deps), async (c) => {
    const me = c.get("userId");
    const id = c.req.param("id");
    const [gone] = /^[0-9a-f-]{36}$/i.test(id)
      ? await db
          .delete(compatReports)
          .where(and(eq(compatReports.id, id), eq(compatReports.accountId, me)))
          .returning()
      : [];
    if (!gone) throw new HttpError(404, ErrorCode.notFound, "No such report");
    await refreshSummary(db, gone.titleId, gone.platform as CompatPlatform);
    return c.body(null, 204);
  });

  return app;
}
