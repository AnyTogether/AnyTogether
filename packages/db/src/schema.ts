import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
    /** Shown in discovery (players of a game, suggestions, game hubs); null follows the library
     *  setting: on while the library is public. */
    discoverable: boolean(),
    /** Languages the person plays in (ISO 639-1), at most five. */
    languages: jsonb().$type<string[]>().notNull().default([]),
    /** What the handle looks like (handleSkeleton): no two people have look-alike handles. Null
     *  for the later of two handles that already looked alike before this was checked. */
    handleSkeleton: text(),
    /** All trophy points (the sum over the library) and the trophy level they make, kept up to
     *  date as trophies arrive. */
    trophyPoints: integer().notNull().default(0),
    trophyLevel: integer().notNull().default(1),
    /** Pinned on the profile: {trophies: [{titleId, trophyId}], games: [titleId]}. */
    showcase: jsonb()
      .$type<{ trophies?: { titleId: string; trophyId: number }[]; games?: string[] }>()
      .notNull()
      .default({}),
    /** "preset:<id>" (a cover the server draws) or "game:<titleId>" (the game's artwork). */
    cover: text(),
    /** One of the launcher's accents. */
    accent: text(),
    /** Players met in parties, share plays, game sessions and posts are remembered. */
    rememberMet: boolean().notNull().default(true),
    /** Appear offline: signed in and working, but friends and everyone else see the account as
     *  offline (with privacy's presence "nobody", the gateway keeps its presence to itself). */
    appearOffline: boolean().notNull().default(false),
    /** Read receipts: others in a conversation see how far this person has read, and this person
     *  sees theirs. Off hides both ways; delivered marks and one's own unread counts stay. */
    readReceipts: boolean().notNull().default(true),
  },
  (table) => [
    check("bio_length", sql`length(${table.bio}) <= 160`),
    uniqueIndex("profiles_handle_skeleton").on(table.handleSkeleton),
    index("profiles_by_level").on(table.trophyLevel.desc()),
  ],
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
    /** handleSkeleton of the handle: a look-alike of a held handle is not given out either. */
    skeleton: text(),
  },
  (table) => [index().on(table.accountId), index().on(table.skeleton)],
);

/** Accounts elsewhere linked to the profile (Steam, Discord), shown as badges with their name
 *  unless hidden. Only who they are is kept: never a token. One AnyTogether account per outside
 *  account. */
export const connections = pgTable(
  "connections",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** steam | discord */
    provider: text().notNull(),
    /** The SteamID64, or the Discord user ID. */
    externalId: text().notNull(),
    /** The persona name (Steam) or display name (Discord) when linked; null when unknown. */
    name: text(),
    /** Discord's unique username. */
    username: text(),
    hidden: boolean().notNull().default(false),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.provider] }),
    uniqueIndex("one_account_per_connection").on(table.provider, table.externalId),
    check("connection_provider", sql`${table.provider} in ('steam', 'discord')`),
  ],
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

/** Restrictions on an account: bans (on an account, on an email address kept only as its
 *  SHA-256, or both) and mutes (an account only; it may sign in but not write to others). One
 *  without an end lasts until lifted. */
export const bans = pgTable(
  "bans",
  {
    id: uuid().primaryKey(),
    /** ban | mute */
    kind: text().notNull().default("ban"),
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    emailHash: bytea(),
    /** The moderators' own note. */
    reason: text(),
    /** What the person is told about why (on the website, the launcher and the phone). */
    publicReason: text(),
    createdBy: text(),
    expiresAt: timestamp({ withTimezone: true }),
    liftedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    index().on(table.accountId),
    index().on(table.emailHash),
    check("ban_kind", sql`${table.kind} in ('ban', 'mute')`),
    check("ban_public_reason", sql`length(${table.publicReason}) <= 300`),
  ],
);

