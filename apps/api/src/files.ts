import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type Database,
  accounts,
  media,
  saveVersions,
  storageAccounts,
  storedFiles,
  uploads,
} from "@anytogether/db";
import {
  ErrorCode,
  type StorageInfo,
  type StorageUsage,
  defaultSaveMaxBytes,
  defaultStorageQuotaBytes,
  maxGalleryItems,
  mediaLimits,
  savePartBytes,
  saveVersionsKept,
} from "@anytogether/shared";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HttpError } from "./errors.js";
import type { FileStore } from "./fileStore.js";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FileKind = "save" | "media";

/** A finished file in the staging folder, ready to be kept. */
export interface StagedFile {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
}

export interface FileServiceOptions {
  db: Database;
  store: FileStore;
  publicUrl: string;
  /** Bytes per account, saves and media together. */
  quotaBytes?: number;
  /** The biggest save archive. */
  saveMaxBytes?: number;
  /** Signs file links; a random one (links end with a restart) when left out. */
  urlSecret?: string | Buffer;
  /** The clock, for the tests. */
  now?: () => number;
}

const hourMs = 3600_000;
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Streams a request body into a file, hashing and counting it; more than `max` bytes is a 413
 *  and the file is left as far as it got (the caller removes it). */
export async function receive(
  body: ReadableStream<Uint8Array> | null,
  path: string,
  max: number,
  options: { start?: number; flags?: "w" | "r+"; tooBig?: string } = {},
) {
  const hash = createHash("sha256");
  let size = 0;
  const tooBig = () =>
    new HttpError(413, ErrorCode.payloadTooLarge, options.tooBig ?? "That file is too big", { max });
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > max) return done(tooBig());
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const out = createWriteStream(path, { flags: options.flags ?? "w", start: options.start ?? 0 });
  const source = body ? Readable.fromWeb(body as never) : Readable.from([]);
  try {
    await pipeline(source, count, out);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, ErrorCode.badRequest, "The upload broke off");
  }
  return { size, sha256: hash.digest("hex") };
}

/** Hashes a file in the staging folder. */
export async function hashFile(path: string) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size };
}

export const quotaError = (
  used: number,
  limit: number,
  needed: number,
  extra: Record<string, unknown> = {},
) =>
  new HttpError(
    413,
    ErrorCode.quotaExceeded,
    "Your cloud storage is full: delete saves or media to make room",
    { used, limit, needed, ...extra },
  );

/** Cloud storage: who keeps which bytes, the quota, signed links to files, the staging folder for
 *  uploads, and the cleanup of what nothing uses. Every change to an account's files happens inside
 *  `within`, which locks the account's usage row. */
