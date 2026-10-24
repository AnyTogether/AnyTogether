import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./index.js";

/** Applies the SQL migrations in ../drizzle; run before the API starts. */
export async function runMigrations(url: string) {
  const { db, client } = connect(url, 1);
  await client`create extension if not exists citext`;
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  await client.end();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations(process.env.DATABASE_URL ?? "postgres://anytogether:anytogether@127.0.0.1:54329/anytogether");
}
