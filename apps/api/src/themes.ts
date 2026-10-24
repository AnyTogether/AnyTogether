import { createHash } from "node:crypto";
import { type Database, accounts, auditLog, profiles, reports, themeLikes, themes } from "@anytogether/db";
import {
  ErrorCode,
  type ThemeCard,
  ThemeDescription,
  type ThemeDetail,
  type ThemeSort,
  type ThemeStatus,
  ThemeUpdate,
  maxThemePage,
  themeExtension,
  themeLimits,
  themePageSize,
  themeReportsToReview,
  themeSorts,
} from "@anytogether/shared";
import { type SQL, and, countDistinct, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, optionalUser, requireUser } from "./middleware.js";
import { clientIp, rateLimiter } from "./ratelimit.js";
import { type BlobStore, postgresStore, readAll, streamOf } from "./storage.js";
import { makeStills, packTheme, readTheme } from "./themeFile.js";

type Row = typeof themes.$inferSelect;
type Maker = { userId: string; handle: string; displayName: string; avatar: string | null } | null;

const folderOf = (id: string, version: number) => `themes/${id}/v${version}/`;
const fileKey = (id: string, version: number) => `${folderOf(id, version)}theme.${themeExtension}`;
export const stillKey = (id: string, version: number, kind: "preview" | "thumb") =>
  `${folderOf(id, version)}${kind}.webp`;
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
/** A file name for the download: "neon-nights.anyps5theme". */
const fileName = (name: string) =>
  `${
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .slice(0, 60) || "theme"
  }.${themeExtension}`;

/** The two routes that take a theme file, bigger than the API's usual body limit. */
export const isThemeUpload = (path: string) =>
  /^\/api\/v1\/themes(\/[0-9a-f-]{36}\/versions)?\/?$/i.test(path);

/** The Theme Hub's files: where they are kept, and the parts of a theme that link to them. */
export function themeFiles(deps: Pick<Deps, "db" | "publicUrl" | "blobs">) {
  const store: BlobStore = deps.blobs ?? postgresStore(deps.db);
  const url = (path: string) => new URL(`/api/v1${path}`, deps.publicUrl).toString();
  const card = (row: Row, maker: Maker): ThemeCard => ({
    id: row.id,
    name: row.name,
    maker,
    version: row.version,
    style: row.style,
    colors: row.colors,
    background: (row.background as ThemeCard["background"]) ?? null,
    music: row.music,
    downloads: row.downloads,
    likes: row.likes,
    preview: url(`/themes/${row.id}/preview.webp?v=${row.version}`),
    thumb: url(`/themes/${row.id}/thumb.webp?v=${row.version}`),
    download: url(`/themes/${row.id}/download`),
    open: `anyps5://theme/${row.id}`,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  return { store, card, url };
}

/** Removes a theme and its files. */
export async function deleteTheme(deps: Pick<Deps, "db" | "publicUrl" | "blobs">, id: string) {
  const { store } = themeFiles(deps);
  await deps.db.delete(themes).where(eq(themes.id, id));
  await store.deletePrefix(`themes/${id}/`);
}

/** Files of themes that are gone (their account was deleted): removed, a few hundred at a time. */
export async function sweepThemeFiles(deps: Pick<Deps, "db" | "publicUrl" | "blobs">) {
  const { store } = themeFiles(deps);
  const ids = [...new Set((await store.list("themes/")).map((key) => key.split("/")[1] ?? ""))].filter(
    isUuid,
  );
  if (!ids.length) return 0;
  const alive = new Set(
    (await deps.db.select({ id: themes.id }).from(themes).where(inArray(themes.id, ids))).map((t) => t.id),
  );
  const gone = ids.filter((id) => !alive.has(id));
  for (const id of gone) await store.deletePrefix(`themes/${id}/`);
  return gone.length;
}

/** A moderator's verdict on a theme: hide it, put it back, or hold it for review. */
export async function setThemeStatus(
  db: Database,
  id: string,
  status: ThemeStatus,
  by?: string,
  more: { actorId?: string; report?: string } = {},
) {
  const [row] = await db
    .update(themes)
    .set({ status })
    .where(eq(themes.id, id))
    .returning({ id: themes.id, name: themes.name, makerId: themes.makerId });
  if (!row) throw new Error(`No theme ${id}`);
  await db.insert(auditLog).values({
    id: uuidv7(),
    actorId: more.actorId ?? null,
    action: `theme.${status}`,
    target: id,
    data: {
      by,
      name: row.name,
      ...(row.makerId ? { maker: row.makerId } : {}),
      ...(more.report ? { report: more.report } : {}),
    },
  });
  return row;
}

/** After a report: a published theme that enough people reported waits for a moderator. */
export async function reviewIfReported(db: Database, id: string) {
  const [open] = await db
    .select({ n: countDistinct(reports.reporterId) })
    .from(reports)
    .where(and(eq(reports.targetKind, "theme"), eq(reports.targetId, id), eq(reports.status, "open")));
  if ((open?.n ?? 0) < themeReportsToReview) return false;
  const changed = await db
    .update(themes)
    .set({ status: "review" })
    .where(and(eq(themes.id, id), eq(themes.status, "published")))
    .returning({ id: themes.id });
  return changed.length > 0;
}

/** What an upload brings: the theme file and, if given, a still and the words on it. */
async function uploadOf(c: Context) {
  const type = c.req.header("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await c.req.parseBody().catch(() => {
      throw new HttpError(400, ErrorCode.badRequest, "The form could not be read");
    });
    const file = form.theme ?? form.file;
    if (!(file instanceof File))
      throw new HttpError(400, ErrorCode.badRequest, `theme: the .${themeExtension} file`);
    const preview = form.preview instanceof File && form.preview.size > 0 ? form.preview : null;
    if (preview && preview.size > themeLimits.preview)
      throw new HttpError(413, ErrorCode.payloadTooLarge, "A preview is at most 8 MB");
    const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : undefined);
    return {
      file: new Uint8Array(await file.arrayBuffer()),
      preview: preview ? new Uint8Array(await preview.arrayBuffer()) : null,
      name: text("name")?.trim() || undefined,
      description: text("description"),
    };
  }
  // The launcher may send the file itself, with its still inside.
  return {
    file: new Uint8Array(await c.req.arrayBuffer()),
    preview: null,
    name: undefined,
    description: undefined,
  };
}

