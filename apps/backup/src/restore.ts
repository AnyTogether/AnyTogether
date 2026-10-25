import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Manifest, manifestFormat, mb, targetsOf } from "./backup.js";
import { decryptStep, gpgHome } from "./crypt.js";
import { databaseInfo, knownMigrations, resetDatabase } from "./db.js";
import { log } from "./log.js";
import { flow, hashFile, run } from "./proc.js";
import type { Settings } from "./settings.js";
import { withLock } from "./state.js";
import { type Stored, type Target, readManifestFile } from "./targets.js";

export interface RestoreOptions {
  /** A backup's name, or "latest". */
  name: string;
  /** "local", the remote's label, or empty: the first target that has it. */
  from?: string;
  /** Overwrite a database that has accounts, or a files folder that has files. */
  force?: boolean;
  /** Only the database. */
  skipFiles?: boolean;
  /** Check the hashes (and that it decrypts) without restoring anything. */
  verifyOnly?: boolean;
}

/** Every complete backup at every target, newest first. */
export async function listBackups(s: Settings): Promise<{ target: Target; backups: Stored[] }[]> {
  const out = [];
  for (const target of targetsOf(s)) {
    const backups = (await target.list()).sort((a, b) => b.at.getTime() - a.at.getTime());
    out.push({ target, backups });
  }
  return out;
}

async function locate(s: Settings, opts: RestoreOptions): Promise<{ target: Target; name: string }> {
  for (const { target, backups } of await listBackups(s)) {
    if (opts.from && opts.from !== target.label && !(opts.from === "remote" && target.label !== "local"))
      continue;
    const complete = backups.filter((b) => b.complete);
    const found = opts.name === "latest" ? complete[0] : complete.find((b) => b.name === opts.name);
    if (found) return { target, name: found.name };
  }
  throw new Error(
    `no complete backup ${opts.name === "latest" ? "" : `named ${opts.name} `}at ${
      opts.from ||
      targetsOf(s)
        .map((t) => t.label)
        .join(" or ") ||
      "any target"
    }`,
  );
}

const isEmptyDir = async (dir: string) =>
  (await readdir(dir).catch(() => [] as string[])).filter((n) => n !== ".staging" && n !== "lost+found")
    .length === 0;

/** Restores a backup into this stack: downloads it, checks every part against the manifest,
 *  decrypts, then loads the database and unpacks the files. Refuses a database with accounts in it
 *  (or a files folder with files) unless forced. Stop the api, realtime and web services first. */
export async function restore(s: Settings, opts: RestoreOptions): Promise<Manifest> {
  return withLock(s, "restore", async () => {
    const { target, name } = await locate(s, opts);
    await mkdir(s.workDir, { recursive: true });
    const work = await mkdtemp(join(s.workDir, "restore-"));
    const gpg = await gpgHome();
    try {
      log(`${opts.verifyOnly ? "checking" : "restoring"} ${name} from ${target.label}`);
      const dir = await target.get(name, work);
      const manifest = await readManifestFile<Manifest>(dir);
      if (manifest.format !== manifestFormat)
        throw new Error(`${name}: unknown manifest format ${manifest.format}`);

      // Stored bytes first: a damaged or tampered download stops here, before anything is touched.
      for (const part of manifest.parts) {
        const got = await hashFile(join(dir, part.file));
        if (got.sha256 !== part.sha256 || got.bytes !== part.bytes)
          throw new Error(`${part.file}: SHA-256 does not match the manifest (damaged or changed)`);
      }
      log(`all ${manifest.parts.length} parts match the manifest`);

      const decrypt = decryptStep(manifest.encryption.method, s, gpg.dir);
      const plainFiles = new Map<string, string>();
      for (const part of manifest.parts) {
        const plain = join(work, `${part.kind}.plain`);
        const result = await flow({
          from: { file: join(dir, part.file) },
          via: decrypt ? [decrypt] : [],
          to: { file: plain },
        });
        if (result.last.sha256 !== part.plain.sha256)
          throw new Error(`${part.file}: decrypted contents do not match the manifest`);
        plainFiles.set(part.kind, plain);
        // Downloaded copies are not needed once decrypted (local copies are left alone).
        if (target.label !== "local") await rm(join(dir, part.file), { force: true });
      }
      if (manifest.encryption.method !== "none") log("decrypted, contents match the manifest");
      if (opts.verifyOnly) return manifest;

      // The database.
      const known = knownMigrations.length;
      const { count: theirs, latest } = manifest.database.migrations;
      if (theirs > known && !opts.force)
        throw new Error(
          `${name} comes from a newer AnyTogether (${theirs} migrations, this one knows ${known}): update first, or --force`,
        );
      const now = await databaseInfo(s.databaseUrl);
      if (now.accounts && !opts.force)
        throw new Error(
          `the database has ${now.accounts} account(s) already: restore only into an empty one, or add --force to replace everything in it`,
        );
      const dump = plainFiles.get("database");
      if (!dump) throw new Error(`${name} has no database part`);
      // Both checks before anything changes: a refused restore leaves the stack as it was.
      const archive = opts.skipFiles ? undefined : plainFiles.get("files");
      if (archive) {
        if (!s.filesDir)
          throw new Error(
            "the backup has files but BACKUP_FILES_DIR (STORAGE_DIR) is not set; or --skip-files",
          );
        if (!(await isEmptyDir(s.filesDir)) && !opts.force)
          throw new Error(`${s.filesDir} has files already: restore into an empty one, or add --force`);
      }
      log(`loading the database (${latest ?? "no migrations"}, ${manifest.database.accounts ?? 0} accounts)`);
      await resetDatabase(s.databaseUrl);
      await run({
        cmd: "pg_restore",
        args: [
          "--no-owner",
          "--no-privileges",
          "--single-transaction",
          "--exit-on-error",
          "--dbname",
          s.databaseUrl,
          dump,
        ],
      });

      // The files.
      if (archive) {
        await mkdir(s.filesDir, { recursive: true });
        for (const entry of await readdir(s.filesDir))
          if (entry !== "lost+found") await rm(join(s.filesDir, entry), { recursive: true, force: true });
        log(`unpacking ${manifest.files?.count ?? "the"} files (${mb(manifest.files?.bytes ?? 0)})`);
        await run({ cmd: "tar", args: ["-C", s.filesDir, "-xzf", archive] });
      } else if (plainFiles.has("files")) log("files left out (--skip-files)");

      const after = await databaseInfo(s.databaseUrl);
      log(
        `restored ${name}: ${after.accounts ?? 0} accounts, ${after.migrations.latest ?? "no migrations"}. Start the stack again: docker compose up -d`,
      );
      return manifest;
    } finally {
      await rm(work, { recursive: true, force: true });
      await gpg.remove();
    }
  });
}
