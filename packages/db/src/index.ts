import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Database = ReturnType<typeof connect>["db"];

/** A pool to PostgreSQL and the typed query builder over it. */
export function connect(url: string, max = 10) {
  const client = postgres(url, { max, onnotice: () => {} });
  return { db: drizzle(client, { schema, casing: "snake_case" }), client };
}