const checked = <T>(
  schema: {
    safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } };
  },
  value: unknown,
  what: string,
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(
      400,
      ErrorCode.badRequest,
      `${what}: ${parsed.error?.issues[0]?.message ?? "not valid"}`,
    );
  return parsed.data as T;
};

/** The Theme Hub: list, search, details and downloads for anyone; sharing, new versions, likes
 *  and changes for the signed-in. Mounted before the routes that need a signed-in user. */
export function themeRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db, valkey } = deps;
  const { store, card } = themeFiles(deps);
  const limit = rateLimiter(valkey, deps.limits);
  const signedIn = requireUser(deps);
  const maybe = optionalUser(deps) as unknown as ReturnType<typeof requireUser>;
  const uploadLimit = bodyLimit({
    maxSize: themeLimits.file + themeLimits.preview + 64 * 1024,
    onError: () => {
      throw new HttpError(413, ErrorCode.payloadTooLarge, "A theme is at most 50 MB");
    },
  });

  const makerColumns = {
    userId: profiles.accountId,
    handle: profiles.handle,
    displayName: profiles.displayName,
    avatar: profiles.avatarUrl,
  };
  const makerOf = (
    m: {
      userId: string | null;
      handle: string | null;
      displayName: string | null;
      avatar: string | null;
    } | null,
  ): Maker =>
    m?.userId && m.handle
      ? { userId: m.userId, handle: m.handle, displayName: m.displayName ?? m.handle, avatar: m.avatar }
      : null;

  /** One theme with its maker; a theme that is not published (or whose maker is not in good
   *  standing) only for its maker. */
  const load = async (id: string, me?: string) => {
    if (!isUuid(id)) throw new HttpError(404, ErrorCode.notFound, "No such theme");
    const [found] = await db
      .select({ theme: themes, maker: makerColumns, makerStatus: accounts.status })
      .from(themes)
      .leftJoin(profiles, eq(profiles.accountId, themes.makerId))
      .leftJoin(accounts, eq(accounts.id, themes.makerId))
      .where(eq(themes.id, id));
    const mine = Boolean(found && me && found.theme.makerId === me);
    if (!found || (!mine && (found.theme.status !== "published" || found.makerStatus !== "active")))
      throw new HttpError(404, ErrorCode.notFound, "No such theme");
    return { row: found.theme, maker: makerOf(found.maker), mine };
  };

  const detail = async (row: Row, maker: Maker, me?: string): Promise<ThemeDetail> => {
    const liked = me
      ? (
          await db
            .select({ id: themeLikes.themeId })
            .from(themeLikes)
            .where(and(eq(themeLikes.themeId, row.id), eq(themeLikes.accountId, me)))
        ).length > 0
      : false;
    return {
      ...card(row, maker),
      description: row.description,
      sha256: row.sha256,
      status: row.status as ThemeStatus,
      liked,
      mine: Boolean(me && row.makerId === me),
    };
  };

  /** Reads, checks and packs an upload, and keeps its files under the version given. */
  const prepare = async (c: Context, id: string, version: number, author: string) => {
    const upload = await uploadOf(c);
    const contents = await readTheme(upload.file);
    const still =
      upload.preview ??
      contents.preview ??
      (contents.background?.kind === "picture" ? contents.background.bytes : null);
    if (!still)
      throw new HttpError(
        400,
        ErrorCode.previewRequired,
        "Add a preview: a picture of the theme, as the launcher makes when it exports one",
      );
    const stills = await makeStills(still);
    if (upload.name)
      contents.json.name =
        checked<{ name?: string }>(ThemeUpdate, { name: upload.name }, "name").name ?? contents.json.name;
    const description =
      upload.description !== undefined
        ? checked<string>(ThemeDescription, upload.description, "description") || null
        : undefined;
    const packed = packTheme(contents, { id, author, version });
    await store.put(fileKey(id, version), packed.bytes);
    await store.put(stillKey(id, version, "preview"), stills.preview);
    await store.put(stillKey(id, version, "thumb"), stills.thumb);
    return {
      description,
      values: {
        name: contents.json.name,
        style: contents.json.style,
        colors: {
          deep: contents.json.deep,
          middle: contents.json.middle,
          bright: contents.json.bright,
          accent: contents.json.accent,
        },
        design: packed.design,
        background: contents.background?.kind ?? null,
        music: Boolean(contents.music),
        size: packed.bytes.length,
        sha256: createHash("sha256").update(packed.bytes).digest("hex"),
      },
      sourceId: contents.json.id?.trim() || null,
    };
  };

  const authorName = async (me: string) => {
    const [profile] = await db
      .select({ displayName: profiles.displayName, handle: profiles.handle, avatar: profiles.avatarUrl })
      .from(profiles)
      .where(eq(profiles.accountId, me));
    if (!profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return profile;
  };

  app.get("/themes", async (c) => {
    const sort = (c.req.query("sort") ?? "new") as ThemeSort;
    if (!themeSorts.includes(sort))
      throw new HttpError(400, ErrorCode.badRequest, `sort: one of ${themeSorts.join(", ")}`);
    const q = (c.req.query("q") ?? "").trim().slice(0, 60);
    const author = (c.req.query("author") ?? "").trim().replace(/^@/, "").slice(0, 40);
    const size = Math.min(Math.max(Number(c.req.query("limit")) || themePageSize, 1), maxThemePage);
    const offset = Math.min(Math.max(Number(c.req.query("cursor")) || 0, 0), 10_000);
    const where: SQL[] = [eq(themes.status, "published"), eq(accounts.status, "active")];
    if (q) {
      const term = `%${escapeLike(q)}%`;
      where.push(
        or(ilike(themes.name, term), ilike(profiles.handle, term), ilike(profiles.displayName, term)) as SQL,
      );
    }
    if (author) where.push(eq(profiles.handle, author));
    const order =
      sort === "popular"
        ? [desc(themes.downloads), desc(themes.likes), desc(themes.createdAt)]
        : sort === "liked"
          ? [desc(themes.likes), desc(themes.downloads), desc(themes.createdAt)]
          : [desc(themes.createdAt)];
    const rows = await db
      .select({ theme: themes, maker: makerColumns })
      .from(themes)
      .innerJoin(accounts, eq(accounts.id, themes.makerId))
      .innerJoin(profiles, eq(profiles.accountId, themes.makerId))
      .where(and(...where))
      .orderBy(...order, desc(themes.id))
      .limit(size + 1)
      .offset(offset);
    c.header("cache-control", "public, max-age=30");
    return c.json({
      themes: rows.slice(0, size).map((r) => card(r.theme, makerOf(r.maker))),
      next: rows.length > size ? String(offset + size) : null,
    });
  });

  /** The index old launchers read (the GitHub folder's themes.json): point their Hub address at
   *  /api/v1/hub/ and they list and install from here. */
  app.get("/hub/themes.json", async (c) => {
    const rows = await db
      .select({ theme: themes, maker: makerColumns })
      .from(themes)
      .innerJoin(accounts, eq(accounts.id, themes.makerId))
      .innerJoin(profiles, eq(profiles.accountId, themes.makerId))
      .where(and(eq(themes.status, "published"), eq(accounts.status, "active")))
      .orderBy(desc(themes.downloads), desc(themes.createdAt))
      .limit(500);
    c.header("cache-control", "public, max-age=300");
    return c.json({
      themes: rows.map(({ theme, maker }) => {
        const shown = card(theme, makerOf(maker));
        return {
          id: theme.id,
          name: theme.name,
          author: maker?.displayName ?? "",
          version: theme.version,
          style: theme.style,
          ...theme.colors,
          package: shown.download,
          preview: shown.thumb,
        };
      }),
    });
  });

  app.get("/me/themes", signedIn, async (c) => {
    const me = c.get("userId");
    const rows = await db
      .select({ theme: themes, maker: makerColumns })
      .from(themes)
      .leftJoin(profiles, eq(profiles.accountId, themes.makerId))
      .where(eq(themes.makerId, me))
      .orderBy(desc(themes.createdAt));
    return c.json({ themes: await Promise.all(rows.map((r) => detail(r.theme, makerOf(r.maker), me))) });
  });

  app.get("/themes/:id", maybe, async (c) => {
    const me = c.get("userId") as string | undefined;
    const { row, maker } = await load(c.req.param("id"), me);
    return c.json(await detail(row, maker, me));
  });

  for (const kind of ["preview", "thumb"] as const)
    app.get(`/themes/:id/${kind}.webp`, async (c) => {
      const { row } = await load(c.req.param("id"));
      const etag = `"${row.id}-${row.version}-${kind}"`;
      const current = c.req.query("v") === String(row.version);
      const cache = {
        "cache-control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
        etag,
      };
      if (c.req.header("if-none-match") === etag) return c.body(null, 304, cache);
      const bytes = await readAll(store, stillKey(row.id, row.version, kind));
      if (!bytes) throw new HttpError(404, ErrorCode.notFound, "No preview");
      return c.body(new Uint8Array(bytes), 200, {
        ...cache,
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
      });
    });

  app.get("/themes/:id/download", maybe, async (c) => {
    const me = c.get("userId") as string | undefined;
    const { row, mine } = await load(c.req.param("id"), me);
    const pieces = await store.get(fileKey(row.id, row.version));
    if (!pieces) throw new HttpError(404, ErrorCode.notFound, "The theme file is missing");
    // One download per person (or address) per theme a day; the maker's own do not count.
    if (!mine) {
      const counted = await valkey.set(
        `themes:dl:${row.id}:${me ?? clientIp(c, deps.clientIpHeader)}`,
        "1",
        "EX",
        86_400,
        "NX",
      );
      if (counted)
        await db
          .update(themes)
          .set({ downloads: sql`${themes.downloads} + 1` })
          .where(eq(themes.id, row.id));
    }
    return new Response(streamOf(pieces), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(row.size),
        "content-disposition": `attachment; filename="${fileName(row.name)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-theme-version": String(row.version),
        "x-theme-sha256": row.sha256,
      },
    });
  });

  app.post("/themes", signedIn, uploadLimit, async (c) => {
    const me = c.get("userId");
    await limit("themeUpload", me);
    const profile = await authorName(me);
    const id = uuidv7();
    try {
      const made = await prepare(c, id, 1, profile.displayName);
      if (made.sourceId) {
        const [same] = await db
          .select({ id: themes.id })
          .from(themes)
          .where(and(eq(themes.makerId, me), eq(themes.sourceId, made.sourceId)));
        if (same)
          throw new HttpError(
            409,
            ErrorCode.conflict,
            "You shared this theme already: send it as a new version",
            {
              themeId: same.id,
            },
          );
      }
      const [row] = await db
        .insert(themes)
        .values({
          id,
          makerId: me,
          sourceId: made.sourceId,
          description: made.description ?? null,
          ...made.values,
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new HttpError(
          409,
          ErrorCode.conflict,
          "You shared this theme already: send it as a new version",
        );
      return c.json(await detail(row, { userId: me, ...profile }, me), 201);
    } catch (error) {
      await store.deletePrefix(`themes/${id}/`);
      throw error;
    }
  });

  app.post("/themes/:id/versions", signedIn, uploadLimit, async (c) => {
    const me = c.get("userId");
    const { row, mine, maker } = await load(c.req.param("id"), me);
    if (!mine) throw new HttpError(403, ErrorCode.forbidden, "Only its maker can change a theme");
    await limit("themeUpload", me);
    const profile = await authorName(me);
    const version = row.version + 1;
    try {
      const made = await prepare(c, row.id, version, profile.displayName);
      const [updated] = await db
        .update(themes)
        .set({
          ...made.values,
          ...(made.description !== undefined ? { description: made.description } : {}),
          sourceId: row.sourceId ?? made.sourceId,
          version,
          updatedAt: new Date(),
        })
        .where(and(eq(themes.id, row.id), eq(themes.version, row.version)))
        .returning();
      if (!updated) throw new HttpError(409, ErrorCode.conflict, "Another version arrived first; try again");
      await store.deletePrefix(folderOf(row.id, row.version));
      return c.json(await detail(updated, maker, me));
    } catch (error) {
      await store.deletePrefix(folderOf(row.id, version));
      throw error;
    }
  });

  app.patch("/themes/:id", signedIn, async (c) => {
    const me = c.get("userId");
    const { row, mine, maker } = await load(c.req.param("id"), me);
    if (!mine) throw new HttpError(403, ErrorCode.forbidden, "Only its maker can change a theme");
    const input = await body(c, ThemeUpdate);
    const design = input.name ? { ...row.design, name: input.name } : row.design;
    const [updated] = await db
      .update(themes)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        design,
        updatedAt: new Date(),
      })
      .where(eq(themes.id, row.id))
      .returning();
    return c.json(await detail(updated ?? row, maker, me));
  });

  app.delete("/themes/:id", signedIn, async (c) => {
    const me = c.get("userId");
    const { row, mine } = await load(c.req.param("id"), me);
    if (!mine) throw new HttpError(403, ErrorCode.forbidden, "Only its maker can delete a theme");
    await deleteTheme(deps, row.id);
    return c.body(null, 204);
  });

  const like = async (c: Context<{ Variables: AuthVariables }>, on: boolean) => {
    const me = c.get("userId");
    await limit("themeLike", me);
    const { row, mine } = await load(c.req.param("id") ?? "", me);
    if (mine) throw new HttpError(400, ErrorCode.badRequest, "That is yours");
    const likes = await db.transaction(async (tx) => {
      const changed = on
        ? await tx
            .insert(themeLikes)
            .values({ themeId: row.id, accountId: me })
            .onConflictDoNothing()
            .returning()
        : await tx
            .delete(themeLikes)
            .where(and(eq(themeLikes.themeId, row.id), eq(themeLikes.accountId, me)))
            .returning();
      if (!changed.length) return row.likes;
      const [updated] = await tx
        .update(themes)
        .set({ likes: sql`greatest(0, ${themes.likes} ${on ? sql`+` : sql`-`} 1)` })
        .where(eq(themes.id, row.id))
        .returning({ likes: themes.likes });
      return updated?.likes ?? row.likes;
    });
    return c.json({ liked: on, likes });
  };
  app.put("/themes/:id/like", signedIn, (c) => like(c, true));
  app.post("/themes/:id/like", signedIn, (c) => like(c, true));
  app.delete("/themes/:id/like", signedIn, (c) => like(c, false));

  return app;
}
