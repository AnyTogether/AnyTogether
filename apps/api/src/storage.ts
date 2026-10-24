import { type Database, blobs } from "@anytogether/db";
import { and, asc, eq, like, sql } from "drizzle-orm";

/** Where uploaded files live. PostgreSQL by default; an S3-style store (R2) can take its place
 *  by implementing these four calls. Keys look like "themes/<id>/v2/theme.anyps5theme". */
export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The file in pieces, or null when there is none. */
  get(key: string): Promise<AsyncIterable<Uint8Array> | null>;
  /** Removes every file whose key starts with `prefix`. */
  deletePrefix(prefix: string): Promise<void>;
  /** Every key that starts with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

const partSize = 1024 * 1024;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Files as rows of at most 1 MiB in the blobs table, read back one piece at a time. */
export function postgresStore(db: Database): BlobStore {
  return {
    async put(key, bytes) {
      await db.transaction(async (tx) => {
        await tx.delete(blobs).where(eq(blobs.key, key));
        for (let part = 0, at = 0; at < bytes.length || part === 0; part++, at += partSize)
          await tx.insert(blobs).values({ key, part, bytes: Buffer.from(bytes.subarray(at, at + partSize)) });
      });
    },
    async get(key) {
      const [found] = await db
        .select({ parts: sql<number>`count(*)::int` })
        .from(blobs)
        .where(eq(blobs.key, key));
      const parts = found?.parts ?? 0;
      if (!parts) return null;
      return (async function* () {
        for (let part = 0; part < parts; part++) {
          const [row] = await db
            .select({ bytes: blobs.bytes })
            .from(blobs)
            .where(and(eq(blobs.key, key), eq(blobs.part, part)));
          if (!row) throw new Error(`blob ${key} lost part ${part}`);
          yield new Uint8Array(row.bytes);
        }
      })();
    },
    async deletePrefix(prefix) {
      await db.delete(blobs).where(like(blobs.key, `${escapeLike(prefix)}%`));
    },
    async list(prefix) {
      const rows = await db
        .selectDistinct({ key: blobs.key })
        .from(blobs)
        .where(like(blobs.key, `${escapeLike(prefix)}%`))
        .orderBy(asc(blobs.key));
      return rows.map((row) => row.key);
    },
  };
}

/** A whole file from the store, for small ones. */
export async function readAll(store: BlobStore, key: string) {
  const pieces = await store.get(key);
  if (!pieces) return null;
  const chunks: Uint8Array[] = [];
  for await (const piece of pieces) chunks.push(piece);
  return Buffer.concat(chunks);
}

/** A response body that streams the file. */
export function streamOf(pieces: AsyncIterable<Uint8Array>) {
  const iterator = pieces[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