/** Someone asking the moderators to lift a restriction: one open at a time per account. */
export const appeals = pgTable(
  "appeals",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The restriction asked about (gone when it is). */
    banId: uuid().references(() => bans.id, { onDelete: "set null" }),
    text: text().notNull(),
    /** open | accepted | declined */
    status: text().notNull().default("open"),
    /** The moderator's answer, shown to the person. */
    reply: text(),
    handledBy: text(),
    handledAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    index().on(table.accountId, table.createdAt.desc()),
    index().on(table.status, table.createdAt),
    uniqueIndex("one_open_appeal").on(table.accountId).where(sql`${table.status} = 'open'`),
    check("appeal_status", sql`${table.status} in ('open', 'accepted', 'declined')`),
    check("appeal_text", sql`length(${table.text}) between 1 and 2000`),
    check("appeal_reply", sql`length(${table.reply}) <= 1000`),
  ],
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
    /** Age ratings from the game's param.json (`ageLevel`), by region with "default"; null until a
     *  launcher reports them. */
    ageLevels: jsonb().$type<Record<string, number>>(),
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
      sql`${table.kind} in ('trophy', 'platinum', 'first_play', 'long_session', 'friendship', 'milestone', 'level_up')`,
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
    /** A community's chat: its members are the community's, kept in step by the API. */
    communityId: uuid()
      .unique()
      .references((): AnyPgColumn => communities.id, { onDelete: "cascade" }),
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
    /** The newest message one of this member's devices has fetched or acknowledged; never below
     *  read_seq once read. Shown to the other person of a direct conversation as "delivered". */
    deliveredSeq: bigint({ mode: "number" }).notNull().default(0),
    muted: boolean().notNull().default(false),
    /** Pinned to the top of this member's list (at most five); null when not pinned. */
    pinnedAt: timestamp({ withTimezone: true }),
    joinedAt: now(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.accountId] }), index().on(table.accountId)],
);

/** Text, or one piece of the author's media: attachments is [{mediaId, kind}] (resolved to the
 *  media, or "removed", when read) and text is then the caption. A deleted message is emptied at
 *  once and keeps only its place. */
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
    /** How many times its author edited it (at most maxMessageEdits). */
    editCount: integer().notNull().default(0),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.seq] }),
    check("text_length", sql`length(${table.text}) <= 4000`),
  ],
);

/** One of the fixed reactions (see messageReactions) per person per message, toggled; several
 *  different ones per person are fine. Gone with the message's unsend or removal. */
export const messageReactions = pgTable(
  "message_reactions",
  {
    conversationId: uuid().notNull(),
    seq: bigint({ mode: "number" }).notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    reaction: text().notNull(),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.seq, table.accountId, table.reaction] }),
    foreignKey({
      columns: [table.conversationId, table.seq],
      foreignColumns: [messages.conversationId, messages.seq],
    }).onDelete("cascade"),
    index().on(table.accountId),
    check("reaction", sql`${table.reaction} in ('like', 'love', 'laugh', 'wow', 'sad', 'fire', 'gg')`),
  ],
);

/** A group that plays and talks together, at most eight people; the leader may kick and hand over. */
export const parties = pgTable(
  "parties",
  {
    id: uuid().primaryKey(),
    leaderId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    privacy: text().notNull().default("invite"),
    /** Listed in public: request (others ask the leader) or open (anyone walks in); null when not
     *  listed. */
    publicJoin: text(),
    /** The game and language it is listed with. */
    titleId: text().references(() => games.titleId),
    language: text(),
    listedAt: timestamp({ withTimezone: true }),
    /** The party's Discord server or channel (a discord.gg or discord.com link), as the leader
     *  set it. */
    discordUrl: text(),
    createdAt: now(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check("privacy", sql`${table.privacy} in ('invite', 'friends')`),
    check("party_public_join", sql`${table.publicJoin} in ('request', 'open')`),
    index("parties_listed")
      .on(table.listedAt.desc())
      .where(sql`${table.publicJoin} is not null and ${table.endedAt} is null`),
  ],
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

/** People asking to join a party listed in public, or with its join code; the leader lets them
 *  in with an invite. */
export const partyRequests = pgTable(
  "party_requests",
  {
    partyId: uuid()
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.partyId, table.accountId] }), index().on(table.accountId)],
);

