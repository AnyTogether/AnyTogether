import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { type Cron, parseCron } from "./cron.js";
import type { Retention } from "./retention.js";

export type Encryption =
  | { method: "age"; recipients: string[] }
  | { method: "gpg"; passphrase: string }
  | { method: "none" };

export interface Settings {
  databaseUrl: string;
  /** The API's STORAGE_DIR as mounted here (cloud saves, media); empty: no files. */
  filesDir: string;
  schedule: Cron;
  /** rclone `remote:path`, or empty for local copies only. */
  remote: string;
  /** Where local copies are kept, or empty for none. */
  localDir: string;
  retention: Retention;
  encryption: Encryption;
  /** For restores of age-encrypted backups: the private key file (never needed for backups). */
  ageIdentityFile: string;
  /** For restores of gpg-encrypted backups. */
  passphrase: string;
  stateDir: string;
  workDir: string;
  prefix: string;
  runOnStart: boolean;
}

const flag = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === "" ? fallback : /^(1|true|yes|on)$/i.test(value.trim());

const count = (value: string | undefined, fallback: number, name: string) => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
};

/** Comma- or line-separated (an ssh key has spaces of its own). */
const items = (value: string | undefined) =>
  (value ?? "")
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

/** Settings from the environment (deploy/.env.example, docs/self-hosting.md "Backups"). */
export function settings(env: NodeJS.ProcessEnv = process.env, read = readSecret): Settings {
  const recipients = items(env.BACKUP_AGE_RECIPIENTS);
  const passphrase = env.BACKUP_PASSPHRASE || read(env.BACKUP_PASSPHRASE_FILE);
  const declared = (env.BACKUP_ENCRYPTION ?? "").trim().toLowerCase();
  let encryption: Encryption;
  if (recipients.length && passphrase && declared !== "age" && declared !== "gpg")
    throw new Error(
      "set BACKUP_AGE_RECIPIENTS or BACKUP_PASSPHRASE, not both (or BACKUP_ENCRYPTION=age|gpg)",
    );
  if (declared === "none") encryption = { method: "none" };
  else if (recipients.length && declared !== "gpg") {
    for (const key of recipients)
      if (!/^(age1[0-9a-z]+|ssh-(ed25519|rsa) \S+.*)$/.test(key))
        throw new Error(`BACKUP_AGE_RECIPIENTS: "${key}" is not an age (age1…) or ssh public key`);
    encryption = { method: "age", recipients };
  } else if (passphrase) encryption = { method: "gpg", passphrase };
  else if (declared === "age" || declared === "gpg")
    throw new Error(`BACKUP_ENCRYPTION=${declared} needs BACKUP_AGE_RECIPIENTS or BACKUP_PASSPHRASE`);
  else encryption = { method: "none" };

  const databaseUrl = env.DATABASE_URL ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return {
    databaseUrl,
    filesDir: env.BACKUP_FILES_DIR ?? env.STORAGE_DIR ?? "",
    schedule: parseCron(env.BACKUP_SCHEDULE || "0 3 * * *"),
    remote: (env.BACKUP_REMOTE ?? "").trim().replace(/\/+$/, ""),
    localDir: flag(env.BACKUP_KEEP_LOCAL, true) ? env.BACKUP_LOCAL_DIR || "/backups" : "",
    retention: {
      daily: count(env.BACKUP_KEEP_DAILY, 7, "BACKUP_KEEP_DAILY"),
      weekly: count(env.BACKUP_KEEP_WEEKLY, 4, "BACKUP_KEEP_WEEKLY"),
      monthly: count(env.BACKUP_KEEP_MONTHLY, 3, "BACKUP_KEEP_MONTHLY"),
    },
    encryption,
    ageIdentityFile: env.BACKUP_AGE_IDENTITY_FILE ?? "",
    passphrase: passphrase ?? "",
    stateDir: env.BACKUP_STATE_DIR || "/data/backup-state",
    workDir: env.BACKUP_WORK_DIR || tmpdir(),
    prefix: env.BACKUP_PREFIX || "anytogether",
    runOnStart: flag(env.BACKUP_ON_START, false),
  };
}

/** A secret from a file (Docker secrets and the like), trimmed; empty when there is none. */
export function readSecret(path: string | undefined): string {
  if (!path) return "";
  return readFileSync(path, "utf8").trim();
}

/** The targets as the status file and the logs name them: never credentials. */
export function targetLabels(s: Settings): string[] {
  return [...(s.remote ? [s.remote] : []), ...(s.localDir ? ["local"] : [])];
}
