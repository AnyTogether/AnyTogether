import postgres from "postgres";
import journal from "../../../packages/db/drizzle/meta/_journal.json" with { type: "json" };

/** The migrations this build knows, oldest first (packages/db/drizzle). */
export const knownMigrations: { tag: string; when: number }[] = journal.entries.map((entry) => ({
  tag: entry.tag,
  when: entry.when,
}));

export interface DatabaseInfo {
  server: string;
  /** Applied migrations, and the newest one's name (by its time in the journal). */
  migrations: { count: number; latest: string | null };
  accounts: number | null;
}

const connect = (url: string) => postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 15 });

async function tableExists(sql: postgres.Sql, schema: string, table: string) {
  const [row] = await sql<{ found: boolean }[]>`
    select exists (select 1 from information_schema.tables
                   where table_schema = ${schema} and table_name = ${table}) as found`;
  return row?.found ?? false;
}

/** What the manifest records about the database, and what a restore checks first. */
export async function databaseInfo(url: string): Promise<DatabaseInfo> {
  const sql = connect(url);
  try {
    const [{ version } = { version: "" }] = await sql<{ version: string }[]>`select version()`;
    let migrations: DatabaseInfo["migrations"] = { count: 0, latest: null };
    if (await tableExists(sql, "drizzle", "__drizzle_migrations")) {
      const rows = await sql<{ created_at: string }[]>`
        select created_at from drizzle.__drizzle_migrations order by created_at`;
      const newest = Number(rows.at(-1)?.created_at);
      migrations = {
        count: rows.length,
        latest:
          knownMigrations.find((m) => m.when === newest)?.tag ??
          (rows.length ? `${rows.length} migrations (newer than this backup tool)` : null),
      };
    }
    let accounts: number | null = null;
    if (await tableExists(sql, "public", "accounts")) {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from accounts`;
      accounts = row?.n ?? 0;
    }
    return { server: version.split(" on ")[0] ?? version, migrations, accounts };
  } finally {
    await sql.end();
  }
}

/** Empties the database for a restore: AnyTogether's schemas go, with everything in them. */
export async function resetDatabase(url: string) {
  const sql = connect(url);
  try {
    await sql.unsafe(
      "drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;",
    );
  } finally {
    await sql.end();
  }
}
