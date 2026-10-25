import { open, rm } from "node:fs/promises";
import { games, saveSlots, saveVersions, storedFiles, uploads } from "@anytogether/db";
import {
  type DroppedVersion,
  ErrorCode,
  type SaveSlotView,
  SaveUploadComplete,
  SaveUploadInit,
  type SaveVersionView,
  maxOpenUploads,
  savePartBytes,
  saveVersionsKept,
  uploadLifetimeMs,
} from "@anytogether/shared";
import { TitleId } from "@anytogether/shared";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import {
  type FileService,
  type StagedFile,
  type Tx,
  hashFile,
  needFiles,
  quotaError,
  receive,
} from "./files.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";

type Slot = typeof saveSlots.$inferSelect;
type Version = typeof saveVersions.$inferSelect;
type Upload = typeof uploads.$inferSelect;
type Querier = Pick<Tx, "select">;

const hourMs = 3600_000;
const isUuid = (value: string) => z.string().uuid().safeParse(value).success;
const iso = (date: Date) => date.toISOString();
/** "cusa12345-savedata00-v3.zip" */
const archiveName = (slot: Slot, version: number) =>
  `${slot.titleId}-${slot.slot}`
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .toLowerCase()
    .slice(0, 80)
    .concat(`-v${version}.zip`);

const conflictError = (latest: SaveVersionView | null, slot: Slot | null) =>
  new HttpError(409, ErrorCode.saveConflict, "The cloud has a newer save than the one this was based on", {
    slotId: slot?.id ?? null,
    latest,
  });

export const versionView = (
  f: FileService,
  slot: Slot,
  v: Version,
  expires = f.windowEnd(hourMs),
): SaveVersionView => ({
  id: v.id,
  version: v.version,
  size: v.size,
  sha256: v.sha256,
  device: v.device,
  launcherVersion: v.launcherVersion,
  createdAt: iso(v.createdAt),
  download: f.link(`save/${v.id}/${archiveName(slot, v.version)}`, expires, true),
});

/** The account's slots (of one game, or one slot) with their versions, newest first. */
export async function slotViews(
  f: FileService,
  q: Querier,
  me: string,
  where: { titleId?: string; slotId?: string; expires?: number } = {},
) {
  const slots = await q
    .select()
    .from(saveSlots)
    .where(
      and(
        eq(saveSlots.accountId, me),
        where.titleId ? eq(saveSlots.titleId, where.titleId) : undefined,
        where.slotId ? eq(saveSlots.id, where.slotId) : undefined,
      ),
    )
    .orderBy(desc(saveSlots.updatedAt));
  if (!slots.length) return [];
  const versions = await q
    .select()
    .from(saveVersions)
    .where(
      inArray(
        saveVersions.slotId,
        slots.map((s) => s.id),
      ),
    )
    .orderBy(desc(saveVersions.version));
  const titles = [...new Set(slots.map((s) => s.titleId))];
  const names = new Map(
    (
      await q
        .select({ titleId: games.titleId, names: games.names })
        .from(games)
        .where(inArray(games.titleId, titles))
    ).map((g) => [g.titleId, g.names.en ?? Object.values(g.names)[0] ?? null]),
  );
  return slots.map(
    (slot): SaveSlotView => ({
      id: slot.id,
      titleId: slot.titleId,
      game: names.get(slot.titleId) ?? null,
      slot: slot.slot,
      updatedAt: iso(slot.updatedAt),
      versions: versions
        .filter((v) => v.slotId === slot.id)
        .map((v) => versionView(f, slot, v, where.expires)),
    }),
  );
}

/** Cloud saves: a game's slots, each keeping its newest three archives within the account's
 *  quota. Uploads come in parts (begin, send parts in any order, complete with the SHA-256 checked),
 *  so a big save survives a dropped connection. Only their owner ever sees them. */
