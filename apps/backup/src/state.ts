import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BackupRun, type BackupStatus, parseBackupStatus } from "@anytogether/shared";
import { longestGap } from "./cron.js";
import { type Settings, targetLabels } from "./settings.js";

export const statusPath = (s: Settings) => join(s.stateDir, "status.json");

export async function readStatus(s: Settings): Promise<BackupStatus | null> {
  try {
    return parseBackupStatus(await readFile(statusPath(s), "utf8"));
  } catch {
    return null;
  }
}

/** Writes the status file the admin page and `status` read: settings as they are now, and the
 *  run just made (if any) as the last attempt and, when it worked, the last success. */
export async function writeStatus(s: Settings, update: { run?: BackupRun; startedAt?: string } = {}) {
  const previous = await readStatus(s);
  const status: BackupStatus = {
    version: 1,
    schedule: s.schedule.source,
    periodSeconds: longestGap(s.schedule),
    targets: targetLabels(s),
    encryption: s.encryption.method,
    updatedAt: new Date().toISOString(),
    ...((update.startedAt ?? previous?.startedAt)
      ? { startedAt: update.startedAt ?? previous?.startedAt }
      : {}),
    ...(previous?.lastAttempt ? { lastAttempt: previous.lastAttempt } : {}),
    ...(previous?.lastSuccess ? { lastSuccess: previous.lastSuccess } : {}),
  };
  if (update.run) {
    status.lastAttempt = update.run;
    if (update.run.ok) status.lastSuccess = update.run;
  }
  await mkdir(s.stateDir, { recursive: true });
  const temp = `${statusPath(s)}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(status, null, 2)}\n`);
  await rename(temp, statusPath(s));
  return status;
}

/** One backup or restore at a time, also between `docker compose exec … run` and the schedule. */
export async function withLock<T>(s: Settings, what: string, work: () => Promise<T>): Promise<T> {
  await mkdir(s.stateDir, { recursive: true });
  const path = join(s.stateDir, "lock");
  let taken = false;
  for (let attempt = 0; attempt < 2 && !taken; attempt++) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid} ${what} ${new Date().toISOString()}\n`);
      await handle.close();
      taken = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [pid, holder] = (await readFile(path, "utf8").catch(() => "")).split(" ");
      // After a container restart the same pid may come back: a lock of our own pid is stale.
      if (pid && Number(pid) !== process.pid && alive(Number(pid)))
        throw new Error(`a ${holder ?? "backup"} is running already (pid ${pid})`);
      // Left behind by a process that is gone (a restart mid-backup): take it over.
      await rm(path, { force: true });
    }
  }
  if (!taken) throw new Error("could not take the backup lock");
  try {
    return await work();
  } finally {
    await rm(path, { force: true });
  }
}

function alive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