/** Short codes a party leader or share play host hands out so people who are not friends can ask
 *  to join (a share play lives in Valkey, so the target is no foreign key). A code works until it
 *  runs out, is revoked or replaced, or what it opens ends. */
export const joinCodes = pgTable(
  "join_codes",
  {
    code: text().primaryKey(),
    /** party | share_play | game_session */
    kind: text().notNull(),
    targetId: uuid().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: now(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check("join_code_kind", sql`${table.kind} in ('party', 'share_play', 'game_session')`),
    index("join_codes_target").on(table.kind, table.targetId).where(sql`${table.revokedAt} is null`),
  ],
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

/** A game a launcher hosts for friends to join; one open session per host, one Play Together
 *  (lan) session per party. What `properties` holds is up to the launchers. */
export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid().primaryKey(),
    hostId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** online | lan (Play Together: the party's, ends with its host) | local (one screen) */
    kind: text().notNull().default("online"),
    /** The party a lan session belongs to. */
    partyId: uuid().references(() => parties.id, { onDelete: "set null" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    gameVersion: text().notNull(),
    engineBuild: text().notNull(),
    /** exact | major | any: how far a joiner's game version may be from the host's. */
    versionRule: text().notNull().default("exact"),
    capacity: integer().notNull(),
    joinable: boolean().notNull().default(true),
    properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: now(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("one_open_session_per_host").on(table.hostId).where(sql`${table.endedAt} is null`),
    uniqueIndex("one_lan_session_per_party")
      .on(table.partyId)
      .where(sql`${table.endedAt} is null and ${table.kind} = 'lan'`),
    check("capacity", sql`${table.capacity} between 2 and 16`),
    check("game_session_kind", sql`${table.kind} in ('online', 'lan', 'local')`),
    check("game_session_version_rule", sql`${table.versionRule} in ('exact', 'major', 'any')`),
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
    /** friend_request | friend_accepted | message | party_invite | game_invite | missed_call |
     *  lfg_request | lfg_accepted | warning | family_invite | family_request | family_answer |
     *  family_alert | family_summary | appeal (a moderator answered an appeal) */
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
      sql`${table.kind} in ('friend_request', 'friend_accepted', 'message', 'party_invite', 'game_invite', 'missed_call', 'lfg_request', 'lfg_accepted', 'warning', 'family_invite', 'family_request', 'family_answer', 'family_alert', 'family_summary', 'appeal', 'level_up', 'community_invite', 'event_reminder', 'event_started')`,
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

/** Files kept in PostgreSQL by the default blob store (theme files and their stills), in pieces
 *  of at most 1 MiB so none is read into memory whole. */
export const blobs = pgTable(
  "blobs",
  {
    key: text().notNull(),
    part: integer().notNull(),
    bytes: bytea().notNull(),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.key, table.part] })],
);

/** The Theme Hub: themes made in the launcher's Theme Studio and shared. The file, as the Hub
 *  repacked it, and its stills live in the blob store under themes/<id>/v<version>/. */
export const themes = pgTable(
  "themes",
  {
    id: uuid().primaryKey(),
    makerId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    /** The id theme.json had when it was first shared, so the maker's next upload of the same
     *  theme is known as a new version. */
    sourceId: text(),
    name: text().notNull(),
    description: text(),
    /** published | review | hidden */
    status: text().notNull().default("published"),
    version: integer().notNull().default(1),
    style: integer().notNull().default(0),
    colors: jsonb().$type<{ deep: string; middle: string; bright: string; accent: string }>().notNull(),
    /** theme.json as it is in the file people download. */
    design: jsonb().$type<Record<string, unknown>>().notNull(),
    /** picture | video, or none. */
    background: text(),
    music: boolean().notNull().default(false),
    size: integer().notNull(),
    sha256: text().notNull(),
    downloads: integer().notNull().default(0),
    likes: integer().notNull().default(0),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index().on(table.makerId),
    index("themes_new").on(table.status, table.createdAt.desc()),
    index("themes_popular").on(table.status, table.downloads.desc()),
    index("themes_liked").on(table.status, table.likes.desc()),
    uniqueIndex("theme_source").on(table.makerId, table.sourceId),
    check("theme_status", sql`${table.status} in ('published', 'review', 'hidden')`),
    check("theme_background", sql`${table.background} in ('picture', 'video')`),
    check("theme_name", sql`length(${table.name}) <= 60`),
    check("theme_description", sql`length(${table.description}) <= 500`),
  ],
);

export const themeLikes = pgTable(
  "theme_likes",
  {
    themeId: uuid()
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.themeId, table.accountId] }), index().on(table.accountId)],
);

