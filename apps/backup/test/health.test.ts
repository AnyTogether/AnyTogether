import { type BackupStatus, backupHealth, parseBackupStatus } from "@anytogether/shared";
import { describe, expect, it } from "vitest";

const now = Date.parse("2026-10-25T12:00:00Z");
const status = (fields: Partial<BackupStatus> = {}): BackupStatus => ({
  version: 1,
  schedule: "0 3 * * *",
  periodSeconds: 86_400,
  targets: ["offsite:anytogether", "local"],
  encryption: "age",
  updatedAt: "2026-10-25T03:00:00Z",
  ...fields,
});
const run = (at: string, ok = true) => ({ at, ok, name: "anytogether-x", bytes: 1 });

describe("backup health", () => {
  it("is ok within two periods and stale after", () => {
    expect(backupHealth(status({ lastSuccess: run("2026-10-25T03:00:00Z") }), now).state).toBe("ok");
    expect(backupHealth(status({ lastSuccess: run("2026-10-23T13:00:00Z") }), now).state).toBe("ok");
    const late = backupHealth(status({ lastSuccess: run("2026-10-23T11:00:00Z") }), now);
    expect(late).toEqual({ state: "stale", ageSeconds: 2 * 86_400 + 3600, staleAfterSeconds: 2 * 86_400 });
  });

  it("says failing when the latest attempt failed but the last success is recent", () => {
    const s = status({
      lastSuccess: run("2026-10-24T03:00:00Z"),
      lastAttempt: run("2026-10-25T03:00:00Z", false),
    });
    expect(backupHealth(s, now).state).toBe("failing");
  });

  it("waits two periods after starting before calling a first backup late", () => {
    expect(backupHealth(status({ startedAt: "2026-10-24T12:00:00Z" }), now).state).toBe("pending");
    expect(backupHealth(status({ startedAt: "2026-10-22T12:00:00Z" }), now).state).toBe("stale");
  });

  it("reads only real status files", () => {
    expect(parseBackupStatus(JSON.stringify(status()))?.schedule).toBe("0 3 * * *");
    expect(parseBackupStatus("{}")).toBeNull();
    expect(parseBackupStatus("not json")).toBeNull();
    expect(parseBackupStatus(JSON.stringify({ ...status(), periodSeconds: 0 }))).toBeNull();
  });
});
