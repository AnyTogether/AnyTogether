/** Backup and restore end to end, against a real PostgreSQL and real rclone targets: an S3 bucket
 *  (MinIO) and rclone's local backend. Needs pg_dump/pg_restore, tar, rclone, age, age-keygen and
 *  gpg on PATH, so it only runs from test/e2e.sh (which starts MinIO), or with the variables below
 *  set by hand:
 *    BACKUP_E2E_DATABASE_URL  a PostgreSQL URL whose user may create databases
 *    BACKUP_E2E_S3            rclone remote:bucket for an S3 target, configured by RCLONE_CONFIG_* */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runMigrations } from "@anytogether/db/migrate";
import { backupHealth } from "@anytogether/shared";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupNow, prune } from "../src/backup.js";
import { listBackups, restore } from "../src/restore.js";
import { nameFor } from "../src/retention.js";
import { settings } from "../src/settings.js";
import { readStatus } from "../src/state.js";

const adminUrl = process.env.BACKUP_E2E_DATABASE_URL;
const s3 = process.env.BACKUP_E2E_S3;

const dbUrl = (name: string) => {
  const url = new URL(adminUrl ?? "postgres://localhost/x");
  url.pathname = `/${name}`;
  return url.toString();
};

/** Every row of every table in the public and drizzle schemas, as one hash per table. */
async function fingerprint(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const tables = await sql<{ schema: string; name: string }[]>`
      select table_schema as schema, table_name as name from information_schema.tables
      where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE' order by 1, 2`;
    const out: Record<string, string> = {};
    for (const t of tables) {
      const [row] = await sql.unsafe(
        `select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${t.schema}"."${t.name}" x`,
      );
      out[`${t.schema}.${t.name}`] = `${row?.n}:${row?.h}`;
    }
    return out;
  } finally {
    await sql.end();
  }
}

async function filesOf(dir: string) {
  const out: Record<string, string> = {};
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        out[relative(dir, path)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    }
  };
  await walk(dir);
  return out;
}