/** How a game runs, as players report it from the launcher (opt-in) or the website. Kept, without
 *  who sent it, when the account is deleted. */
export const compatReports = pgTable(
  "compat_reports",
  {
    id: uuid().primaryKey(),
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    /** macos | windows | linux */
    platform: text().notNull(),
    /** nothing | boots | menus | ingame | playable */
    status: text().notNull(),
    launcherVersion: text().notNull(),
    engineVersion: text(),
    gameVersion: text(),
    machine: text(),
    os: text(),
    fpsAvg: real(),
    note: text(),
    createdAt: now(),
  },
  (table) => [
    index().on(table.titleId, table.platform, table.createdAt.desc()),
    index().on(table.accountId),
    check("compat_platform", sql`${table.platform} in ('macos', 'windows', 'linux')`),
    check("compat_status", sql`${table.status} in ('nothing', 'boots', 'menus', 'ingame', 'playable')`),
    check("compat_note", sql`length(${table.note}) <= 500`),
  ],
);

/** The verdict per game and platform, worked out again from the reports whenever one arrives. */
export const compatSummaries = pgTable(
  "compat_summaries",
  {
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    platform: text().notNull(),
    status: text().notNull(),
    /** The newest launcher version anyone tested. */
    version: text().notNull(),
    testedAt: timestamp({ withTimezone: true }).notNull(),
    reports: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.titleId, table.platform] }),
    index().on(table.testedAt.desc()),
    index().on(table.platform, table.status),
  ],
);

/** The looking-for-group board: someone wants players for a game, now or later today. A post goes
 *  by itself at expires_at (at most a day after it was made), when full, or when its poster or a
 *  moderator closes it. */
export const lfgPosts = pgTable(
  "lfg_posts",
  {
    /** UUIDv7, so the newest has the largest ID; the board pages by it. */
    id: uuid().primaryKey(),
    authorId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text()
      .notNull()
      .references(() => games.titleId),
    /** coop | online | party | trophies */
    purpose: text().notNull(),
    /** Null: now. */
    startsAt: timestamp({ withTimezone: true }),
    languages: jsonb().$type<string[]>().notNull(),
    region: text(),
    slots: integer().notNull(),
    filled: integer().notNull().default(0),
    note: text(),
    /** open | full | closed | expired | removed */
    status: text().notNull().default("open"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index("lfg_open").on(table.status, table.expiresAt),
    index("lfg_by_game").on(table.titleId, table.status),
    index().on(table.authorId, table.status),
    check("lfg_purpose", sql`${table.purpose} in ('coop', 'online', 'party', 'trophies')`),
    check("lfg_status", sql`${table.status} in ('open', 'full', 'closed', 'expired', 'removed')`),
    check("lfg_slots", sql`${table.slots} between 1 and 7 and ${table.filled} between 0 and ${table.slots}`),
    check("lfg_note", sql`length(${table.note}) <= 140`),
  ],
);

/** "I'm in" on a post: pending until the poster answers; on yes, where they were invited. */
export const lfgRequests = pgTable(
  "lfg_requests",
  {
    postId: uuid()
      .notNull()
      .references(() => lfgPosts.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** pending | accepted | declined */
    status: text().notNull().default("pending"),
    /** {kind: party | share_play, id} once accepted. */
    invite: jsonb().$type<{ kind: "party" | "share_play"; id: string }>(),
    createdAt: now(),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.accountId] }),
    index().on(table.accountId, table.createdAt.desc()),
    check("lfg_request_status", sql`${table.status} in ('pending', 'accepted', 'declined')`),
  ],
);

