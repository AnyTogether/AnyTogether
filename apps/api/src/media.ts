import { open, readFile, rm, writeFile } from "node:fs/promises";
import { conversationMembers, media, messages, postMedia, profiles, storedFiles } from "@anytogether/db";
import {
  type AttachmentView,
  ErrorCode,
  GalleryUpdate,
  type MediaKind,
  type MediaView,
  mediaKinds,
  mediaLimits,
  privacyOf,
} from "@anytogether/shared";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { type FileService, type StagedFile, type Tx, needFiles, quotaError, receive } from "./files.js";
import { body } from "./http.js";
import { BadMedia, readClip, readVoice, sniff } from "./mediaCheck.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import { canSee, findProfile, people, relationOf } from "./people.js";
import { seesPost, seesStrangers } from "./postAccess.js";
import { rateLimiter } from "./ratelimit.js";
import { slotViews } from "./saves.js";

type Media = typeof media.$inferSelect;
type Querier = Pick<Tx, "select">;

const hourMs = 3600_000;
/** Links in messages and galleries last 12 to 24 hours (the same link all through a 12-hour
 *  window, so it can be cached); links for the owner's own lists an hour or two. */
const shareWindow = 12 * hourMs;
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
const variants = ["file", "thumb", "poster"] as const;
type Variant = (typeof variants)[number];

const badMedia = (why: string) => new HttpError(400, ErrorCode.badMedia, why);
const badImage = () => new HttpError(400, ErrorCode.badImage, "That picture could not be read");

sharp.cache(false);

/** A picture as kept: turned upright, re-encoded as WebP without metadata (no location, camera or
 *  comments), and a small one for lists. */
async function makeImage(input: string, maxSide?: number) {
  const open_ = () =>
    sharp(input, {
      limitInputPixels: mediaLimits.pixels,
      failOn: "error",
      sequentialRead: true,
      animated: false,
    });
  try {
    const meta = await open_().metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format ?? "")) throw badImage();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    if (!width || !height || width * height > mediaLimits.pixels) throw badImage();
    const full = open_().rotate();
    if (maxSide) full.resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true });
    const file = await full.webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    const thumb = await open_()
      .rotate()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { file: file.data, width: file.info.width, height: file.info.height, thumb };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badImage();
  }
}

const contentTypeOf = (row: Media, variant: Variant) => (variant === "file" ? row.contentType : "image/webp");
const shaOf = (row: Media, variant: Variant) =>
  variant === "file" ? row.sha256 : variant === "thumb" ? row.thumbSha256 : row.posterSha256;

/** Photos, clips and voice notes: kept per account, used in messages and the profile gallery, and
 *  shown through signed links to whoever may see them. */
