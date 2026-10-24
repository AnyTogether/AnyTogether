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
  uniqueIndex,
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

/** Passkeys (WebAuthn discoverable credentials): a way in with no email, at most 10 per account.
 *  The authenticator's own ID is the key; the public key is COSE, as the browser sent it. */
export const passkeys = pgTable(
  "passkeys",
  {
    id: text().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text().notNull(),
    publicKey: bytea().notNull(),
    /** The signature counter; most synced passkeys always send 0. */
    counter: bigint({ mode: "number" }).notNull().default(0),
    transports: jsonb().$type<string[]>().notNull().default([]),
    /** singleDevice or multiDevice (synced, e.g. iCloud Keychain or Google Password Manager). */
    deviceType: text().notNull(),
    backedUp: boolean().notNull().default(false),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId), check("passkey_name", sql`length(${table.name}) <= 60`)],
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
    /** Which notifications to get, each kind on or off, and the mail digest (see
     *  notificationSettingsOf); only what was changed is stored. */
    notificationSettings: jsonb().notNull().default({}),
    stats: jsonb().notNull().default({}),
  },
  (table) => [check("bio_length", sql`length(${table.bio}) <= 160`)],
);

/** Handles given up, held for their last owner for 30 days: nobody else takes them, and the old
 *  handle still leads to the profile. */
export const handleHistory = pgTable(
  "handle_history",
  {
    handle: citext().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    releasedAt: now(),
  },
  (table) => [index().on(table.accountId)],
);

/** Uploaded avatars, re-encoded to a 256 px JPEG without metadata, served by the hash of their
 *  bytes; only the account's current one is kept. */
export const avatars = pgTable(
  "avatars",
  {
    hash: text().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    bytes: bytea().notNull(),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId)],
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

/** Reports from users to the moderators: on a person now, on messages and more later. */
export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey(),
    reporterId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** user or message (later activity, theme, game_name). */
    targetKind: text().notNull(),
    targetId: text().notNull(),
    reason: text().notNull(),
    note: text(),
    /** What a reported message said when it was reported, kept for the moderators even if its
     *  author deletes it: {authorId, conversationId, seq, text, createdAt}. */
    snapshot: jsonb(),
    /** open | actioned | dismissed */
    status: text().notNull().default("open"),
    handledBy: text(),
    handledAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    index().on(table.status, table.createdAt),
    index().on(table.targetKind, table.targetId),
    uniqueIndex("one_open_report")
      .on(table.reporterId, table.targetKind, table.targetId)
      .where(sql`${table.status} = 'open'`),
    check("report_status", sql`${table.status} in ('open', 'actioned', 'dismissed')`),
    check("report_note", sql`length(${table.note}) <= 500`),
  ],
);

/** Bans on an account, on an email address (kept only as its SHA-256), or both; a ban without an
 *  end lasts until lifted. */
export const bans = pgTable(
  "bans",
  {
    id: uuid().primaryKey(),
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    emailHash: bytea(),
    reason: text(),
    createdBy: text(),
    expiresAt: timestamp({ withTimezone: true }),
    liftedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId), index().on(table.emailHash)],
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
  (table) => [
    primaryKey({ columns: [table.accountId, table.titleId] }),
    index().on(table.titleId),
    // Per game leaderboards.
    index("library_by_points").on(table.titleId, table.points.desc()),
    index("library_by_time").on(table.titleId, table.secondsPlayed.desc()),
  ],
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
    // Who has flagged trophies, kept off global leaderboards.
    index("earned_flagged")
      .on(table.accountId, table.titleId)
      .where(sql`${table.flagged}`),
  ],
);

/** The activity feed: what someone did, written when it happened. Who may read an item is worked
 *  out when it is read, from the actor's privacy setting for `section` (and, for a friendship,
 *  the new friend's too). */
export const activities = pgTable(
  "activities",
  {
    /** UUIDv7, so the newest has the largest ID; the feed pages by it. */
    id: uuid().primaryKey(),
    actorId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** trophy | platinum | first_play | long_session | friendship | milestone */
    kind: text().notNull(),
    /** library | trophies | friends: the privacy setting that decides who sees it. */
    section: text().notNull(),
    titleId: text().references(() => games.titleId),
    /** The new friend of a friendship item. */
    subjectId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    /** trophy, platinum: {setHash, trophies: [{id, grade}], count}; long_session, first_play:
     *  {seconds}; milestone: {kind, value}. */
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index("activities_actor").on(table.actorId, table.id.desc()),
    index().on(table.subjectId),
    check(
      "activity_kind",
      sql`${table.kind} in ('trophy', 'platinum', 'first_play', 'long_session', 'friendship', 'milestone')`,
    ),
    check("activity_section", sql`${table.section} in ('library', 'trophies', 'friends')`),
  ],
);

/** One of the fixed reactions per person per item. */
export const activityReactions = pgTable(
  "activity_reactions",
  {
    activityId: uuid()
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    reaction: text().notNull(),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.accountId] }),
    index().on(table.accountId),
    check("reaction", sql`${table.reaction} in ('fire', 'clap', 'wow', 'heart')`),
  ],
);