/** A family: a manager brings in parents, adults and children; parents set the children's limits.
 *  Opt-in: an account in no family has no limits. */
export const families = pgTable(
  "families",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** When the parents last got the weekly summary. */
    summaryAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [check("family_name", sql`length(${table.name}) <= 40`)],
);

/** Someone is in at most one family; one manager per family. */
export const familyMembers = pgTable(
  "family_members",
  {
    familyId: uuid()
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" })
      .unique(),
    /** manager | parent | adult | child */
    role: text().notNull(),
    addedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** A child account the manager made waits for the child's own yes (a link code is one);
     *  until then the limits apply, and saying no takes the account out of the family. */
    confirmedAt: timestamp({ withTimezone: true }),
    joinedAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.familyId, table.accountId] }),
    uniqueIndex("one_family_manager").on(table.familyId).where(sql`${table.role} = 'manager'`),
    check("family_role", sql`${table.role} in ('manager', 'parent', 'adult', 'child')`),
  ],
);

/** Waiting to join: a member invite to an account (accepted in a notification), or a child link
 *  code (kept only as its hash) the child confirms with. */
export const familyInvites = pgTable(
  "family_invites",
  {
    id: uuid().primaryKey(),
    familyId: uuid()
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    /** member | child_link */
    kind: text().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    role: text().notNull(),
    codeHash: bytea().unique(),
    invitedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (table) => [
    index().on(table.accountId),
    index().on(table.familyId),
    check("family_invite_kind", sql`${table.kind} in ('member', 'child_link')`),
    check("family_invite_role", sql`${table.role} in ('parent', 'adult', 'child')`),
  ],
);

/** A child's limits as a parent set them (FamilyRestrictions, over the defaults); a child with no
 *  row has the defaults. */
export const childRestrictions = pgTable("child_restrictions", {
  accountId: uuid()
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
  updatedAt: now(),
});

/** What a child asked the parents: more time today, to add a friend, to play a blocked game. An
 *  approved more_time row (or one a parent gave unasked) is extra time on `day`. */
export const familyRequests = pgTable(
  "family_requests",
  {
    /** UUIDv7, so the newest has the largest ID. */
    id: uuid().primaryKey(),
    familyId: uuid()
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** more_time | add_friend | play_game */
    kind: text().notNull(),
    /** more_time: {minutes, titleId?}; add_friend: {userId}; play_game: {titleId, name?}; and the
     *  child's note. */
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** The child's date (YYYY-MM-DD) extra time counts on. */
    day: text(),
    /** pending | approved | declined */
    status: text().notNull().default("pending"),
    grantedMinutes: integer(),
    answeredBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    answeredAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    index().on(table.familyId, table.status),
    index().on(table.childId, table.day),
    check("family_request_kind", sql`${table.kind} in ('more_time', 'add_friend', 'play_game')`),
    check("family_request_status", sql`${table.status} in ('pending', 'approved', 'declined')`),
  ],
);

/** What happened in a family, for its manager and parents: who joined, left, changed a limit. */
export const familyLog = pgTable(
  "family_log",
  {
    /** UUIDv7, so the newest has the largest ID. */
    id: uuid().primaryKey(),
    familyId: uuid()
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    action: text().notNull(),
    subjectId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: now(),
  },
  (table) => [index("family_log_by_family").on(table.familyId, table.id.desc())],
);

/** Cloud storage per account: the bytes it keeps (saves and media together), changed in the same
 *  transaction as its files. Every change to an account's files locks this row first, so they
 *  happen one at a time per account. */
export const storageAccounts = pgTable(
  "storage_accounts",
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    usedBytes: bigint({ mode: "number" }).notNull().default(0),
    updatedAt: now(),
  },
  (table) => [check("storage_used", sql`${table.usedBytes} >= 0`)],
);

