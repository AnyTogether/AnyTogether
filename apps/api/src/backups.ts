import { readFile } from "node:fs/promises";
import { type BackupHealth, type BackupStatus, backupHealth, parseBackupStatus } from "@anytogether/shared";

export interface BackupReport {
  /** False when there is no status file: no backup service has reported to this server. */
  reported: boolean;
  status: BackupStatus | null;
  health: BackupHealth | null;
}

/** What the backup service (apps/backup, or any script writing the same file) last reported. */
export async function backupReport(file: string | undefined, now = Date.now()): Promise<BackupReport> {
  if (!file) return { reported: false, status: null, health: null };
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { reported: false, status: null, health: null };
  }
  const status = parseBackupStatus(text);
  return status
    ? { reported: true, status, health: backupHealth(status, now) }
    : { reported: false, status: null, health: null };
}

/** A log line when backups are late (checked hourly by main.ts), or null. */
export async function lateBackupWarning(file: string | undefined): Promise<string | null> {
  const report = await backupReport(file);
  if (report.health?.state !== "stale") return null;
  const hours = (seconds: number) => Math.round(seconds / 3600);
  const last = report.status?.lastSuccess;
  return last
    ? `backups are late: the last successful one was ${hours(report.health.ageSeconds ?? 0)} h ago (${last.name}), expected every ${hours(report.status?.periodSeconds ?? 0)} h`
    : "backups are late: none has succeeded since the backup service started";
}