export function saveRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);
  app.use("/me/saves/*", requireUser(deps));
  app.use("/me/saves", requireUser(deps));
  const files = () => needFiles(deps.files);

  /** The bytes dropping these versions frees: their files that nothing else uses (and that are not
   *  the bytes about to be kept). */
  async function freeable(q: Querier, me: string, drop: Version[], keepSha: string | null) {
    if (!drop.length) return 0;
    const ids = drop.map((v) => v.id);
    const shas = [...new Set(drop.map((v) => v.sha256))].filter((s) => s !== keepSha);
    if (!shas.length) return 0;
    const [row] = await q
      .select({ bytes: sql<number>`coalesce(sum(${storedFiles.size}), 0)::bigint` })
      .from(storedFiles)
      .where(
        and(
          eq(storedFiles.accountId, me),
          inArray(storedFiles.sha256, shas),
          sql`not exists (select 1 from save_versions v where v.account_id = ${storedFiles.accountId} and v.sha256 = ${storedFiles.sha256} and v.id not in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))`,
          sql`not exists (select 1 from media m where m.account_id = ${storedFiles.accountId} and ${storedFiles.sha256} in (m.sha256, m.thumb_sha256, m.poster_sha256))`,
        ),
      );
    return Number(row?.bytes ?? 0);
  }

  /** Which versions go to keep three per slot and to make room for `incoming` new bytes: older
   *  ones first; the slot's newest only when `replaceLatest` allows it. Throws quota_exceeded when
   *  that is not enough, saying whether replacing the newest would be. */
  async function plan(
    f: FileService,
    q: Querier,
    me: string,
    used: number,
    versions: Version[],
    incoming: { sha256: string; bytes: number },
    replaceLatest: boolean,
    slot: Slot | null,
  ) {
    const dropped: (Version & { reason: DroppedVersion["reason"] })[] = [];
    // Newest first: everything past the newest two makes way for the new one.
    for (const v of versions.slice(saveVersionsKept - 1)) dropped.push({ ...v, reason: "kept" });
    const fits = async () =>
      used - (await freeable(q, me, dropped, incoming.sha256)) + incoming.bytes <= f.quota;
    if (await fits()) return dropped;
    for (const v of [...versions.slice(1, saveVersionsKept - 1)].reverse()) {
      dropped.push({ ...v, reason: "quota" });
      if (await fits()) return dropped;
    }
    const latest = versions[0];
    if (latest) {
      const withLatest = [...dropped, { ...latest, reason: "replaced" as const }];
      const room = used - (await freeable(q, me, withLatest, incoming.sha256)) + incoming.bytes <= f.quota;
      if (room && replaceLatest) return withLatest;
      if (room)
        throw quotaError(used, f.quota, incoming.bytes, {
          canReplace: true,
          latest: slot ? versionView(f, slot, latest) : null,
        });
    }
    throw quotaError(used, f.quota, incoming.bytes, { canReplace: false });
  }

  const findSlot = async (q: Querier, me: string, titleId: string, slot: string) =>
    (
      await q
        .select()
        .from(saveSlots)
        .where(and(eq(saveSlots.accountId, me), eq(saveSlots.titleId, titleId), eq(saveSlots.slot, slot)))
    )[0] ?? null;
  const versionsOf = (q: Querier, slotId: string) =>
    q.select().from(saveVersions).where(eq(saveVersions.slotId, slotId)).orderBy(desc(saveVersions.version));

  const loadUpload = async (me: string, id: string) => {
    const [row] = isUuid(id)
      ? await db
          .select()
          .from(uploads)
          .where(and(eq(uploads.id, id), eq(uploads.accountId, me), gt(uploads.expiresAt, new Date())))
      : [];
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such upload");
    return row;
  };
  const uploadView = (u: Upload) => ({
    uploadId: u.id,
    size: u.size,
    sha256: u.sha256,
    partSize: u.partSize,
    parts: u.parts,
    received: [...u.received].sort((a, b) => a - b),
    expiresAt: iso(u.expiresAt),
  });
  const dropUpload = async (f: FileService, id: string) => {
    await db.delete(uploads).where(eq(uploads.id, id));
    await rm(f.stagingPath(`${id}.upload`), { force: true });
  };

  app.get("/me/saves", async (c) => {
    const f = files();
    const me = c.get("userId");
    const titleId = c.req.query("titleId");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like CUSA12345");
    return c.json({
      usage: await f.usage(me),
      slots: await slotViews(f, db, me, titleId ? { titleId } : {}),
    });
  });

  /** Begins an upload: checked against the conflict hint and the quota before any byte is sent. */
  app.post("/me/saves/uploads", async (c) => {
    const f = files();
    const me = c.get("userId");
    const input = await body(c, SaveUploadInit);
    await limit("saveUpload", me);
    if (input.size > f.saveMax)
      throw new HttpError(
        413,
        ErrorCode.payloadTooLarge,
        `A save is at most ${Math.round(f.saveMax / 1048576)} MB`,
        {
          max: f.saveMax,
        },
      );
    const slot = await findSlot(db, me, input.titleId, input.slot);
    const versions = slot ? await versionsOf(db, slot.id) : [];
    const latest = versions[0];
    if (input.baseVersion !== undefined && (latest?.version ?? 0) !== input.baseVersion)
      throw conflictError(slot && latest ? versionView(f, slot, latest) : null, slot);
    const usage = await f.usage(me);
    const already = await f.missing(db, me, [
      { path: "", sha256: input.sha256, size: input.size, contentType: "" },
    ]);
    await plan(
      f,
      db,
      me,
      usage.used,
      versions,
      { sha256: input.sha256, bytes: already.bytes },
      Boolean(input.replaceLatest),
      slot,
    );
    const open_ = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.accountId, me), gt(uploads.expiresAt, new Date())));
    if (open_.length >= maxOpenUploads)
      throw new HttpError(
        409,
        ErrorCode.conflict,
        `At most ${maxOpenUploads} uploads at once: finish or cancel one`,
      );
    const id = uuidv7();
    const parts = Math.ceil(input.size / savePartBytes);
    const path = await f.stagingFile(`${id}.upload`);
    const file = await open(path, "w");
    await file.truncate(input.size);
    await file.close();
    const [made] = await db
      .insert(uploads)
      .values({
        id,
        accountId: me,
        size: input.size,
        sha256: input.sha256,
        partSize: savePartBytes,
        parts,
        meta: {
          titleId: input.titleId,
          slot: input.slot,
          device: input.device ?? null,
          launcherVersion: input.launcherVersion ?? null,
          ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
          replaceLatest: Boolean(input.replaceLatest),
        },
        expiresAt: new Date(Date.now() + uploadLifetimeMs),
      })
      .returning();
    return c.json(uploadView(made as Upload), 201);
  });

  app.get("/me/saves/uploads/:id", async (c) =>
    c.json(uploadView(await loadUpload(c.get("userId"), c.req.param("id")))),
  );

  /** One part, numbered from 1, as the body itself (application/octet-stream). Sending a part
   *  again replaces it. X-Part-SHA256, if sent, is checked. */
  app.put("/me/saves/uploads/:id/parts/:n", async (c) => {
    const f = files();
    const me = c.get("userId");
    const upload = await loadUpload(me, c.req.param("id"));
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 1 || n > upload.parts)
      throw new HttpError(400, ErrorCode.badRequest, `part: 1 to ${upload.parts}`);
    const expected = n < upload.parts ? upload.partSize : upload.size - upload.partSize * (upload.parts - 1);
    const declared = c.req.header("content-length");
    if (declared !== undefined && Number(declared) !== expected)
      throw new HttpError(400, ErrorCode.badRequest, `Part ${n} is ${expected} bytes`, { expected });
    const got = await receive(c.req.raw.body, f.stagingPath(`${upload.id}.upload`), expected, {
      start: (n - 1) * upload.partSize,
      flags: "r+",
      tooBig: `Part ${n} is ${expected} bytes`,
    });
    if (got.size !== expected)
      throw new HttpError(400, ErrorCode.badRequest, `Part ${n} is ${expected} bytes, not ${got.size}`, {
        expected,
      });
    const partSha = c.req.header("x-part-sha256")?.toLowerCase();
    if (partSha && partSha !== got.sha256)
      throw new HttpError(400, ErrorCode.checksumMismatch, `Part ${n} arrived damaged: send it again`, {
        part: n,
        sha256: got.sha256,
      });
    const [row] = await db
      .update(uploads)
      .set({
        received: sql`array(select distinct x from unnest(${uploads.received} || ${n}::integer) x order by x)`,
      })
      .where(eq(uploads.id, upload.id))
      .returning();
    return c.json({ part: n, sha256: got.sha256, received: (row as Upload).received });
  });

  app.delete("/me/saves/uploads/:id", async (c) => {
    const upload = await loadUpload(c.get("userId"), c.req.param("id"));
    await dropUpload(files(), upload.id);
    return c.body(null, 204);
  });

  /** Puts the parts together, checks the SHA-256 and keeps the save as the slot's newest version,
   *  dropping what must go (said in `dropped`). A conflict leaves the upload open: complete again
   *  with the latest version as baseVersion to keep this one anyway. */
  app.post("/me/saves/uploads/:id/complete", async (c) => {
    const f = files();
    const me = c.get("userId");
    const upload = await loadUpload(me, c.req.param("id"));
    const input = await body(
      c,
      SaveUploadComplete.extend({ baseVersion: z.number().int().min(0).optional() }),
    );
    await limit("saveUpload", me);
    const missing = Array.from({ length: upload.parts }, (_, i) => i + 1).filter(
      (n) => !upload.received.includes(n),
    );
    if (missing.length)
      throw new HttpError(409, ErrorCode.conflict, "Some parts have not arrived", { missing });
    const path = f.stagingPath(`${upload.id}.upload`);
    const got = await hashFile(path).catch(() => null);
    if (!got || got.sha256 !== upload.sha256 || got.size !== upload.size) {
      await dropUpload(f, upload.id);
      throw new HttpError(400, ErrorCode.checksumMismatch, "The save arrived damaged: upload it again", {
        expected: upload.sha256,
        received: got?.sha256 ?? null,
      });
    }
    const meta = upload.meta as {
      titleId: string;
      slot: string;
      device: string | null;
      launcherVersion: string | null;
      baseVersion?: number;
      replaceLatest?: boolean;
    };
    const baseVersion = input.baseVersion ?? meta.baseVersion;
    const replaceLatest = input.replaceLatest ?? meta.replaceLatest ?? false;
    const staged: StagedFile = {
      path,
      sha256: upload.sha256,
      size: upload.size,
      contentType: "application/zip",
    };
    await f.prepare(me, [staged]);

    const result = await f.within(me, async (tx, used) => {
      await tx
        .insert(saveSlots)
        .values({ id: uuidv7(), accountId: me, titleId: meta.titleId, slot: meta.slot })
        .onConflictDoNothing();
      const [slot] = await tx
        .select()
        .from(saveSlots)
        .where(
          and(
            eq(saveSlots.accountId, me),
            eq(saveSlots.titleId, meta.titleId),
            eq(saveSlots.slot, meta.slot),
          ),
        )
        .for("update");
      if (!slot) throw new HttpError(409, ErrorCode.conflict, "Try again");
      const versions = await versionsOf(tx, slot.id);
      const latest = versions[0];
      if (baseVersion !== undefined && (latest?.version ?? 0) !== baseVersion)
        throw conflictError(latest ? versionView(f, slot, latest) : null, slot);
      if (latest && latest.sha256 === staged.sha256)
        return { slot, version: latest, dropped: [], unchanged: true };
      const incoming = (await f.missing(tx, me, [staged])).bytes;
      const dropped = await plan(
        f,
        tx,
        me,
        used,
        versions,
        { sha256: staged.sha256, bytes: incoming },
        replaceLatest,
        slot,
      );
      if (dropped.length)
        await tx.delete(saveVersions).where(
          inArray(
            saveVersions.id,
            dropped.map((v) => v.id),
          ),
        );
      await f.claim(tx, me, [staged], "save");
      const number = slot.lastVersion + 1;
      const [version] = await tx
        .insert(saveVersions)
        .values({
          id: uuidv7(),
          slotId: slot.id,
          accountId: me,
          version: number,
          sha256: staged.sha256,
          size: staged.size,
          device: meta.device,
          launcherVersion: meta.launcherVersion,
        })
        .returning();
      await tx
        .update(saveSlots)
        .set({ lastVersion: number, updatedAt: new Date() })
        .where(eq(saveSlots.id, slot.id));
      // Last: the dropped versions' files leave the store.
      await f.release(
        tx,
        me,
        dropped.map((v) => v.sha256),
      );
      return { slot, version: version as Version, dropped, unchanged: false };
    });
    await dropUpload(f, upload.id);
    const [view] = await slotViews(f, db, me, { slotId: result.slot.id });
    return c.json(
      {
        save: view,
        version: versionView(f, result.slot, result.version),
        unchanged: result.unchanged,
        dropped: result.dropped.map(
          (v): DroppedVersion => ({ id: v.id, version: v.version, size: v.size, reason: v.reason }),
        ),
        usage: await f.usage(me),
      },
      result.unchanged ? 200 : 201,
    );
  });

  /** A version, the account's own. */
  const ownVersion = async (q: Querier, me: string, id: string) => {
    const [row] = isUuid(id)
      ? await q
          .select({ version: saveVersions, slot: saveSlots })
          .from(saveVersions)
          .innerJoin(saveSlots, eq(saveSlots.id, saveVersions.slotId))
          .where(and(eq(saveVersions.id, id), eq(saveVersions.accountId, me)))
      : [];
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such save");
    return row;
  };

  const download = async (c: Context, me: string, id: string) => {
    const f = files();
    const { version, slot } = await ownVersion(db, me, id);
    return f.serve(c, me, version.sha256, {
      size: version.size,
      contentType: "application/zip",
      cache: "private, no-store",
      filename: archiveName(slot, version.version),
    });
  };

  app.get("/me/saves/versions/:id/download", (c) => download(c, c.get("userId"), c.req.param("id")));

  /** The signed link from a listing (or the data export): for the owner only, as they asked. */
  app.get("/files/save/:id/:name", async (c) => {
    const f = files();
    const id = c.req.param("id");
    const { owner } = f.verify(`save/${id}/${c.req.param("name")}`, c.req.query());
    if (!owner || !isUuid(id)) throw new HttpError(403, ErrorCode.linkExpired, "This link is not valid");
    const [row] = await db
      .select({ accountId: saveVersions.accountId })
      .from(saveVersions)
      .where(eq(saveVersions.id, id));
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such save");
    return download(c, row.accountId, id);
  });

  /** An older version becomes the newest again (the same bytes: nothing more is counted). */
  app.post("/me/saves/versions/:id/restore", async (c) => {
    const f = files();
    const me = c.get("userId");
    await limit("saveUpload", me);
    const result = await f.within(me, async (tx) => {
      const { version, slot } = await ownVersion(tx, me, c.req.param("id"));
      const versions = await versionsOf(tx, slot.id);
      if (versions[0]?.id === version.id)
        return { slot, version, dropped: [] as (Version & { reason: "kept" })[] };
      const dropped = versions.slice(saveVersionsKept - 1).map((v) => ({ ...v, reason: "kept" as const }));
      if (dropped.length)
        await tx.delete(saveVersions).where(
          inArray(
            saveVersions.id,
            dropped.map((v) => v.id),
          ),
        );
      const [fresh] = await tx.select().from(saveSlots).where(eq(saveSlots.id, slot.id)).for("update");
      const number = (fresh as Slot).lastVersion + 1;
      const [made] = await tx
        .insert(saveVersions)
        .values({
          id: uuidv7(),
          slotId: slot.id,
          accountId: me,
          version: number,
          sha256: version.sha256,
          size: version.size,
          device: version.device,
          launcherVersion: version.launcherVersion,
        })
        .returning();
      await tx
        .update(saveSlots)
        .set({ lastVersion: number, updatedAt: new Date() })
        .where(eq(saveSlots.id, slot.id));
      await f.release(
        tx,
        me,
        dropped.map((v) => v.sha256),
      );
      return { slot, version: made as Version, dropped };
    });
    const [view] = await slotViews(f, db, me, { slotId: result.slot.id });
    return c.json({
      save: view,
      version: versionView(f, result.slot, result.version),
      dropped: result.dropped.map((v) => ({ id: v.id, version: v.version, size: v.size, reason: v.reason })),
      usage: await f.usage(me),
    });
  });

  app.delete("/me/saves/versions/:id", async (c) => {
    const f = files();
    const me = c.get("userId");
    await f.within(me, async (tx) => {
      const { version, slot } = await ownVersion(tx, me, c.req.param("id"));
      await tx.delete(saveVersions).where(eq(saveVersions.id, version.id));
      const left = await tx
        .select({ id: saveVersions.id })
        .from(saveVersions)
        .where(eq(saveVersions.slotId, slot.id));
      if (!left.length) await tx.delete(saveSlots).where(eq(saveSlots.id, slot.id));
      await f.release(tx, me, [version.sha256]);
    });
    return c.json({ usage: await f.usage(me) });
  });

  app.delete("/me/saves/slots/:id", async (c) => {
    const f = files();
    const me = c.get("userId");
    const id = c.req.param("id");
    await f.within(me, async (tx) => {
      const [slot] = isUuid(id)
        ? await tx
            .select()
            .from(saveSlots)
            .where(and(eq(saveSlots.id, id), eq(saveSlots.accountId, me)))
        : [];
      if (!slot) throw new HttpError(404, ErrorCode.notFound, "No such save");
      const versions = await tx.delete(saveVersions).where(eq(saveVersions.slotId, slot.id)).returning();
      await tx.delete(saveSlots).where(eq(saveSlots.id, slot.id));
      await f.release(
        tx,
        me,
        versions.map((v) => v.sha256),
      );
    });
    return c.json({ usage: await f.usage(me) });
  });

  return app;
}