/** An account's files in the file store, by the SHA-256 of their bytes (the store's key is
 *  <account>/<first two hex>/<sha256>): the same bytes are kept and counted once per account,
 *  whatever save versions or media use them. A file nothing uses is deleted with its row. */
export const storedFiles = pgTable(
  "stored_files",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sha256: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    contentType: text().notNull(),
    /** save | media: which part of the usage bar it counts in. */
    kind: text().notNull(),
    createdAt: now(),
    lastUsedAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.sha256] }),
    check("stored_file_kind", sql`${table.kind} in ('save', 'media')`),
    check("stored_file_size", sql`${table.size} >= 0`),
  ],
);

/** A game's save slot in the cloud; its versions are the archives the launcher sent. */
export const saveSlots = pgTable(
  "save_slots",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    titleId: text().notNull(),
    slot: text().notNull(),
    /** The newest version number given out; versions only go up, even after deletes. */
    lastVersion: integer().notNull().default(0),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    uniqueIndex("save_slot_name").on(table.accountId, table.titleId, table.slot),
    check("save_title_id", sql`${table.titleId} ~ '^[A-Z]{4}[0-9]{5}$'`),
    check("save_slot_length", sql`length(${table.slot}) between 1 and 64`),
  ],
);

/** One archive (a zip) of a slot; the newest three are kept. */
export const saveVersions = pgTable(
  "save_versions",
  {
    id: uuid().primaryKey(),
    slotId: uuid()
      .notNull()
      .references(() => saveSlots.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    sha256: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    device: text(),
    launcherVersion: text(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("save_version_number").on(table.slotId, table.version),
    index().on(table.accountId),
    foreignKey({
      columns: [table.accountId, table.sha256],
      foreignColumns: [storedFiles.accountId, storedFiles.sha256],
    }),
  ],
);

/** A save upload in parts: begun, parts arriving (in any order, again if lost), then completed.
 *  The parts wait in the server's staging folder; an upload not completed in a day is dropped. */
export const uploads = pgTable(
  "uploads",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    size: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    partSize: integer().notNull(),
    parts: integer().notNull(),
    /** The part numbers received so far. */
    received: integer().array().notNull().default(sql`'{}'::integer[]`),
    /** What the save will be: titleId, slot, device, launcherVersion, baseVersion, replaceLatest. */
    meta: jsonb().$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (table) => [index().on(table.accountId), index().on(table.expiresAt)],
);

/** Photos, clips and voice notes: sent in messages or pinned to the profile gallery. Media not used
 *  in a day after it was uploaded is deleted. */
export const media = pgTable(
  "media",
  {
    id: uuid().primaryKey(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** image | clip | voice */
    kind: text().notNull(),
    sha256: text().notNull(),
    contentType: text().notNull(),
    /** A smaller still for lists (images), and the still before a clip plays (from the client). */
    thumbSha256: text(),
    posterSha256: text(),
    /** Bytes of the file, its thumbnail and its poster together. */
    size: bigint({ mode: "number" }).notNull(),
    width: integer(),
    height: integer(),
    durationMs: integer(),
    /** active | hidden (by a moderator) */
    status: text().notNull().default("active"),
    /** When it was first sent or pinned; until then it is a leftover upload. */
    usedAt: timestamp({ withTimezone: true }),
    /** Its place in the profile gallery (0-11), or none. */
    galleryPosition: integer(),
    createdAt: now(),
  },
  (table) => [
    index().on(table.accountId, table.id.desc()),
    uniqueIndex("media_gallery_place")
      .on(table.accountId, table.galleryPosition)
      .where(sql`${table.galleryPosition} is not null`),
    foreignKey({
      columns: [table.accountId, table.sha256],
      foreignColumns: [storedFiles.accountId, storedFiles.sha256],
    }),
    foreignKey({
      columns: [table.accountId, table.thumbSha256],
      foreignColumns: [storedFiles.accountId, storedFiles.sha256],
    }),
    foreignKey({
      columns: [table.accountId, table.posterSha256],
      foreignColumns: [storedFiles.accountId, storedFiles.sha256],
    }),
    check("media_kind", sql`${table.kind} in ('image', 'clip', 'voice')`),
    check("media_status", sql`${table.status} in ('active', 'hidden')`),
    check("media_gallery", sql`${table.galleryPosition} between 0 and 11`),
  ],
);

/** Who played with whom, one row each way per pair: the last time, where and in which game.
 *  Kept 90 days after the last meeting; only while both remember meetings. */
export const metPlayers = pgTable(
  "met_players",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    otherId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** party | share_play | game_session | lfg */
    source: text().notNull(),
    titleId: text().references(() => games.titleId),
    times: integer().notNull().default(1),
    firstMetAt: now(),
    lastMetAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.otherId] }),
    index("met_by_account").on(table.accountId, table.lastMetAt.desc()),
    index("met_by_time").on(table.lastMetAt),
    index().on(table.otherId),
    check("met_source", sql`${table.source} in ('party', 'share_play', 'game_session', 'lfg')`),
    check("met_not_self", sql`${table.accountId} <> ${table.otherId}`),
  ],
);