export function mediaService(deps: Deps) {
  const { db } = deps;
  const who = people(db);

  const view = (
    f: FileService,
    row: Media,
    options: { owner?: boolean; expires?: number } = {},
  ): MediaView => {
    const expires = options.expires ?? f.windowEnd(shareWindow);
    const at = (variant: Variant) => f.link(`media/${row.id}/${variant}`, expires, options.owner);
    return {
      id: row.id,
      kind: row.kind as MediaKind,
      contentType: row.contentType,
      size: row.size,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      url: at("file"),
      thumb: row.thumbSha256 ? at("thumb") : null,
      poster: row.posterSha256 ? at("poster") : null,
      ...(row.status === "hidden" ? { hidden: true } : {}),
      ...(options.owner ? { gallery: row.galleryPosition } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  };

  /** The attachments of these messages as `viewer` (a member of their conversations) sees them:
   *  the media, or "removed" (deleted or hidden), or "blocked" between the two of them. */
  async function attachmentsFor(viewer: string, rows: (typeof messages.$inferSelect)[]) {
    const result = new Map<string, AttachmentView[]>();
    const wanted = rows.flatMap((m) =>
      m.deletedAt ? [] : (m.attachments as { mediaId: string; kind: MediaKind }[]),
    );
    if (!wanted.length) return result;
    const f = deps.files;
    const found = f
      ? new Map(
          (
            await db
              .select()
              .from(media)
              .where(
                inArray(
                  media.id,
                  wanted.map((a) => a.mediaId),
                ),
              )
          ).map((m) => [m.id, m]),
        )
      : new Map<string, Media>();
    const blocked = await who.blockedAmong(
      viewer,
      [...new Set([...found.values()].map((m) => m.accountId))].filter((id) => id !== viewer),
    );
    for (const m of rows) {
      if (m.deletedAt) continue;
      result.set(
        m.id,
        (m.attachments as { mediaId: string; kind: MediaKind }[]).map((a): AttachmentView => {
          const row = found.get(a.mediaId);
          const owner = row?.accountId === viewer;
          if (!f || !row || (row.status !== "active" && !owner))
            return { id: a.mediaId, kind: a.kind, removed: true };
          if (blocked.has(row.accountId)) return { id: a.mediaId, kind: a.kind, blocked: true };
          return view(f, row, { owner });
        }),
      );
    }
    return result;
  }

  /** The sender's own media for a message: active, and now in use. */
  async function attachable(me: string, ids: string[]) {
    if (!ids.length) return [];
    needFiles(deps.files);
    const rows = await db
      .select()
      .from(media)
      .where(and(inArray(media.id, ids), eq(media.accountId, me), eq(media.status, "active")));
    if (rows.length !== new Set(ids).size)
      throw new HttpError(400, ErrorCode.badRequest, "attachments: only your own media, uploaded first");
    await db
      .update(media)
      .set({ usedAt: new Date() })
      .where(and(inArray(media.id, ids), isNull(media.usedAt)));
    return rows;
  }

  /** Deletes a piece of media and the files nothing else uses. */
  async function remove(f: FileService, row: Pick<Media, "id" | "accountId">) {
    return f.within(row.accountId, async (tx) => {
      const [gone] = await tx.delete(media).where(eq(media.id, row.id)).returning();
      if (!gone) return false;
      await f.release(tx, row.accountId, [gone.sha256, gone.thumbSha256, gone.posterSha256]);
      return true;
    });
  }

  /** The owner's media nothing uses any more goes: not pinned, in no message and in no post. */
  async function releaseUnused(accountId: string, ids: string[]) {
    const f = deps.files;
    if (!f || !ids.length) return;
    for (const id of new Set(ids)) {
      const [row] = await db
        .select()
        .from(media)
        .where(and(eq(media.id, id), eq(media.accountId, accountId)));
      if (!row || row.galleryPosition !== null) continue;
      const [elsewhere] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.authorId, accountId),
            isNull(messages.deletedAt),
            sql`${messages.attachments} @> ${JSON.stringify([{ mediaId: id }])}::jsonb`,
          ),
        )
        .limit(1);
      if (elsewhere) continue;
      const [posted] = await db
        .select({ id: postMedia.postId })
        .from(postMedia)
        .where(eq(postMedia.mediaId, id))
        .limit(1);
      if (!posted) await remove(f, row);
    }
  }

  /** After a message with media was deleted: its media goes too, unless it is pinned, still in
   *  another message or in a post. */
  async function releaseFrom(message: typeof messages.$inferSelect) {
    const ids = (message.attachments as { mediaId: string }[]).map((a) => a.mediaId);
    if (!message.authorId) return;
    await releaseUnused(message.authorId, ids);
  }

  /** Whether `viewer` can see this media now: its owner, a member of a conversation it was sent
   *  in, or someone its owner's gallery is open to; never across a block. */
  async function canView(viewer: string, row: Media) {
    if (row.accountId === viewer) return true;
    if (row.status !== "active" || (await who.blocked(viewer, row.accountId))) return false;
    const [sent] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.accountId, viewer),
        ),
      )
      .where(
        and(
          eq(messages.authorId, row.accountId),
          isNull(messages.deletedAt),
          sql`${messages.attachments} @> ${JSON.stringify([{ mediaId: row.id }])}::jsonb`,
        ),
      )
      .limit(1);
    if (sent) return true;
    // In a post the viewer may see.
    const [posted] = await db.execute<{ id: string }>(sql`select p.id from post_media pm
      join posts p on p.id = pm.post_id
      where pm.media_id = ${row.id}::uuid and ${seesPost(viewer, await seesStrangers(db, viewer))} limit 1`);
    if (posted) return true;
    if (row.galleryPosition === null) return false;
    const [profile] = await db
      .select({ privacy: profiles.privacy })
      .from(profiles)
      .where(eq(profiles.accountId, row.accountId));
    return canSee(privacyOf(profile?.privacy).gallery, await relationOf(db, viewer, row.accountId));
  }

  const find = async (q: Querier, id: string) =>
    isUuid(id) ? ((await q.select().from(media).where(eq(media.id, id)))[0] ?? null) : null;

  /** The owner's media for the data export, with links good for a week. */
  async function exportFor(accountId: string) {
    const f = deps.files;
    if (!f) return null;
    const expires = f.now() + 7 * 24 * hourMs;
    const rows = await db.select().from(media).where(eq(media.accountId, accountId)).orderBy(desc(media.id));
    return {
      usage: await f.usage(accountId),
      linksExpireAt: new Date(expires).toISOString(),
      saves: await slotViews(f, db, accountId, { expires }),
      media: rows.map((row) => view(f, row, { owner: true, expires })),
    };
  }

  return { view, attachmentsFor, attachable, remove, releaseFrom, releaseUnused, canView, find, exportFor };
}

