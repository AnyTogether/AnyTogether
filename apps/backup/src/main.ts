import { backupHealth } from "@anytogether/shared";
import { backupNow, mb, message, prune } from "./backup.js";
import { nextRun } from "./cron.js";
import { log } from "./log.js";
import { run } from "./proc.js";
import { listBackups, restore } from "./restore.js";
import { type Settings, settings, targetLabels } from "./settings.js";
import { readStatus, statusPath, writeStatus } from "./state.js";

const usage = `AnyTogether backups (docs/self-hosting.md, "Backups")

  backup daemon                 run on BACKUP_SCHEDULE (what the compose service does)
  backup run                    make a backup now
  backup list                   the backups at every target
  backup status [--quiet]       the last backup; exits 1 when backups are late
  backup verify <name|latest>   download one and check its hashes and that it decrypts
  backup restore <name|latest> [--from local|remote] [--force] [--skip-files]
                                restore into this stack (stop api, realtime and web first)
  backup prune                  delete what retention no longer keeps`;

const ago = (seconds: number) =>
  seconds < 5400
    ? `${Math.round(seconds / 60)} min`
    : seconds < 172800
      ? `${Math.round(seconds / 3600)} h`
      : `${Math.round(seconds / 86400)} days`;

async function status(s: Settings, quiet: boolean) {
  const current = await readStatus(s);
  if (!current) {
    if (!quiet) console.log(`no status yet (${statusPath(s)}): the service has not run`);
    return 1;
  }
  const health = backupHealth(current);
  if (!quiet) {
    const last = current.lastSuccess;
    console.log(`schedule      ${current.schedule} (late after ${ago(health.staleAfterSeconds)})`);
    console.log(`targets       ${current.targets.join(", ") || "none"}`);
    console.log(`encryption    ${current.encryption}`);
    console.log(
      `last success  ${last ? `${last.at} (${ago(health.ageSeconds ?? 0)} ago), ${last.name}, ${mb(last.bytes ?? 0)}` : "never"}`,
    );
    if (current.lastAttempt && !current.lastAttempt.ok)
      console.log(`last attempt  ${current.lastAttempt.at} FAILED: ${current.lastAttempt.error}`);
    console.log(`state         ${health.state}`);
  }
  return health.state === "stale" ? 1 : 0;
}

/** Warns in the log when the last success is older than two schedule periods. */
async function warnIfLate(s: Settings) {
  const current = await readStatus(s);
  if (!current) return;
  const health = backupHealth(current);
  if (health.state === "stale")
    log(
      current.lastSuccess
        ? `the last successful backup is ${ago(health.ageSeconds ?? 0)} old (late after ${ago(health.staleAfterSeconds)})`
        : `no successful backup yet, ${ago(health.staleAfterSeconds)} after starting`,
      "warn",
    );
}

async function daemon(s: Settings) {
  for (const tool of [
    ["pg_dump", "--version"],
    ["tar", "--version"],
    ...(s.remote ? [["rclone", "version"]] : []),
    ...(s.encryption.method === "age" ? [["age", "--version"]] : []),
    ...(s.encryption.method === "gpg" ? [["gpg", "--version"]] : []),
  ] as [string, string][])
    await run({ cmd: tool[0], args: [tool[1]] });
  await writeStatus(s, { startedAt: new Date().toISOString() });
  log(
    `schedule "${s.schedule.source}" (${process.env.TZ || "UTC"}), to ${targetLabels(s).join(" and ") || "nowhere"}, encryption ${s.encryption.method}, keeping ${s.retention.daily} daily, ${s.retention.weekly} weekly, ${s.retention.monthly} monthly`,
  );
  if (!s.remote)
    log(
      "no BACKUP_REMOTE: backups stay on this machine and are lost with it. Add an off-site target.",
      "warn",
    );
  if (s.encryption.method === "none")
    log("backups are not encrypted: set BACKUP_AGE_RECIPIENTS (recommended) or BACKUP_PASSPHRASE", "warn");

  const once = async () => {
    try {
      await backupNow(s);
    } catch (error) {
      log(`backup failed: ${message(error)}`, "error");
    }
  };
  if (s.runOnStart) await once();
  // The late check runs hourly and after every run; the next run is worked out after each one, so
  // a long backup never piles up behind itself.
  setInterval(() => void warnIfLate(s).catch(() => {}), 3_600_000).unref();
  for (;;) {
    const next = nextRun(s.schedule, new Date());
    log(`next backup ${next.toISOString()}`);
    // setTimeout cannot wait more than about 24.8 days in one go.
    while (Date.now() < next.getTime())
      await new Promise((resolve) => setTimeout(resolve, Math.min(next.getTime() - Date.now(), 2 ** 31 - 1)));
    await once();
    await warnIfLate(s);
  }
}

async function main(argv: string[]) {
  const [command = "daemon", ...rest] = argv;
  const option = (name: string) => rest.includes(name);
  const argument = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage);
    return 0;
  }
  const s = settings();
  switch (command) {
    case "daemon":
      await daemon(s);
      return 0;
    case "run":
      await backupNow(s);
      return 0;
    case "prune":
      await prune(s);
      return 0;
    case "status":
      return status(s, option("--quiet"));
    case "list": {
      for (const { target, backups } of await listBackups(s)) {
        console.log(`${target.label}:`);
        if (!backups.length) console.log("  (none)");
        for (const b of backups)
          console.log(`  ${b.name}  ${mb(b.bytes).padStart(10)}${b.complete ? "" : "  unfinished"}`);
      }
      return 0;
    }
    case "verify":
    case "restore": {
      const name = rest.find((arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--from");
      if (!name) {
        console.error(usage);
        return 2;
      }
      const from = argument("--from");
      await restore(s, {
        name,
        ...(from ? { from } : {}),
        force: option("--force"),
        skipFiles: option("--skip-files"),
        verifyOnly: command === "verify",
      });
      if (command === "verify") log(`${name} is intact`);
      return 0;
    }
    default:
      console.error(usage);
      return 2;
  }
}

// An rclone setting left empty in .env would override the same one in a mounted rclone.conf.
for (const key of Object.keys(process.env))
  if (key.startsWith("RCLONE_CONFIG_") && process.env[key] === "") delete process.env[key];

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    log(message(error), "error");
    process.exit(1);
  },
);

process.on("SIGTERM", () => process.exit(0));