/** Communities: a name, maybe a game, a preset icon, public or by invite; its chat is the
 *  conversation bound to it. */
export const communities = pgTable(
  "communities",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    titleId: text().references(() => games.titleId),
    description: text(),
    icon: text().notNull(),
    /** public | invite */
    visibility: text().notNull().default("public"),
    ownerId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    /** Kept with every join and leave, for lists and the size limit. */
    memberCount: integer().notNull().default(0),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index("communities_public").on(table.visibility, table.memberCount.desc()),
    index().on(table.titleId),
    index().on(table.ownerId),
    check("community_visibility", sql`${table.visibility} in ('public', 'invite')`),
    check("community_name", sql`length(${table.name}) between 3 and 40`),
    check("community_description", sql`length(${table.description}) <= 500`),
  ],
);

export const communityMembers = pgTable(
  "community_members",
  {
    communityId: uuid()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** owner | moderator | member */
    role: text().notNull().default("member"),
    joinedAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.communityId, table.accountId] }),
    index().on(table.accountId),
    check("community_role", sql`${table.role} in ('owner', 'moderator', 'member')`),
  ],
);

export const communityInvites = pgTable(
  "community_invites",
  {
    communityId: uuid()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    invitedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (table) => [primaryKey({ columns: [table.communityId, table.accountId] }), index().on(table.accountId)],
);

/** People a community's moderators put out; they cannot come back until unbanned. */
export const communityBans = pgTable(
  "community_bans",
  {
    communityId: uuid()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    bannedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    reason: text(),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.communityId, table.accountId] }),
    check("community_ban_reason", sql`length(${table.reason}) <= 200`),
  ],
);

/** A community's planned play times. */
export const communityEvents = pgTable(
  "community_events",
  {
    id: uuid().primaryKey(),
    communityId: uuid()
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    hostId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    title: text().notNull(),
    titleId: text().references(() => games.titleId),
    description: text(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** scheduled | cancelled */
    status: text().notNull().default("scheduled"),
    /** When the 15-minute reminder went out. */
    remindedAt: timestamp({ withTimezone: true }),
    /** {kind: party | share_play, id} once the host started it. */
    link: jsonb().$type<{ kind: "party" | "share_play"; id: string }>(),
    startedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [
    index("events_by_community").on(table.communityId, table.startsAt),
    index("events_due")
      .on(table.startsAt)
      .where(sql`${table.status} = 'scheduled' and ${table.remindedAt} is null`),
    check("event_status", sql`${table.status} in ('scheduled', 'cancelled')`),
    check("event_title", sql`length(${table.title}) between 3 and 80`),
    check("event_description", sql`length(${table.description}) <= 1000`),
    check("event_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    eventId: uuid()
      .notNull()
      .references(() => communityEvents.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** going | maybe */
    status: text().notNull(),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.accountId] }),
    index().on(table.accountId),
    check("rsvp_status", sql`${table.status} in ('going', 'maybe')`),
  ],
);
