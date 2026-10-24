import { runMigrations } from "@anytogether/db/migrate";
import postgres from "postgres";

/** A database of its own for the tests, migrated afresh each run. */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://anytogether:anytogether@127.0.0.1:54329/anytogether_test";

export default async function setup() {
  const url = new URL(testDatabaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  await runMigrations(testDatabaseUrl);
}