export type MediaService = ReturnType<typeof mediaService>;

/** Uploads that stream past the API's usual body limit. */
export const isStreamedUpload = (method: string, path: string) =>
  (method === "POST" && /^\/api\/v1\/me\/media\/?$/.test(path)) ||
  (method === "PUT" && /^\/api\/v1\/me\/media\/[0-9a-f-]{36}\/poster$/i.test(path));

/** GET /storage for anyone; uploads, lists, deletes and the gallery for the signed-in; the signed
 *  links themselves for whoever holds one. */
export function mediaRoutes(deps: Deps, service: MediaService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);
  const signedIn = requireUser(deps);
  for (const path of ["/me/media", "/me/media/*", "/me/storage", "/me/gallery", "/users/:handle/gallery"])
    app.use(path, signedIn);
  const files = () => needFiles(deps.files);
  const ownerWindow = (f: FileService) => f.windowEnd(hourMs);

  app.get("/storage", (c) => {
    c.header("cache-control", "public, max-age=60");
    return c.json(deps.files ? deps.files.info() : { enabled: false });
  });

  /** Keeps a finished upload as media: the files it needs, checked against the quota. */
  async function keep(
    f: FileService,
    me: string,
    staged: StagedFile[],
    values: Omit<typeof media.$inferInsert, "accountId" | "size">,
  ) {
    await f.prepare(me, staged);
    return f.within(me, async (tx, used) => {
      const incoming = (await f.missing(tx, me, staged)).bytes;
      if (used + incoming > f.quota) throw quotaError(used, f.quota, incoming);
      await f.claim(tx, me, staged, "media");
      const [row] = await tx
        .insert(media)
        .values({ ...values, accountId: me, size: staged.reduce((sum, s) => sum + s.size, 0) })
        .returning();
      return row as Media;
    });
  }

  /** A photo, clip or voice note as the body itself: POST /me/media?kind=image|clip|voice. */
  app.post("/me/media", async (c) => {
    const f = files();
    const me = c.get("userId");
    // Muted: nothing new for others to see (messages and the gallery).
    await assertNotMuted(deps.db, me);
    const kind = c.req.query("kind") as MediaKind;
    if (!mediaKinds.includes(kind))
      throw new HttpError(400, ErrorCode.badRequest, "kind: image, clip or voice");
    await limit("mediaUpload", me);
    const max = mediaLimits[kind];
    const declared = Number(c.req.header("content-length") ?? 0);
    const tooBig = `${kind === "image" ? "A picture" : kind === "clip" ? "A clip" : "A voice note"} is at most ${Math.round(max / 1048576)} MB`;
    if (declared > max) throw new HttpError(413, ErrorCode.payloadTooLarge, tooBig, { max });
    const id = uuidv7();
    const upload = await f.stagingFile(`${id}.media`);
    const made: string[] = [upload];
    try {
      const got = await receive(c.req.raw.body, upload, max, { tooBig });
      if (!got.size) throw new HttpError(400, ErrorCode.badRequest, "The upload is empty");
      const head = Buffer.alloc(16);
      const file = await open(upload, "r");
      await file.read(head, 0, 16, 0);
      await file.close();
      const found = sniff(head);
      let row: Media;
      if (kind === "image") {
        if (found !== "png" && found !== "jpeg" && found !== "webp")
          throw new HttpError(415, ErrorCode.unsupportedMedia, "A picture is PNG, JPEG or WebP");
        const picture = await makeImage(upload);
        const stage = async (name: string, bytes: Buffer): Promise<StagedFile> => {
          const path = await f.stagingFile(`${id}.${name}`);
          made.push(path);
          await writeFile(path, bytes);
          const { createHash } = await import("node:crypto");
          return {
            path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
            contentType: "image/webp",
          };
        };
        const main = await stage("webp", picture.file);
        const thumb = await stage("thumb", picture.thumb);
        row = await keep(f, me, [main, thumb], {
          id,
          kind,
          sha256: main.sha256,
          thumbSha256: thumb.sha256,
          contentType: "image/webp",
          width: picture.width,
          height: picture.height,
        });
      } else if (kind === "clip") {
        if (found !== "mp4") throw new HttpError(415, ErrorCode.unsupportedMedia, "A clip is an MP4");
        const clip = await readClip(upload).catch((error) => {
          throw error instanceof BadMedia ? badMedia(`That clip cannot be used: ${error.message}`) : error;
        });
        row = await keep(
          f,
          me,
          [{ path: upload, sha256: got.sha256, size: got.size, contentType: "video/mp4" }],
          {
            id,
            kind,
            sha256: got.sha256,
            contentType: "video/mp4",
            width: clip.width,
            height: clip.height,
            durationMs: clip.durationMs || null,
          },
        );
      } else {
        const voice = await readVoice(upload, await readFile(upload)).catch((error) => {
          throw error instanceof BadMedia
            ? badMedia(`That voice note cannot be used: ${error.message}`)
            : error;
        });
        if (voice.durationMs > mediaLimits.voiceMs + 500)
          throw badMedia(`A voice note is at most ${mediaLimits.voiceMs / 1000} seconds`);
        row = await keep(
          f,
          me,
          [{ path: upload, sha256: got.sha256, size: got.size, contentType: voice.contentType }],
          {
            id,
            kind,
            sha256: got.sha256,
            contentType: voice.contentType,
            durationMs: voice.durationMs,
          },
        );
      }
      return c.json(
        { media: service.view(f, row, { owner: true, expires: ownerWindow(f) }), usage: await f.usage(me) },
        201,
      );
    } finally {
      for (const path of made) await rm(path, { force: true });
    }
  });

  /** The still shown before a clip plays: a picture from the client, replacing any before it. */
  app.put("/me/media/:id/poster", async (c) => {
    const f = files();
    const me = c.get("userId");
    await limit("mediaUpload", me);
    const row = await service.find(db, c.req.param("id"));
    if (!row || row.accountId !== me) throw new HttpError(404, ErrorCode.notFound, "No such media");
    if (row.kind !== "clip") throw new HttpError(400, ErrorCode.badRequest, "Only a clip has a poster");
    const tooBig = "A poster is at most 2 MB";
    if (Number(c.req.header("content-length") ?? 0) > mediaLimits.poster)
      throw new HttpError(413, ErrorCode.payloadTooLarge, tooBig, { max: mediaLimits.poster });
    const upload = await f.stagingFile(`${uuidv7()}.poster`);
    const made = [upload];
    try {
      await receive(c.req.raw.body, upload, mediaLimits.poster, { tooBig });
      const head = Buffer.alloc(16);
      const file = await open(upload, "r");
      await file.read(head, 0, 16, 0);
      await file.close();
      if (!["png", "jpeg", "webp"].includes(sniff(head) ?? ""))
        throw new HttpError(415, ErrorCode.unsupportedMedia, "A poster is PNG, JPEG or WebP");
      const picture = await makeImage(upload, 1280);
      const path = `${upload}.webp`;
      made.push(path);
      await writeFile(path, picture.file);
      const { createHash } = await import("node:crypto");
      const staged: StagedFile = {
        path,
        sha256: createHash("sha256").update(picture.file).digest("hex"),
        size: picture.file.length,
        contentType: "image/webp",
      };
      await f.prepare(me, [staged]);
      const updated = await f.within(me, async (tx, used) => {
        const [current] = await tx.select().from(media).where(eq(media.id, row.id)).for("update");
        if (!current) throw new HttpError(404, ErrorCode.notFound, "No such media");
        const incoming = (await f.missing(tx, me, [staged])).bytes;
        if (used + incoming > f.quota) throw quotaError(used, f.quota, incoming);
        await f.claim(tx, me, [staged], "media");
        const old = current.posterSha256;
        const [was] = old
          ? await tx
              .select({ size: storedFiles.size })
              .from(storedFiles)
              .where(and(eq(storedFiles.accountId, me), eq(storedFiles.sha256, old)))
          : [];
        const [next] = await tx
          .update(media)
          .set({ posterSha256: staged.sha256, size: current.size - (was?.size ?? 0) + staged.size })
          .where(eq(media.id, row.id))
          .returning();
        if (old && old !== staged.sha256) await f.release(tx, me, [old]);
        return next as Media;
      });
      return c.json({
        media: service.view(f, updated, { owner: true, expires: ownerWindow(f) }),
        usage: await f.usage(me),
      });
    } finally {
      for (const path of made) await rm(path, { force: true });
    }
  });

  /** The account's own media, newest first, 60 a page (before = the last ID). */
  const ownMedia = async (f: FileService, me: string, before?: string, size = 60) => {
    const rows = await db
      .select()
      .from(media)
      .where(and(eq(media.accountId, me), before && isUuid(before) ? lt(media.id, before) : undefined))
      .orderBy(desc(media.id))
      .limit(size + 1);
    return {
      media: rows.slice(0, size).map((row) => service.view(f, row, { owner: true, expires: ownerWindow(f) })),
      next: rows.length > size ? (rows[size - 1]?.id ?? null) : null,
    };
  };

  app.get("/me/media", async (c) => {
    const f = files();
    const me = c.get("userId");
    const size = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 60));
    return c.json(await ownMedia(f, me, c.req.query("before"), size));
  });

  app.delete("/me/media/:id", async (c) => {
    const f = files();
    const me = c.get("userId");
    const row = await service.find(db, c.req.param("id"));
    if (!row || row.accountId !== me) throw new HttpError(404, ErrorCode.notFound, "No such media");
    await service.remove(f, row);
    return c.json({ usage: await f.usage(me) });
  });

  /** Settings → Storage: the usage, the limits, every save and the newest media. */
  app.get("/me/storage", async (c) => {
    const f = deps.files;
    if (!f) return c.json({ enabled: false });
    const me = c.get("userId");
    return c.json({
      enabled: true,
      limits: f.info(),
      usage: await f.usage(me),
      saves: await slotViews(f, db, me),
      ...(await ownMedia(f, me)),
    });
  });

  const galleryOf = async (f: FileService, accountId: string, owner: boolean) => {
    const rows = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.accountId, accountId),
          isNotNull(media.galleryPosition),
          owner ? undefined : eq(media.status, "active"),
        ),
      )
      .orderBy(media.galleryPosition);
    return rows.map((row) => service.view(f, row, { owner }));
  };

  app.get("/me/gallery", async (c) => {
    const f = files();
    return c.json({ items: await galleryOf(f, c.get("userId"), true) });
  });

  app.put("/me/gallery", async (c) => {
    const f = files();
    const me = c.get("userId");
    // Muted: nothing new for others to see (messages and the gallery).
    await assertNotMuted(deps.db, me);
    const { items } = await body(c, GalleryUpdate);
    await f.within(me, async (tx) => {
      const rows = items.length
        ? await tx
            .select({ id: media.id, kind: media.kind, status: media.status })
            .from(media)
            .where(and(eq(media.accountId, me), inArray(media.id, items)))
        : [];
      if (rows.length !== items.length || rows.some((r) => r.status !== "active" || r.kind === "voice"))
        throw new HttpError(400, ErrorCode.badRequest, "items: your own photos and clips");
      await tx
        .update(media)
        .set({ galleryPosition: null })
        .where(and(eq(media.accountId, me), isNotNull(media.galleryPosition)));
      for (const [position, id] of items.entries())
        await tx
          .update(media)
          .set({ galleryPosition: position, usedAt: sql`coalesce(${media.usedAt}, now())` })
          .where(eq(media.id, id));
    });
    return c.json({ items: await galleryOf(f, me, true) });
  });

  /** Someone's pinned photos and clips, as their gallery setting allows; 403 when it is not open
   *  to the asker. */
  app.get("/users/:handle/gallery", async (c) => {
    const me = c.get("userId");
    const profile = await findProfile(db, c.req.param("handle"));
    if (!profile || (profile.accountId !== me && (await people(db).blocked(me, profile.accountId))))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    const f = deps.files;
    if (!f) return c.json({ enabled: false, items: [] });
    const relation = await relationOf(db, me, profile.accountId);
    if (!canSee(privacyOf(profile.privacy).gallery, relation))
      throw new HttpError(403, ErrorCode.forbidden, "This gallery is private");
    return c.json({ items: await galleryOf(f, profile.accountId, relation === "me") });
  });

  /** A signed link to a photo, clip, voice note, thumbnail or poster. Hidden media only opens with
   *  a link made for its owner or a moderator. */
  app.get("/files/media/:id/:variant", async (c) => {
    const f = files();
    const id = c.req.param("id");
    const variant = c.req.param("variant") as Variant;
    if (!variants.includes(variant)) throw new HttpError(404, ErrorCode.notFound, "Not found");
    const { owner, expires } = f.verify(`media/${id}/${variant}`, c.req.query());
    const row = await service.find(db, id);
    const sha = row ? shaOf(row, variant) : null;
    if (!row || !sha || (row.status !== "active" && !owner))
      throw new HttpError(404, ErrorCode.notFound, "No such media");
    const [stored] = await db.execute<{ size: string }>(
      sql`select size from stored_files where account_id = ${row.accountId}::uuid and sha256 = ${sha}`,
    );
    if (!stored) throw new HttpError(404, ErrorCode.notFound, "The file is missing");
    const left = Math.max(0, Math.floor((expires * 1000 - f.now()) / 1000));
    // Pinned in a gallery open to everyone: anyone's cache may keep it until the link expires.
    let open_ = false;
    if (!owner && row.galleryPosition !== null && row.status === "active") {
      const [profile] = await db
        .select({ privacy: profiles.privacy })
        .from(profiles)
        .where(eq(profiles.accountId, row.accountId));
      open_ = privacyOf(profile?.privacy).gallery === "everyone";
    }
    return f.serve(c, row.accountId, sha, {
      size: Number(stored.size),
      contentType: contentTypeOf(row, variant),
      cache: `${open_ ? "public" : "private"}, max-age=${left}, immutable`,
    });
  });

  return app;
}
