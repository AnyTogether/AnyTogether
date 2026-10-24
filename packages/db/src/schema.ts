import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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

/** The catalogue, one row per title ID, taught by the first launcher that has the game. A row with
 *  no names yet is a stub, made when a session or trophy set arrives before the game was taught. */
export const games = pgTable(
  "games",
  {
    titleId: text().primaryKey(),
    names: jsonb().$type<Record<string, string>>().notNull().default({}),
    iconUrl: text(),
    taughtBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** A moderator fixed it; launchers cannot change it. */
    locked: boolean().notNull().default(false),
    createdAt: now(),
  },
  (table) => [check("title_id", sql`${table.titleId} ~ '^[A-Z]{4}[0-9]{5}$'`)],
);

/** A stretch of play on one computer; the ID comes from the launcher, so a resent batch is ignored. */
export const playSessions = pgTable(
  "play_sessions",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    deviceId: uuid().references(() => devices.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }).notNull(),
    /** normal | crashed | killed, the launcher's diagnosis. */
    exit: text(),
    createdAt: now(),
  },
  (table) => [
    index().on(table.accountId, table.titleId, table.startedAt.desc()),
    check("ended_after_started", sql`${table.endedAt} > ${table.startedAt}`),
  ],
);

/** Per user per game, worked out again from sessions and trophies whenever either arrives. */
export const library = pgTable(
  "library",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    firstPlayedAt: timestamp({ withTimezone: true }),
    lastPlayedAt: timestamp({ withTimezone: true }),
    secondsPlayed: bigint({ mode: "number" }).notNull().default(0),
    trophiesEarned: integer().notNull().default(0),
    trophiesTotal: integer(),
    /** Bronze 15, silver 30, gold 90, platinum 300. */
    points: integer().notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.titleId] }), index().on(table.titleId)],
);

/** A game's trophy set by the hash of its trophy file; another version is kept beside it. */
export const trophySets = pgTable(
  "trophy_sets",
  {
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    setHash: text().notNull(),
    taughtBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.titleId, table.setHash] })],
);

export const trophies = pgTable(
  "trophies",
  {
    titleId: text().notNull(),
    setHash: text().notNull(),
    trophyId: integer().notNull(),
    grade: text().notNull(),
    hidden: boolean().notNull().default(false),
    /** {"en": {"name": ..., "detail": ...}, "tr": ...} */
    texts: jsonb().$type<Record<string, { name: string; detail?: string }>>().notNull(),
    earnedCount: integer().notNull().default(0),
    /** earned_count / players of the game, 0..1. */
    rarity: real(),
  },
  (table) => [
    primaryKey({ columns: [table.titleId, table.setHash, table.trophyId] }),
    foreignKey({
      columns: [table.titleId, table.setHash],
      foreignColumns: [trophySets.titleId, trophySets.setHash],
    }),
    check("grade", sql`${table.grade} in ('bronze', 'silver', 'gold', 'platinum')`),
  ],
);

export const earnedTrophies = pgTable(
  "earned_trophies",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text().notNull(),
    setHash: text().notNull(),
    trophyId: integer().notNull(),
    earnedAt: timestamp({ withTimezone: true }).notNull(),
    /** Impossible patterns, kept off leaderboards until a moderator looks. */
    flagged: boolean().notNull().default(false),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.titleId, table.trophyId] }),
    foreignKey({
      columns: [table.titleId, table.setHash, table.trophyId],
      foreignColumns: [trophies.titleId, trophies.setHash, trophies.trophyId],
    }),
    index("earned_by_game").on(table.titleId, table.trophyId),
    index().on(table.accountId, table.earnedAt.desc()),
  ],
);
