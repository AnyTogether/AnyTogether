import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Who signs in. No passwords: every way in is a provider or an email code. */
export const accounts = pgTable("accounts", {
  id: uuid().primaryKey(),
  email: citext().unique(),
  role: text().notNull().default("user"),
  status: text().notNull().default("active"),
  deleteAfter: timestamp({ withTimezone: true }),
  createdAt: now(),
});

/** The ways into an account: apple, google, discord, email (subject = the address). */
export const identities = pgTable(
  "identities",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    subject: text().notNull(),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.subject] }), index().on(table.accountId)],
);

/** A signed-in device; the refresh token is kept only as a hash and rotates on every use. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    client: text().notNull(),
    deviceName: text(),
    refreshHash: bytea().notNull(),
    previousHash: bytea(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId), index().on(table.refreshHash), index().on(table.previousHash)],
);

/** Short-lived sign-in requests: email codes, hand-offs to the phone, device codes. */
export const signInRequests = pgTable(
  "sign_in_requests",
  {
    id: uuid().primaryKey(),
    kind: text().notNull(),
    email: citext(),
    codeHash: bytea(),
    linkHash: bytea(),
    secretHash: bytea(),
    userCode: text().unique(),
    client: text(),
    deviceName: text(),
    approvedBy: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    attempts: integer().notNull().default(0),
    lastPolledAt: timestamp({ withTimezone: true }),
    consumedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (table) => [index().on(table.email), check("kind", sql`${table.kind} in ('email', 'handoff', 'device')`)],
);

export const profiles = pgTable(
  "profiles",
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    handle: citext().notNull().unique(),
    handleChangedAt: timestamp({ withTimezone: true }),
    displayName: text().notNull(),
    bio: text(),
    country: text(),
    avatarUrl: text(),
    privacy: jsonb().notNull().default({}),
    stats: jsonb().notNull().default({}),
  },
  (table) => [check("bio_length", sql`length(${table.bio}) <= 160`)],
);

/** A user's computers, by the launcher's own random ID. */
export const devices = pgTable(
  "devices",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    platform: text().notNull(),
    name: text().notNull(),
    model: text(),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (table) => [index().on(table.accountId)],
);

export const auditLog = pgTable("audit_log", {
  id: uuid().primaryKey(),
  actorId: uuid(),
  action: text().notNull(),
  target: text(),
  data: jsonb(),
  createdAt: now(),
});

/** One row per pair (userA < userB): pending until the other accepts. */
export const friendships = pgTable(
  "friendships",
  {
    userA: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userB: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    state: text().notNull(),
    askedBy: uuid().notNull(),
    createdAt: now(),
    acceptedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userA, table.userB] }),
    index().on(table.userB),
    check("ordered", sql`${table.userA} < ${table.userB}`),
    check("state", sql`${table.state} in ('pending', 'accepted')`),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    blocker: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    blocked: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.blocker, table.blocked] })],
);
