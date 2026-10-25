import { fill } from "@/lib/people";

interface BackupRun {
  at: string;
  ok: boolean;
  name?: string;
  bytes?: number;
  targets?: string[];
  error?: string;
}

/** GET /admin/backups (packages/shared/src/backup.ts has the full shape). */
export interface BackupReport {
  reported: boolean;
  status: {
    schedule: string;
    periodSeconds: number;
    targets: string[];
    lastAttempt?: BackupRun;
    lastSuccess?: BackupRun;
  } | null;
  health: { state: "ok" | "failing" | "stale" | "pending"; ageSeconds: number | null } | null;
}

export interface BackupTexts {
  backupOk: string;
  backupFailing: string;
  backupStale: string;
  backupStaleNever: string;
  backupPending: string;
  backupNone: string;
  agoMinutes: string;
  agoHours: string;
  agoDays: string;
  spanHours: string;
  spanDays: string;
}

/** "5 h ago" in the page's language. */
function ago(seconds: number, t: BackupTexts) {
  if (seconds < 5400) return fill(t.agoMinutes, { n: Math.max(1, Math.round(seconds / 60)) });
  if (seconds < 172_800) return fill(t.agoHours, { n: Math.round(seconds / 3600) });
  return fill(t.agoDays, { n: Math.round(seconds / 86_400) });
}

/** "24 h", "7 days": how often backups are due. */
const span = (seconds: number, t: BackupTexts) =>
  seconds < 172_800
    ? fill(t.spanHours, { n: Math.max(1, Math.round(seconds / 3600)) })
    : fill(t.spanDays, { n: Math.round(seconds / 86_400) });

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

/** One line at the top of the admin page: when the last backup worked, its size and where it went,
 *  and a warning when backups are late (no success for two schedule periods) or the latest failed. */
export function BackupNotice({ report, texts }: { report: BackupReport | null; texts: BackupTexts }) {
  if (!report?.reported || !report.status || !report.health)
    return <p className="admin-backup none">{texts.backupNone}</p>;
  const { status, health } = report;
  const last = status.lastSuccess;
  const when = last ? ago(health.ageSeconds ?? 0, texts) : "";
  const where = (last?.targets ?? status.targets).join(", ");
  let line: string;
  switch (health.state) {
    case "ok":
      line = fill(texts.backupOk, { when, size: size(last?.bytes ?? 0), where });
      break;
    case "failing":
      line = fill(texts.backupFailing, { error: status.lastAttempt?.error ?? "?", when });
      break;
    case "stale":
      line = last
        ? fill(texts.backupStale, { when, every: span(status.periodSeconds, texts) })
        : texts.backupStaleNever;
      break;
    default:
      line = fill(texts.backupPending, { where });
  }
  return (
    <p className={`admin-backup ${health.state}`} role={health.state === "ok" ? undefined : "alert"}>
      <span className="dot" aria-hidden="true" />
      {line}
    </p>
  );
}