/** A direct conversation (two friends, made once: direct_key is "smaller:larger" user ID) or a group. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey(),
    kind: text().notNull(),
    title: text(),
    directKey: text().unique(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** The newest message's seq; a message takes last_seq + 1 in the same transaction. */
    lastSeq: bigint({ mode: "number" }).notNull().default(0),
    createdAt: now(),
    /** The last message or change, for ordering the list. */
    updatedAt: now(),
  },
  (table) => [
    check("kind", sql`${table.kind} in ('direct', 'group')`),
    check("direct_key", sql`(${table.kind} = 'direct') = (${table.directKey} is not null)`),
  ],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    readSeq: bigint({ mode: "number" }).notNull().default(0),
    muted: boolean().notNull().default(false),
    joinedAt: now(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.accountId] }), index().on(table.accountId)],
);

/** Text only for now; attachments stays an empty list until uploads exist. A deleted message is
 *  emptied at once and keeps only its place. */
export const messages = pgTable(
  "messages",
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: bigint({ mode: "number" }).notNull(),
    /** The client's UUID, so a resent message is stored once. */
    id: uuid().notNull().unique(),
    authorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    text: text(),
    attachments: jsonb().notNull().default([]),
    replyTo: bigint({ mode: "number" }),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.seq] }),
    check("text_length", sql`length(${table.text}) <= 4000`),
  ],
);

/** A group that plays and talks together, at most eight people; the leader may kick and hand over. */
export const parties = pgTable(
  "parties",
  {
    id: uuid().primaryKey(),
    leaderId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    privacy: text().notNull().default("invite"),
    createdAt: now(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [check("privacy", sql`${table.privacy} in ('invite', 'friends')`)],
);

/** Someone is in at most one party at a time. */
export const partyMembers = pgTable(
  "party_members",
  {
    partyId: uuid()
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" })
      .unique(),
    joinedAt: now(),
  },
  (table) => [primaryKey({ columns: [table.partyId, table.accountId] })],
);

export const partyInvites = pgTable(
  "party_invites",
  {
    partyId: uuid()
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    invitedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.partyId, table.accountId] }), index().on(table.accountId)],
);

/** Set up by the API; the media itself goes peer to peer and is never seen by the server. Who may
 *  signal and who is in the call now live in Valkey. */
export const calls = pgTable(
  "calls",
  {
    id: uuid().primaryKey(),
    partyId: uuid().references(() => parties.id, { onDelete: "set null" }),
    startedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** The person called, for a call between two friends. */
    calleeId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    startedAt: now(),
    answeredAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("one_call_per_party").on(table.partyId).where(sql`${table.endedAt} is null`),
    index().on(table.calleeId),
  ],
);

/** A game a launcher hosts for friends to join; one open session per host. What `properties`
 *  holds is up to the launchers. */
export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid().primaryKey(),
    hostId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    gameVersion: text().notNull(),
    engineBuild: text().notNull(),
    capacity: integer().notNull(),
    joinable: boolean().notNull().default(true),
    properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: now(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("one_open_session_per_host").on(table.hostId).where(sql`${table.endedAt} is null`),
    check("capacity", sql`${table.capacity} between 2 and 16`),
  ],
);

/** Who is in a session now, the host included; someone plays in one session at a time. */
export const gameSessionPlayers = pgTable(
  "game_session_players",
  {
    sessionId: uuid()
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" })
      .unique(),
    joinedAt: now(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.accountId] })],
);

export const gameSessionInvites = pgTable(
  "game_session_invites",
  {
    sessionId: uuid()
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    invitedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.accountId] }), index().on(table.accountId)],
);

/** What happened to someone while they looked away: a friend request, a missed call, messages.
 *  Messages gather in one unread notification per conversation. */
export const notifications = pgTable(
  "notifications",
  {
    /** UUIDv7, so the newest has the largest ID; the list pages by it. */
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** friend_request | friend_accepted | message | party_invite | game_invite | missed_call | warning */
    kind: text().notNull(),
    actorId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    /** What it is about: the conversation, party, game session or call; for a friend request or
     *  acceptance the other person; for a warning its own ID. */
    subjectId: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp({ withTimezone: true }),
    /** Put in a mail digest; a notification is mailed at most once. */
    mailedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index("notifications_by_account").on(table.accountId, table.id.desc()),
    index("notifications_unread").on(table.accountId).where(sql`${table.readAt} is null`),
    // One unread notification per kind and subject: more messages gather into it.
    uniqueIndex("one_unread_notification")
      .on(table.accountId, table.kind, table.subjectId)
      .where(sql`${table.readAt} is null`),
    check(
      "notification_kind",
      sql`${table.kind} in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'warning')`,
    ),
  ],
);

/** Web Push subscriptions, one per browser, tied to its sign-in: signing out ends it. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    /** The language the device shows its notifications in: en or tr. */
    lang: text().notNull().default("en"),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId), index().on(table.sessionId)],
);
