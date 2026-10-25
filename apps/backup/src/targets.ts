import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./proc.js";
import { timeFromName } from "./retention.js";

/** One backup at a target: a folder named <prefix>-<UTC time> with its parts and manifest.json,
 *  which is written last, so a folder without one is unfinished. */
export interface Stored {
  name: string;
  at: Date;
  complete: boolean;
  bytes: number;
}

export interface Target {
  /** How the logs and the status file name it (never credentials). */
  label: string;
  list(): Promise<Stored[]>;
  /** Copies the finished folder `dir` here as `name`, manifest last. */
  put(dir: string, name: string): Promise<void>;
  /** Copies backup `name` into the folder `dir`; returns the folder that holds it. */
  get(name: string, dir: string): Promise<string>;
  remove(name: string): Promise<void>;
}

const ours = (prefix: string, name: string) => name.startsWith(`${prefix}-`) && timeFromName(name) !== null;

/** A folder on this machine (the `backups` volume). */
export function localTarget(dir: string, prefix: string): Target {
  return {
    label: "local",
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const found: Stored[] = [];
      for (const name of names.filter((n) => ours(prefix, n))) {
        let bytes = 0;
        let complete = false;
        for (const part of await readdir(join(dir, name)).catch(() => [] as string[])) {
          if (part === "manifest.json") complete = true;
          bytes += (await stat(join(dir, name, part))).size;
        }
        found.push({ name, at: timeFromName(name) as Date, complete, bytes });
      }
      return found;
    },
    async put(source, name) {
      // The backup is made in this folder already (see backup.ts); nothing to copy.
      if (source !== join(dir, name)) throw new Error(`local target: expected ${join(dir, name)}`);
    },
    async get(name) {
      return join(dir, name);
    },
    async remove(name) {
      await rm(join(dir, name), { recursive: true, force: true });
    },
  };
}

interface LsEntry {
  Path: string;
  Size: number;
  IsDir: boolean;
}

/** Anything rclone reaches (S3 and the S3-compatibles, Google Drive, Dropbox, OneDrive, SFTP,
 *  WebDAV, another folder), configured by RCLONE_CONFIG_* variables or a mounted rclone.conf. */
export function rcloneTarget(remote: string, prefix: string): Target {
  const at = (name: string) => `${remote}/${name}`;
  const rclone = (...args: string[]) => run({ cmd: "rclone", args: [...args, "--retries", "5"] });
  return {
    label: remote,
    async list() {
      let entries: LsEntry[];
      try {
        entries = JSON.parse(
          await rclone("lsjson", "--recursive", "--max-depth", "2", "--files-only", remote),
        ) as LsEntry[];
      } catch (error) {
        // A fresh bucket or folder: nothing there yet.
        if (/directory not found|not found|doesn't exist|NoSuchBucket/i.test(String(error))) return [];
        throw error;
      }
      const byName = new Map<string, Stored>();
      for (const entry of entries) {
        const [name, part] = entry.Path.split("/");
        if (!name || !part || !ours(prefix, name)) continue;
        const stored = byName.get(name) ?? {
          name,
          at: timeFromName(name) as Date,
          complete: false,
          bytes: 0,
        };
        stored.bytes += entry.Size;
        if (part === "manifest.json") stored.complete = true;
        byName.set(name, stored);
      }
      return [...byName.values()];
    },
    async put(dir, name) {
      await rclone("copy", dir, at(name), "--exclude", "manifest.json");
      await rclone("copyto", join(dir, "manifest.json"), `${at(name)}/manifest.json`);
      // What arrived must be what was sent: same names, same sizes.
      const sent = new Map<string, number>();
      for (const part of await readdir(dir)) sent.set(part, (await stat(join(dir, part))).size);
      const arrived = JSON.parse(await rclone("lsjson", "--files-only", at(name))) as LsEntry[];
      for (const [part, size] of sent) {
        const there = arrived.find((entry) => entry.Path === part);
        if (!there || there.Size !== size)
          throw new Error(
            `upload check: ${part} is ${there ? `${there.Size} bytes` : "missing"} at ${remote}, sent ${size}`,
          );
      }
    },
    async get(name, dir) {
      const into = join(dir, name);
      await mkdir(into, { recursive: true });
      await rclone("copy", at(name), into);
      return into;
    },
    async remove(name) {
      await rclone("purge", at(name));
    },
  };
}

/** The manifest of a backup folder. */
export async function readManifestFile<T>(dir: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as T;
}
