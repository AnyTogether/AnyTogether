/** The moderators' tools, run where the API runs (it uses the API's own DATABASE_URL and VALKEY_URL):
 *
 *   pnpm --filter @anytogether/api admin reports [--all]
 *   pnpm --filter @anytogether/api admin report <id> dismiss|action
 *   pnpm --filter @anytogether/api admin ban <@handle|email|id> [--days 7] [--reason "spam"]
 *   pnpm --filter @anytogether/api admin unban <@handle|email|id>
 *   pnpm --filter @anytogether/api admin user <@handle|email|id>
 *   pnpm --filter @anytogether/api admin purge
 *
 * In the API's container: node dist/admin.js <the same>. */
import { connect } from "@anytogether/db";
import { Redis } from "ioredis";
import { purgeDeletedAccounts } from "./account.js";
import { config } from "./config.js";
import { ban, findAccount, handleReport, isBanned, listReports, unban } from "./moderation.js";

const usage = `usage: admin reports [--all]
       admin report <id> dismiss|action
       admin ban <@handle|email|id> [--days N] [--reason text]
       admin unban <@handle|email|id>
       admin user <@handle|email|id>
       admin purge`;

/** Runs one command and returns what to print; the tests call it directly. */
export async function run(args: string[], ctx: Parameters<typeof ban>[0]): Promise<string> {
  const [command, target, ...rest] = args;
  const option = (name: string) => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const by = process.env.USER ?? "admin";
  switch (command) {
    case "reports": {
      const rows = await listReports(ctx.db, target === "--all");
      if (!rows.length) return "no open reports";
      return rows
        .map((r) => {
          const said = (r.snapshot as { text?: string } | null)?.text;
          return (
            `${r.id}  ${r.createdAt.toISOString().slice(0, 16)}  ${r.status}  ${r.reason}\n` +
            `  ${r.targetKind} ${r.target ? `@${r.target}` : r.targetId} (reported ${r.timesReported}×)` +
            ` by ${r.reporter ? `@${r.reporter}` : "a deleted account"}${r.note ? `\n  “${r.note}”` : ""}` +
            `${r.targetKind === "message" ? `\n  said: “${said ?? ""}”` : ""}`
          );
        })
        .join("\n");
    }
    case "report": {
      const verdict = rest[0] === "action" ? "actioned" : rest[0] === "dismiss" ? "dismissed" : null;
      if (!target || !verdict) return usage;
      await handleReport(ctx.db, target, verdict, by);
      return `report ${target} ${verdict}`;
    }
    case "ban": {
      if (!target) return usage;
      const days = option("days") ? Number(option("days")) : undefined;
      if (days !== undefined && !(days > 0)) return "--days needs a positive number";
      const done = await ban(ctx, target, { reason: option("reason"), days, by });
      return `banned ${done.handle ? `@${done.handle}` : target}${done.expiresAt ? ` until ${done.expiresAt.toISOString()}` : ""}; every session signed out`;
    }
    case "unban": {
      if (!target) return usage;
      return `lifted ${await unban(ctx, target, by)} ban(s) on ${target}`;
    }
    case "user": {
      if (!target) return usage;
      const found = await findAccount(ctx.db, target);
      if (!found) return `no account for ${target}`;
      const { account, profile } = found;
      return [
        `${account.id}  @${profile?.handle ?? "?"}  ${profile?.displayName ?? ""}`,
        `email ${account.email ?? "none"}  role ${account.role}  status ${account.status}`,
        `created ${account.createdAt.toISOString()}${account.deleteAfter ? `  deleted after ${account.deleteAfter.toISOString()}` : ""}`,
        `banned now: ${await isBanned(ctx.db, { accountId: account.id, email: account.email })}`,
      ].join("\n");
    }
    case "purge":
      return `deleted ${await purgeDeletedAccounts(ctx)} account(s)`;
    default:
      return usage;
  }
}

if (process.argv[1] && /admin\.(ts|js)$/.test(process.argv[1])) {
  const settings = config();
  const { db, client } = connect(settings.databaseUrl, 2);
  const valkey = new Redis(settings.valkeyUrl);
  try {
    console.log(await run(process.argv.slice(2), { db, valkey }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
    valkey.disconnect();
  }
}
