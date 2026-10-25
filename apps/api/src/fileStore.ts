import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { type S3Settings, s3Client } from "./s3.js";

/** Where cloud saves and media are kept: a folder (a Docker volume) or an S3-compatible bucket.
 *  Keys look like "<account id>/<first two hex>/<sha256>"; a file is written once, from a finished
 *  file in the staging folder, and read back as a stream. */
export interface FileStore {
  readonly kind: "filesystem" | "s3";
  /** Where uploads wait while they arrive (on local disk either way). */
  readonly staging: string;
  /** Stores a finished local file under `key`; the local file is moved or copied, not removed. */
  put(
    key: string,
    localPath: string,
    info: { size: number; sha256: string; contentType: string },
  ): Promise<void>;
  /** The file, or `range` of it (both ends included); null when there is none. */
  get(key: string, range?: { start: number; end: number }): Promise<Readable | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** The first part of every key (the account IDs). */
  folders(): Promise<string[]>;
  /** Every key in a folder, with when it was written. */
  list(folder: string): Promise<{ key: string; modified: Date }[]>;
  deleteFolder(folder: string): Promise<void>;
  /** Writes, reads and removes a small file: throws when the store cannot be used. */
  check(): Promise<void>;
}

const safeKey = (key: string) => {
  if (!/^[0-9a-z-]+(\/[0-9a-z-]+)*$/i.test(key) || key.includes(".."))
    throw new Error(`Not a file key: ${key}`);
  return key;
};

/** Files in a folder; uploads wait in its .staging folder, so finishing one is a rename. */
export function filesystemStore(root: string): FileStore {
  const base = resolve(root);
  const staging = join(base, ".staging");
  const pathOf = (key: string) => {
    const path = resolve(base, safeKey(key));
    if (!path.startsWith(base + sep)) throw new Error(`Not a file key: ${key}`);
    return path;
  };
  return {
    kind: "filesystem",
    staging,
    async put(key, localPath) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Copied, not moved: the staging file may still be needed if the transaction fails.
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      await copyFile(localPath, temp);
      await rename(temp, path);
    },
    async get(key, range) {
      const path = pathOf(key);
      try {
        await access(path);
      } catch {
        return null;
      }
      return createReadStream(path, range ? { start: range.start, end: range.end } : {});
    },
    async exists(key) {
      return stat(pathOf(key)).then(
        (s) => s.isFile(),
        () => false,
      );
    },
    async delete(key) {
      await unlink(pathOf(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
    async folders() {
      const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    },
    async list(folder) {
      const found: { key: string; modified: Date }[] = [];
      const walk = async (dir: string, prefix: string) => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const key = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) await walk(join(dir, entry.name), key);
          else if (!entry.name.endsWith(".tmp"))
            found.push({ key, modified: (await stat(join(dir, entry.name))).mtime });
        }
      };
      await walk(pathOf(folder), folder);
      return found;
    },
    async deleteFolder(folder) {
      await rm(pathOf(folder), { recursive: true, force: true });
    },
    async check() {
      await mkdir(staging, { recursive: true });
      const probe = join(staging, `probe-${process.pid}`);
      await writeFile(probe, "ok");
      await unlink(probe);
    },
  };
}

/** Files in an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO…). Uploads wait in a local
 *  staging folder and go to the bucket once complete, with their SHA-256, which S3 checks. */
export function s3Store(settings: S3Settings, stagingDir = join(tmpdir(), "anytogether-staging")): FileStore {
  const s3 = s3Client(settings);
  return {
    kind: "s3",
    staging: stagingDir,
    async put(key, localPath, info) {
      await s3.put(safeKey(key), createReadStream(localPath), info.size, info.sha256, info.contentType);
    },
    get: (key, range) => s3.get(safeKey(key), range),
    async exists(key) {
      return (await s3.head(safeKey(key))) !== null;
    },
    delete: (key) => s3.delete(safeKey(key)),
    async folders() {
      const found: string[] = [];
      let token: string | undefined;
      do {
        const page = await s3.list("", { delimiter: "/", ...(token ? { token } : {}) });
        found.push(...page.folders.map((f) => f.replace(/\/$/, "")));
        token = page.next ?? undefined;
      } while (token);
      return found;
    },
    async list(folder) {
      const found: { key: string; modified: Date }[] = [];
      let token: string | undefined;
      do {
        const page = await s3.list(`${safeKey(folder)}/`, token ? { token } : {});
        found.push(...page.keys);
        token = page.next ?? undefined;
      } while (token);
      return found;
    },
    async deleteFolder(folder) {
      for (const { key } of await this.list(folder)) await s3.delete(key);
    },
    async check() {
      await mkdir(stagingDir, { recursive: true });
      const probe = join(stagingDir, `probe-${process.pid}`);
      await writeFile(probe, "ok");
      await unlink(probe);
      // A listing proves the bucket and the keys without writing to it.
      await s3.list("", { delimiter: "/" });
    },
  };
}

export interface StorageSettings {
  dir: string;
  s3: Partial<S3Settings>;
  stagingDir: string;
}

/** The store the settings name: S3 when its four settings are there, else the folder, else none.
 *  Half an S3 setup is reported and left off rather than stopping the API. */
export function storeFromSettings(settings: StorageSettings, log: (line: string) => void = console.warn) {
  const { endpoint, bucket, accessKey, secretKey } = settings.s3;
  const anyS3 = Boolean(endpoint || bucket || accessKey || secretKey);
  if (endpoint && bucket && accessKey && secretKey)
    return s3Store(
      { endpoint, bucket, accessKey, secretKey, region: settings.s3.region || "auto" },
      settings.stagingDir || undefined,
    );
  if (anyS3)
    log("storage: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are all needed; S3 is off");
  if (settings.dir) return filesystemStore(settings.dir);
  return null;
}
