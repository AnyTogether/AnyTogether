import { BackupNotice, type BackupReport } from "@/components/BackupNotice";
import { notifyEn, notifyTr } from "@/lib/i18n-notify";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const status = {
  schedule: "0 3 * * *",
  periodSeconds: 86_400,
  targets: ["offsite:anytogether-backups", "local"],
  lastSuccess: {
    at: "2026-10-25T03:00:00Z",
    ok: true,
    name: "anytogether-20261025T030000Z",
    bytes: 52_428_800,
    targets: ["offsite:anytogether-backups", "local"],
  },
};
const html = (report: BackupReport | null, texts = notifyEn) =>
  renderToStaticMarkup(<BackupNotice report={report} texts={texts} />);

describe("the backup line on the admin page", () => {
  it("names the last backup's age, size and targets", () => {
    const out = html({ reported: true, status, health: { state: "ok", ageSeconds: 5 * 3600 } });
    expect(out).toContain("Last backup 5 h ago: 50.0 MB to offsite:anytogether-backups, local.");
    expect(out).toContain('class="admin-backup ok"');
    expect(out).not.toContain('role="alert"');
  });

  it("warns when backups are late or the latest failed, in both languages", () => {
    const late = { reported: true, status, health: { state: "stale" as const, ageSeconds: 3 * 86_400 } };
    expect(html(late)).toContain(
      "Backups are late: the last good one was 3 days ago, and one is due every 24 h.",
    );
    expect(html(late)).toContain('role="alert"');
    expect(html(late, notifyTr)).toContain("Yedekler gecikti: son başarılı yedek 3 gün önce");
    const failing = {
      reported: true,
      status: { ...status, lastAttempt: { at: "2026-10-26T03:00:00Z", ok: false, error: "rclone failed" } },
      health: { state: "failing" as const, ageSeconds: 25 * 3600 },
    };
    expect(html(failing)).toContain(
      "The latest backup failed: rclone failed. The last good one was 25 h ago.",
    );
    const never = {
      reported: true,
      status: { ...status, lastSuccess: undefined },
      health: { state: "stale" as const, ageSeconds: null },
    };
    expect(html(never)).toContain("none has worked since the backup service started");
  });

  it("says when no backup service reports", () => {
    expect(html({ reported: false, status: null, health: null })).toContain("No backup service reports");
    expect(html(null)).toContain('class="admin-backup none"');
  });
});