describe.skipIf(!adminUrl)("backup and restore, end to end", () => {
  const suffix = randomBytes(3).toString("hex");
  const source = `backup_src_${suffix}`;
  const fresh = `backup_dst_${suffix}`;
  let work: string;
  let files: string;
  let identity: string;
  let recipient: string;
  const admin = postgres(adminUrl ?? "postgres://localhost/x", { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "anytogether-backup-e2e-"));
    await admin.unsafe(`create database ${source}`);
    await admin.unsafe(`create database ${fresh}`);
    await runMigrations(dbUrl(source));
    // Some people, with an avatar in bytea and text that needs escaping.
    const sql = postgres(dbUrl(source), { max: 1, onnotice: () => {} });
    for (let i = 0; i < 25; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await sql`insert into accounts (id, email) values (${id}, ${`p${i}@example.org`})`;
      await sql`insert into profiles (account_id, handle, display_name, bio)
                values (${id}, ${`player${i}`}, ${`Oyuncu ${i} ğüşiöç`}, ${"tab\there 'quote' \\ \n line"})`;
      await sql`insert into avatars (hash, account_id, bytes) values (${`h${i}`}, ${id}, ${randomBytes(2048)})`;
    }
    await sql.end();
    // The files store: saves and media in nested folders, and an upload still arriving.
    files = join(work, "files");
    await mkdir(join(files, "saves", "ab"), { recursive: true });
    await mkdir(join(files, "media", "cd"), { recursive: true });
    await mkdir(join(files, ".staging"), { recursive: true });
    await writeFile(join(files, "saves", "ab", "abcdef"), randomBytes(300_000));
    await writeFile(join(files, "media", "cd", "cdef01"), randomBytes(50_000));
    await writeFile(join(files, ".staging", "upload-1"), "half an upload");
    await writeFile(join(files, "media", "cd", "x.123.tmp"), "being written");
    // An age key pair: the server gets only the public key.
    identity = join(work, "age-identity.txt");
    execFileSync("age-keygen", ["-o", identity], { stdio: "ignore" });
    recipient = execFileSync("age-keygen", ["-y", identity], { encoding: "utf8" }).trim();
  });

  afterAll(async () => {
    await admin.unsafe(`drop database if exists ${source} with (force)`);
    await admin.unsafe(`drop database if exists ${fresh} with (force)`);
    await admin.end();
    if (work) await rm(work, { recursive: true, force: true });
  });

  const env = (fields: Record<string, string>) => ({
    BACKUP_STATE_DIR: join(work, "state"),
    BACKUP_WORK_DIR: join(work, "tmp"),
    BACKUP_PREFIX: `e2e${suffix}`,
    ...fields,
  });

  it.skipIf(!s3)("backs up to S3 with age and a local copy, and restores into an empty stack", async () => {
    const remote = `${s3}/${suffix}`;
    const made = settings(
      env({
        DATABASE_URL: dbUrl(source),
        BACKUP_FILES_DIR: files,
        BACKUP_REMOTE: remote,
        BACKUP_LOCAL_DIR: join(work, "local"),
        BACKUP_AGE_RECIPIENTS: recipient,
      }),
    );
    const manifest = await backupNow(made);
    expect(manifest.encryption).toEqual({ method: "age", recipients: [recipient] });
    expect(manifest.database.accounts).toBe(25);
    expect(manifest.database.migrations.latest).toMatch(/^00\d\d_/);
    expect(manifest.files?.count).toBe(2);
    expect(manifest.parts.map((p) => p.file)).toEqual(["database.pgdump.age", "files.tar.gz.age"]);

    // Stored encrypted: the dump's text is nowhere in the stored part.
    const stored = await readFile(join(work, "local", manifest.name, "database.pgdump.age"));
    expect(stored.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
    expect(stored.includes(Buffer.from("player1"))).toBe(false);

    const listed = await listBackups(made);
    expect(listed.map((l) => [l.target.label, l.backups.map((b) => b.complete)])).toEqual([
      ["local", [true]],
      [remote, [true]],
    ]);

    const status = await readStatus(made);
    expect(status?.lastSuccess?.name).toBe(manifest.name);
    expect(status?.targets).toEqual([remote, "local"]);
    expect(status && backupHealth(status).state).toBe("ok");

    // A new machine: an empty database, an empty files folder, only the remote and the key.
    const restoredFiles = join(work, "restored-files");
    const into = settings(
      env({
        DATABASE_URL: dbUrl(fresh),
        BACKUP_FILES_DIR: restoredFiles,
        BACKUP_REMOTE: remote,
        BACKUP_KEEP_LOCAL: "false",
        BACKUP_AGE_IDENTITY_FILE: identity,
        BACKUP_STATE_DIR: join(work, "state-new"),
      }),
    );
    await restore(into, { name: "latest" });
    expect(await fingerprint(dbUrl(fresh))).toEqual(await fingerprint(dbUrl(source)));
    const want = await filesOf(files);
    delete want[join(".staging", "upload-1")];
    delete want[join("media", "cd", "x.123.tmp")];
    expect(await filesOf(restoredFiles)).toEqual(want);

    // Now it has accounts: no second restore over it without --force.
    await expect(restore(into, { name: "latest" })).rejects.toThrow(/25 account\(s\) already/);
    await expect(restore(into, { name: "latest", force: true })).resolves.toBeTruthy();
    expect(await fingerprint(dbUrl(fresh))).toEqual(await fingerprint(dbUrl(source)));

    // Without the private key it cannot be read.
    const keyless = settings(
      env({ DATABASE_URL: dbUrl(fresh), BACKUP_REMOTE: remote, BACKUP_KEEP_LOCAL: "false" }),
    );
    await expect(restore(keyless, { name: "latest", verifyOnly: true })).rejects.toThrow(
      /BACKUP_AGE_IDENTITY_FILE/,
    );
  });

  it("backs up to rclone's local backend with a passphrase, catches damage, and prunes", async () => {
    const remoteDir = join(work, "remote");
    process.env.RCLONE_CONFIG_E2ELOCAL_TYPE = "local";
    const remote = `e2elocal:${remoteDir}`;
    const fields = {
      DATABASE_URL: dbUrl(source),
      BACKUP_FILES_DIR: files,
      BACKUP_REMOTE: remote,
      BACKUP_KEEP_LOCAL: "false",
      BACKUP_PASSPHRASE: "correct horse battery staple",
      BACKUP_KEEP_DAILY: "2",
      BACKUP_KEEP_WEEKLY: "1",
      BACKUP_KEEP_MONTHLY: "0",
    };
    const s = settings(env(fields));
    const manifest = await backupNow(s);
    expect(manifest.parts.map((p) => p.file)).toEqual(["database.pgdump.gpg", "files.tar.gz.gpg"]);
    // Nothing left behind on this machine without a local copy.
    expect((await readdir(join(work, "tmp"))).filter((n) => n.startsWith(`e2e${suffix}`))).toEqual([]);

    await restore(s, { name: manifest.name, verifyOnly: true });
    // The wrong passphrase fails.
    const wrong = settings(env({ ...fields, BACKUP_PASSPHRASE: "wrong" }));
    await expect(restore(wrong, { name: manifest.name, verifyOnly: true })).rejects.toThrow(/gpg failed/);

    // One flipped byte in the stored dump is caught before anything is restored.
    const part = join(remoteDir, manifest.name, "database.pgdump.gpg");
    const bytes = await readFile(part);
    bytes[bytes.length >> 1] = (bytes[bytes.length >> 1] ?? 0) ^ 0xff;
    await writeFile(part, bytes);
    await expect(restore(s, { name: manifest.name, verifyOnly: true })).rejects.toThrow(/SHA-256/);

    // Older backups (copies of this one under older names) and an unfinished one, then pruning:
    // the 2 newest days and the newest of 1 week stay.
    const day = 86_400_000;
    const at = new Date(Date.now() - day / 2);
    const old = [1, 2, 3, 9, 40].map((d) => nameFor(s.prefix, new Date(at.getTime() - d * day)));
    for (const name of old) {
      await mkdir(join(remoteDir, name), { recursive: true });
      await writeFile(join(remoteDir, name, "manifest.json"), "{}");
    }
    const unfinished = nameFor(s.prefix, new Date(at.getTime() - 5 * day));
    await mkdir(join(remoteDir, unfinished), { recursive: true });
    await writeFile(join(remoteDir, unfinished, "database.pgdump.gpg"), "partial");
    await prune(s);
    const left = (await readdir(remoteDir)).sort();
    expect(left).toEqual([manifest.name, old[0]].sort());
    expect((await stat(join(remoteDir, manifest.name))).isDirectory()).toBe(true);
  });
});
