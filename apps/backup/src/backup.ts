import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { BackupRun } from "@anytogether/shared";
import { encryptStep, gpgHome, suffix } from "./crypt.js";
import { databaseInfo } from "./db.js";
import { log } from "./log.js";
import { type Hashed, flow, run } from "./proc.js";
import { nameFor, toKeep } from "./retention.js";
import { type Settings, targetLabels } from "./settings.js";
import { withLock, writeStatus } from "./state.js";
import { type Target, localTarget, rcloneTarget } from "./targets.js";

export const manifestFormat = "anytogether-backup/1";

export interface Part {
  file: string;
  kind: "database" | "files";
  /** As stored (encrypted, when it is). */
  bytes: number;
  sha256: string;
  /** Before encryption: what a restore must end up with. */
  plain: Hashed;
}

export interface Manifest {
  format: typeof manifestFormat;
  name: string;
  createdAt: string;
  finishedAt: string;
  host: string;
  database: {
    server: string;
    pgDump: string;
    migrations: { count: number; latest: string | null };
    accounts: number | null;
  };
  files: { source: string; count: number; bytes: number } | null;
  encryption: { method: "age" | "gpg" | "none"; recipients?: string[] };
  parts: Part[];
}

/** Every place backups go: the local folder (where they are made) first, then the remote. */
export function targetsOf(s: Settings): Target[] {
  return [
    ...(s.localDir ? [localTarget(s.localDir, s.prefix)] : []),
    ...(s.remote ? [rcloneTarget(s.remote, s.prefix)] : []),
  ];
}

/** Files and bytes under a folder, leaving out what the API is still receiving. */
async function countFiles(dir: string) {
  let count = 0;
  let bytes = 0;
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      if (entry.name === ".staging" || entry.name.endsWith(".tmp")) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        count++;
        bytes += (await stat(path)).size;
      }
    }
  };
  await walk(dir);
  return { count, bytes };
}

const hasFiles = async (dir: string) => {
  if (!dir) return false;
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

/** Makes one backup now: a dump of the database, then the files, each hashed and (optionally)
 *  encrypted, with a manifest; copies it to every target, then deletes what retention no longer
 *  keeps. Records the run in the status file either way. */
export async function backupNow(s: Settings): Promise<Manifest> {
  return withLock(s, "backup", async () => {
    const started = new Date();
    const name = nameFor(s.prefix, started);
    const record = (fields: Omit<BackupRun, "at" | "name">) =>
      writeStatus(s, {
        run: {
          at: started.toISOString(),
          name,
          durationSeconds: Math.round((Date.now() - started.getTime()) / 1000),
          ...fields,
        },
      });
    try {
      const manifest = await make(s, name, started);
      const bytes = manifest.parts.reduce((sum, part) => sum + part.bytes, 0);
      await record({
        ok: true,
        bytes,
        targets: targetLabels(s),
        ...(manifest.database.migrations.latest ? { migration: manifest.database.migrations.latest } : {}),
      });
      log(`backup ${name} done: ${mb(bytes)} to ${targetLabels(s).join(" and ")}`);
      await prune(s).catch((error) => log(`pruning old backups failed: ${message(error)}`, "warn"));
      return manifest;
    } catch (error) {
      await record({ ok: false, error: message(error).split("\n")[0]?.slice(0, 300) ?? "failed" });
      throw error;
    }
  });
}

async function make(s: Settings, name: string, started: Date): Promise<Manifest> {
  const targets = targetsOf(s);
  if (!targets.length) throw new Error("no target: set BACKUP_REMOTE, or keep BACKUP_KEEP_LOCAL on");
  // Made where it will stay when there is a local copy, so it is written once.
  const base = s.localDir || s.workDir;
  await mkdir(base, { recursive: true });
  const partial = join(base, `.partial-${name}`);
  const gpg = await gpgHome();
  await mkdir(partial, { recursive: true });
  try {
    const crypt = encryptStep(s.encryption, gpg.dir);
    const via = crypt ? [crypt] : [];
    const end = suffix[s.encryption.method];
    const parts: Part[] = [];

    const info = await databaseInfo(s.databaseUrl);
    const pgDump = (await run({ cmd: "pg_dump", args: ["--version"] })).trim();
    log(
      `dumping the database (${info.migrations.latest ?? "no migrations"}, ${info.accounts ?? 0} accounts)`,
    );
    const dbFile = `database.pgdump${end}`;
    // Custom format: compressed, and pg_restore can pick from it. One snapshot, so consistent.
    const dumped = await flow({
      from: {
        cmd: "pg_dump",
        args: ["--format=custom", "--no-owner", "--no-privileges", "--dbname", s.databaseUrl],
      },
      via,
      to: { file: join(partial, dbFile) },
    });
    parts.push({
      file: dbFile,
      kind: "database",
      bytes: dumped.last.bytes,
      sha256: dumped.last.sha256,
      plain: dumped.first,
    });

    // After the dump: a file the dump knows about is there; one it does not is swept after a
    // restore. Uploads still arriving (.staging) are left out.
    let files: Manifest["files"] = null;
    if (await hasFiles(s.filesDir)) {
      const counted = await countFiles(s.filesDir);
      log(`packing the files (${counted.count} files, ${mb(counted.bytes)})`);
      const filesFile = `files.tar.gz${end}`;
      const packed = await flow({
        from: {
          cmd: "tar",
          args: ["-C", s.filesDir, "--exclude=./.staging", "--exclude=*.tmp", "-czf", "-", "."],
        },
        via,
        to: { file: join(partial, filesFile) },
      });
      parts.push({
        file: filesFile,
        kind: "files",
        bytes: packed.last.bytes,
        sha256: packed.last.sha256,
        plain: packed.first,
      });
      files = { source: s.filesDir, ...counted };
    } else if (s.filesDir) log(`no files folder at ${s.filesDir}: backing up the database only`);

    const manifest: Manifest = {
      format: manifestFormat,
      name,
      createdAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      host: hostname(),
      database: { server: info.server, pgDump, migrations: info.migrations, accounts: info.accounts },
      files,
      encryption:
        s.encryption.method === "age"
          ? { method: "age", recipients: s.encryption.recipients }
          : { method: s.encryption.method },
      parts,
    };
    await writeFile(join(partial, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const folder = join(base, name);
    await rename(partial, folder);
    try {
      for (const target of targets) {
        if (target.label !== "local") log(`uploading to ${target.label}`);
        await target.put(folder, name);
      }
    } finally {
      // Without a local copy the folder was only on its way.
      if (!s.localDir) await rm(folder, { recursive: true, force: true });
    }
    return manifest;
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  } finally {
    await gpg.remove();
  }
}

/** Deletes, at every target, the backups retention does not keep, and unfinished ones older than a
 *  day (an interrupted upload). */
export async function prune(s: Settings) {
  for (const target of targetsOf(s)) {
    const stored = await target.list();
    const keep = toKeep(
      stored.filter((b) => b.complete),
      s.retention,
    );
    const dayAgo = Date.now() - 86_400_000;
    for (const backup of stored) {
      if (backup.complete ? keep.has(backup.name) : backup.at.getTime() > dayAgo) continue;
      log(`deleting ${backup.name} from ${target.label}${backup.complete ? "" : " (unfinished)"}`);
      await target.remove(backup.name);
    }
  }
  if (s.localDir) {
    // Partial folders from a run that was killed.
    for (const entry of await readdir(s.localDir).catch(() => [] as string[]))
      if (entry.startsWith(".partial-")) await rm(join(s.localDir, entry), { recursive: true, force: true });
  }
}

export const mb = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