export function fileService(options: FileServiceOptions) {
  const { db, store } = options;
  const quota = options.quotaBytes ?? defaultStorageQuotaBytes;
  const saveMax = options.saveMaxBytes ?? defaultSaveMaxBytes;
  const secret = options.urlSecret ?? randomBytes(32);
  const now = options.now ?? Date.now;
  const keyOf = (accountId: string, sha256: string) => `${accountId}/${sha256.slice(0, 2)}/${sha256}`;
  const stagingPath = (name: string) => join(store.staging, name);

  const info = (): StorageInfo => ({
    enabled: true,
    quota,
    saveMax,
    saveVersions: saveVersionsKept,
    partSize: savePartBytes,
    media: mediaLimits,
    galleryMax: maxGalleryItems,
  });

  /** Runs `work` in a transaction holding the account's usage row; `used` is its bytes now. */
  async function within<T>(accountId: string, work: (tx: Tx, used: number) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx.insert(storageAccounts).values({ accountId }).onConflictDoNothing();
      const [row] = await tx
        .select({ used: storageAccounts.usedBytes })
        .from(storageAccounts)
        .where(eq(storageAccounts.accountId, accountId))
        .for("update");
      return work(tx, row?.used ?? 0);
    });
  }

  const bump = (tx: Tx, accountId: string, delta: number) =>
    delta === 0
      ? Promise.resolve()
      : tx
          .update(storageAccounts)
          .set({ usedBytes: sql`${storageAccounts.usedBytes} + ${delta}`, updatedAt: new Date() })
          .where(eq(storageAccounts.accountId, accountId));

  /** Which of these files the account does not keep yet, and their bytes (counted once each). */
  async function missing(q: Pick<Database, "select">, accountId: string, files: StagedFile[]) {
    const unique = [...new Map(files.map((f) => [f.sha256, f])).values()];
    if (!unique.length) return { files: [] as StagedFile[], bytes: 0 };
    const have = new Set(
      (
        await q
          .select({ sha256: storedFiles.sha256 })
          .from(storedFiles)
          .where(
            and(
              eq(storedFiles.accountId, accountId),
              inArray(
                storedFiles.sha256,
                unique.map((f) => f.sha256),
              ),
            ),
          )
      ).map((r) => r.sha256),
    );
    const absent = unique.filter((f) => !have.has(f.sha256));
    return { files: absent, bytes: absent.reduce((sum, f) => sum + f.size, 0) };
  }

  /** Puts the files the account does not keep yet into the store, before the transaction that
   *  claims them (so a slow upload to a bucket does not hold the account's lock). */
  async function prepare(accountId: string, files: StagedFile[]) {
    for (const file of (await missing(db, accountId, files)).files)
      await store.put(keyOf(accountId, file.sha256), file.path, file);
  }

  /** Inside `within`: the account keeps these files (rows made or touched). Returns the bytes added
   *  to its usage. A file whose row was gone meanwhile is put again if the store lost it. */
  async function claim(tx: Tx, accountId: string, files: StagedFile[], kind: FileKind) {
    let added = 0;
    for (const file of new Map(files.map((f) => [f.sha256, f])).values()) {
      const [made] = await tx
        .insert(storedFiles)
        .values({ accountId, sha256: file.sha256, size: file.size, contentType: file.contentType, kind })
        .onConflictDoUpdate({
          target: [storedFiles.accountId, storedFiles.sha256],
          set: { lastUsedAt: new Date() },
        })
        .returning({ created: sql<boolean>`(xmax = 0)` });
      if (made?.created) {
        added += file.size;
        const key = keyOf(accountId, file.sha256);
        if (!(await store.exists(key))) await store.put(key, file.path, file);
      }
    }
    await bump(tx, accountId, added);
    return added;
  }

  /** Inside `within`: of these files, the ones nothing uses any more are deleted (rows and
   *  bytes). Returns the bytes freed. */
  async function release(tx: Tx, accountId: string, shas: (string | null | undefined)[]) {
    const wanted = [...new Set(shas.filter((s): s is string => Boolean(s)))];
    if (!wanted.length) return 0;
    const gone = await tx
      .delete(storedFiles)
      .where(
        and(
          eq(storedFiles.accountId, accountId),
          inArray(storedFiles.sha256, wanted),
          sql`not exists (select 1 from ${saveVersions} v where v.account_id = ${storedFiles.accountId} and v.sha256 = ${storedFiles.sha256})`,
          sql`not exists (select 1 from ${media} m where m.account_id = ${storedFiles.accountId} and ${storedFiles.sha256} in (m.sha256, m.thumb_sha256, m.poster_sha256))`,
        ),
      )
      .returning({ sha256: storedFiles.sha256, size: storedFiles.size });
    const freed = gone.reduce((sum, f) => sum + f.size, 0);
    await bump(tx, accountId, -freed);
    // Removed while the lock is held, so no upload of the same bytes can claim them in between.
    for (const file of gone) await store.delete(keyOf(accountId, file.sha256));
    return freed;
  }

  /** The account's usage, in all and by saves and media. */
  async function usage(accountId: string, q: Pick<Database, "select"> = db): Promise<StorageUsage> {
    const rows = await q
      .select({ kind: storedFiles.kind, bytes: sql<number>`coalesce(sum(${storedFiles.size}), 0)::bigint` })
      .from(storedFiles)
      .where(eq(storedFiles.accountId, accountId))
      .groupBy(storedFiles.kind);
    const of = (kind: string) => Number(rows.find((r) => r.kind === kind)?.bytes ?? 0);
    return { used: of("save") + of("media"), limit: quota, saves: of("save"), media: of("media") };
  }

  // Signed links: /api/v1/files/<kind>/<id>/<variant>?e=<unix seconds>[&o=1]&s=<signature>. "o"
  // marks a link made for the owner (or a moderator), which still opens hidden media.
  const signature = (path: string, expires: number, owner: boolean) =>
    createHmac("sha256", secret)
      .update(`${path}\n${expires}\n${owner ? "o" : "v"}`)
      .digest("base64url");

  /** A link that works until `expires` (ms); the same link for everyone in the same window, so
   *  browsers and caches can keep it. */
  function link(path: string, expiresMs: number, owner = false) {
    const expires = Math.floor(expiresMs / 1000);
    const query = `e=${expires}${owner ? "&o=1" : ""}&s=${signature(path, expires, owner)}`;
    return new URL(`/api/v1/files/${path}?${query}`, options.publicUrl).toString();
  }

  /** The end of the window a link made now lasts to: at least `minMs`, at most twice that. */
  const windowEnd = (minMs: number) => (Math.floor(now() / minMs) + 2) * minMs;

  /** Checks a link's signature and time; returns whether it was made for the owner. */
  function verify(path: string, query: { e?: string; s?: string; o?: string }) {
    const expires = Number(query.e);
    const given = Buffer.from(query.s ?? "", "utf8");
    const owner = query.o === "1";
    const expected = Buffer.from(signature(path, expires, owner), "utf8");
    if (!Number.isInteger(expires) || given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new HttpError(403, ErrorCode.linkExpired, "This link is not valid");
    if (expires * 1000 < now()) throw new HttpError(410, ErrorCode.linkExpired, "This link has expired");
    return { owner, expires };
  }

  /** Answers with a stored file (or the range asked for), streamed from the store. */
  async function serve(
    c: Context,
    accountId: string,
    sha256: string,
    meta: { size: number; contentType: string; cache: string; filename?: string },
  ) {
    const etag = `"${sha256}"`;
    const headers: Record<string, string> = {
      "content-type": meta.contentType,
      "cache-control": meta.cache,
      etag,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-site",
      "content-disposition": meta.filename ? `attachment; filename="${meta.filename}"` : "inline",
    };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    let range: { start: number; end: number } | undefined;
    const asked = c.req.header("range");
    if (asked && meta.size > 0) {
      const match = asked.match(/^bytes=(\d*)-(\d*)$/);
      if (match && (match[1] || match[2])) {
        let start = match[1] ? Number(match[1]) : Math.max(0, meta.size - Number(match[2]));
        let end = match[1] && match[2] ? Number(match[2]) : meta.size - 1;
        end = Math.min(end, meta.size - 1);
        if (!match[1]) start = Math.max(0, meta.size - Number(match[2]));
        if (start > end || start >= meta.size)
          return c.body(null, 416, { ...headers, "content-range": `bytes */${meta.size}` });
        range = { start, end };
      }
    }
    const stream = await store.get(keyOf(accountId, sha256), range);
    if (!stream) throw new HttpError(404, ErrorCode.notFound, "The file is missing");
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    if (range)
      return new Response(body, {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${range.start}-${range.end}/${meta.size}`,
          "content-length": String(range.end - range.start + 1),
        },
      });
    return new Response(body, { status: 200, headers: { ...headers, "content-length": String(meta.size) } });
  }

  /** A new name in the staging folder. */
  async function stagingFile(name: string) {
    await mkdir(store.staging, { recursive: true });
    return stagingPath(name);
  }

  /** Cleanup, run every hour: unfinished uploads past their day, media never sent or pinned in a
   *  day, file rows nothing uses, files in the store with no row (an upload that failed half way,
   *  or the files of a deleted account), and leftovers in the staging folder. */
  async function sweep() {
    const at = now();
    const counts = { uploads: 0, media: 0, files: 0, objects: 0, accounts: 0, staging: 0 };
    const expired = await db
      .delete(uploads)
      .where(lt(uploads.expiresAt, new Date(at)))
      .returning({ id: uploads.id });
    for (const { id } of expired) await rm(stagingPath(`${id}.upload`), { force: true });
    counts.uploads = expired.length;

    const leftovers = await db
      .select({ id: media.id, accountId: media.accountId })
      .from(media)
      .where(and(isNull(media.usedAt), lt(media.createdAt, new Date(at - 24 * hourMs))));
    for (const item of leftovers) {
      await within(item.accountId, async (tx) => {
        const [gone] = await tx
          .delete(media)
          .where(and(eq(media.id, item.id), isNull(media.usedAt)))
          .returning();
        if (gone) await release(tx, item.accountId, [gone.sha256, gone.thumbSha256, gone.posterSha256]);
      });
      counts.media++;
    }

    const unused = await db
      .select({ accountId: storedFiles.accountId, sha256: storedFiles.sha256 })
      .from(storedFiles)
      .where(
        and(
          lt(storedFiles.lastUsedAt, new Date(at - hourMs)),
          sql`not exists (select 1 from ${saveVersions} v where v.account_id = ${storedFiles.accountId} and v.sha256 = ${storedFiles.sha256})`,
          sql`not exists (select 1 from ${media} m where m.account_id = ${storedFiles.accountId} and ${storedFiles.sha256} in (m.sha256, m.thumb_sha256, m.poster_sha256))`,
        ),
      );
    for (const file of unused)
      counts.files += (await within(file.accountId, (tx) => release(tx, file.accountId, [file.sha256])))
        ? 1
        : 0;

    const folders = (await store.folders()).filter(isUuid);
    const living = new Set(
      folders.length
        ? (await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, folders))).map(
            (a) => a.id,
          )
        : [],
    );
    for (const folder of folders) {
      if (!living.has(folder)) {
        await store.deleteFolder(folder);
        counts.accounts++;
        continue;
      }
      const objects = await store.list(folder);
      const old = objects.filter((o) => o.modified.getTime() < at - hourMs);
      if (!old.length) continue;
      const kept = new Set(
        (
          await db
            .select({ sha256: storedFiles.sha256 })
            .from(storedFiles)
            .where(eq(storedFiles.accountId, folder))
        ).map((f) => f.sha256),
      );
      for (const object of old) {
        const sha = object.key.split("/").pop() ?? "";
        if (kept.has(sha)) continue;
        // Checked again under the lock: an upload may have claimed it since the listing.
        const removed = await within(folder, async (tx) => {
          const [row] = await tx
            .select({ sha256: storedFiles.sha256 })
            .from(storedFiles)
            .where(and(eq(storedFiles.accountId, folder), eq(storedFiles.sha256, sha)));
          if (row) return false;
          await store.delete(object.key);
          return true;
        });
        if (removed) counts.objects++;
      }
    }

    const open = new Set((await db.select({ id: uploads.id }).from(uploads)).map((u) => `${u.id}.upload`));
    const staged = await readdir(store.staging).catch(() => [] as string[]);
    for (const name of staged) {
      if (open.has(name)) continue;
      const path = stagingPath(name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < at - 2 * hourMs) {
        await rm(path, { force: true, recursive: true });
        counts.staging++;
      }
    }
    return counts;
  }

  /** Deletes everything an account keeps in the store (its rows go with the account). */
  async function forgetAccount(accountId: string) {
    await store.deleteFolder(accountId);
  }

  return {
    store,
    quota,
    saveMax,
    info,
    keyOf,
    within,
    prepare,
    missing,
    claim,
    release,
    usage,
    link,
    windowEnd,
    verify,
    serve,
    stagingFile,
    stagingPath,
    sweep,
    forgetAccount,
    now,
  };
}

export type FileService = ReturnType<typeof fileService>;

/** For routes that need storage: the service, or 503 storage_disabled when the server has none. */
export function needFiles(files: FileService | undefined): FileService {
  if (!files)
    throw new HttpError(
      503,
      ErrorCode.storageDisabled,
      "This server keeps no files: cloud saves and media are off",
    );
  return files;
}
