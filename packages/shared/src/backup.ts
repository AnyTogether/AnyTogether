/** What the backup service (apps/backup) writes after every run, and how the API and the
 *  service's own `status` decide whether backups are keeping up. Any other backup script can
 *  write the same file (BACKUP_STATUS_FILE for the API) to show up in the admin page. */

export interface BackupRun {
  /** When the run started (ISO 8601). */
  at: string;
  ok: boolean;
  /** The backup's name, e.g. anytogether-20261025T030000Z. */
  name?: string;
  /** Bytes stored per copy (database and files, as uploaded). */
  bytes?: number;
  /** Where it went: rclone remotes as `remote:path` (never credentials) and `local`. */
  targets?: string[];
  durationSeconds?: number;
  /** The newest database migration in it, e.g. 0017_appear_offline. */
  migration?: string;
  /** Why it failed, one line. */
  error?: string;
}

export interface BackupStatus {
  version: 1;
  /** The cron expression the service runs on. */
  schedule: string;
  /** The longest gap between two scheduled runs, in seconds. */
  periodSeconds: number;
  /** Where backups go, as above. */
  targets: string[];
  encryption: "age" | "gpg" | "none";
  /** When the service last wrote this file (it does when it starts, too). */
  updatedAt: string;
  /** When the service started; with no success yet, backups count as late two periods after. */
  startedAt?: string;
  lastAttempt?: BackupRun;
  lastSuccess?: BackupRun;
}

export type BackupState =
  /** The last success is within two schedule periods. */
  | "ok"
  /** Still within two periods, but the latest attempt failed. */
  | "failing"
  /** No success for more than two periods: the admin page and the logs warn. */
  | "stale"
  /** No success yet, and the service has not been running for two periods. */
  | "pending";

export interface BackupHealth {
  state: BackupState;
  /** Seconds since the last success, when there was one. */
  ageSeconds: number | null;
  /** Late after this many seconds without a success: two schedule periods. */
  staleAfterSeconds: number;
}

/** How backups are doing at `now`, from the status file. */
export function backupHealth(status: BackupStatus, now = Date.now()): BackupHealth {
  const staleAfterSeconds = Math.max(60, Math.round(status.periodSeconds * 2));
  const seconds = (iso: string | undefined) => {
    const time = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(time) ? Math.max(0, Math.round((now - time) / 1000)) : null;
  };
  const ageSeconds = seconds(status.lastSuccess?.at);
  if (ageSeconds === null) {
    const running = seconds(status.startedAt ?? status.updatedAt);
    return {
      state: running !== null && running <= staleAfterSeconds ? "pending" : "stale",
      ageSeconds,
      staleAfterSeconds,
    };
  }
  if (ageSeconds > staleAfterSeconds) return { state: "stale", ageSeconds, staleAfterSeconds };
  const last = status.lastAttempt;
  const failing = !!last && !last.ok && last.at > (status.lastSuccess?.at ?? "");
  return { state: failing ? "failing" : "ok", ageSeconds, staleAfterSeconds };
}

/** A status file's contents, or null when it is not one. */
export function parseBackupStatus(text: string): BackupStatus | null {
  try {
    const value = JSON.parse(text) as Partial<BackupStatus>;
    if (value?.version !== 1 || typeof value.schedule !== "string") return null;
    if (typeof value.periodSeconds !== "number" || !(value.periodSeconds > 0)) return null;
    if (!Array.isArray(value.targets) || typeof value.updatedAt !== "string") return null;
    return value as BackupStatus;
  } catch {
    return null;
  }
}
