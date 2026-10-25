import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupStatus } from "@anytogether/shared";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { lateBackupWarning } from "../src/backups.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
let dir: string | undefined;
afterEach(async () => {
  await h.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const v1 = "/api/v1";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function status(lastSuccessHoursAgo: number | null): BackupStatus {
  const success =
    lastSuccessHoursAgo === null
      ? {}
      : {
          lastSuccess: {
            at: hoursAgo(lastSuccessHoursAgo),
            ok: true,
            name: "anytogether-20261025T030000Z",
            bytes: 12_345_678,
            targets: ["offsite:anytogether-backups", "local"],
            durationSeconds: 42,
            migration: "0017_appear_offline",
          },
        };
  return {
    version: 1,
    schedule: "0 3 * * *",
    periodSeconds: 86_400,
    targets: ["offsite:anytogether-backups", "local"],
    encryption: "age",
    updatedAt: hoursAgo(1),
    startedAt: hoursAgo(100),
    ...success,
  };
}

async function withStatus(value: BackupStatus | string) {
  dir = await mkdtemp(join(tmpdir(), "backup-status-"));
  const file = join(dir, "status.json");
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

describe("backups on the admin page", () => {
  it("shows admins the last backup and whether backups are late", async () => {
    const file = await withStatus(status(5));
    h = await harness({ backupStatusFile: file });
    const boss = await h.user("boss@example.com");
    const someone = await h.user("someone@example.com");
    await run(["grant", "@boss"], h.deps);

    expect((await h.call("GET", `${v1}/admin/backups`, undefined, someone.token)).status).toBe(403);
    const ok = await h.call("GET", `${v1}/admin/backups`, undefined, boss.token);
    expect(ok.status).toBe(200);
    expect(ok.body.reported).toBe(true);
    expect(ok.body.health.state).toBe("ok");
    expect(ok.body.status.lastSuccess).toMatchObject({
      bytes: 12_345_678,
      targets: ["offsite:anytogether-backups", "local"],
    });

    await writeFile(file, JSON.stringify(status(60)));
    const late = await h.call("GET", `${v1}/admin/backups`, undefined, boss.token);
    expect(late.body.health).toMatchObject({ state: "stale", staleAfterSeconds: 172_800 });
  });

  it("says nothing was reported without a status file, or with a broken one", async () => {
    h = await harness({ backupStatusFile: "/nonexistent/status.json" });
    const boss = await h.user("boss@example.com");
    await run(["grant", "@boss"], h.deps);
    const none = await h.call("GET", `${v1}/admin/backups`, undefined, boss.token);
    expect(none.body).toEqual({ reported: false, status: null, health: null });
    expect(await lateBackupWarning(await withStatus("{not json"))).toBeNull();
  });
});

describe("the late-backup log line", () => {
  it("warns only when the last success is older than two periods", async () => {
    h = await harness();
    expect(await lateBackupWarning(await withStatus(status(30)))).toBeNull();
    await rm(dir as string, { recursive: true });
    expect(await lateBackupWarning(await withStatus(status(50)))).toMatch(/last successful one was 50 h ago/);
    await rm(dir as string, { recursive: true });
    expect(await lateBackupWarning(await withStatus(status(null)))).toMatch(/none has succeeded/);
    expect(await lateBackupWarning(undefined)).toBeNull();
  });
});
