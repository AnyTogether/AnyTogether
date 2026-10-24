import { z } from "zod";
import type { Grade, RarityLabel } from "./games.js";
import type { MemberView } from "./messages.js";

/** What goes in the activity feed, written when it happens:
 *  - trophy: trophies earned in one game; more in the same game within an hour fold into the item
 *  - platinum: a platinum, always an item of its own
 *  - first_play: the first session of a game
 *  - long_session: a session of at least `longSessionSeconds`
 *  - friendship: two people became friends (one item per person)
 *  - milestone: a round number of trophies, platinums, games or hours. */
export const activityKinds = [
  "trophy",
  "platinum",
  "first_play",
  "long_session",
  "friendship",
  "milestone",
] as const;
export type ActivityKind = (typeof activityKinds)[number];

/** Which privacy setting decides who sees an item; it is read each time the feed is read, so
 *  changing a setting hides (or shows) old items at once. */
export const activitySections = ["library", "trophies", "friends"] as const;
export type ActivitySection = (typeof activitySections)[number];

export const feedPageSize = 30;
export const maxFeedPage = 50;
/** A session at least this long is told to friends. */
export const longSessionSeconds = 2 * 3600;
/** Trophies in the same game this close together fold into one item. */
export const foldTrophiesMs = 3_600_000;
/** Only what happened this recently becomes an item: a launcher's first upload of years of
 *  trophies and sessions stays out of friends' feeds. */
export const freshActivityMs = 24 * 3_600_000;

/** Round numbers worth an item; only the highest one crossed at once is written. */
export const milestones = {
  trophies: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  platinums: [5, 10, 25, 50, 100],
  games: [5, 10, 25, 50, 100],
  hours: [10, 50, 100, 250, 500, 1000, 2500],
} as const;
export type MilestoneKind = keyof typeof milestones;

/** The fixed reactions; clients draw them as 🔥 👏 😮 ❤️. One per person per item. */
export const reactions = ["fire", "clap", "wow", "heart"] as const;
export type Reaction = (typeof reactions)[number];
export const ReactionSet = z.object({ reaction: z.enum(reactions) });

export interface ActivityTrophy {
  trophyId: number;
  grade: Grade;
  hidden: boolean;
  /** null for a hidden trophy the reader has not earned. */
  texts: Record<string, { name: string; detail?: string }> | null;
  rarity: number | null;
  rarityLabel: RarityLabel | null;
}

/** One item as a reader sees it. Fields beyond the common ones depend on `kind`. */
export interface ActivityView {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  actor: MemberView;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null } | null;
  /** platinum: a platinum; rare: one of the trophies is rare or rarer (at most 20 % of players). */
  highlight: "platinum" | "rare" | null;
  /** trophy, platinum: the best first (rarest, then highest grade), at most five. */
  trophies?: ActivityTrophy[];
  /** trophy: how many trophies the item holds. */
  trophyCount?: number;
  /** long_session: its length; first_play: the longest session so far, when it was long. */
  seconds?: number;
  /** friendship: the new friend. */
  friend?: MemberView;
  /** milestone: what was reached. */
  milestone?: { kind: MilestoneKind; value: number };
  reactions: { counts: Partial<Record<Reaction, number>>; mine: Reaction | null };
}

export interface FeedPage {
  items: ActivityView[];
  /** Pass as `before` for the next (older) page; null at the end. */
  next: string | null;
}

/** Sent to each friend who may see the item, when it is written and again when it changes (more
 *  trophies folded in): replace an item with the same id. */
export type FeedEvent = { type: "feed.item"; data: ActivityView };

/** Leaderboards: overall by trophy points, and per game by points, play time or completion. */
export const leaderboardScopes = ["friends", "global"] as const;
export type LeaderboardScope = (typeof leaderboardScopes)[number];
export const gameBoards = ["points", "time", "completion"] as const;
export type GameBoard = (typeof gameBoards)[number];
export const maxLeaderboardEntries = 100;
/** How long a board is kept in Valkey before it is worked out again. */
export const globalBoardSeconds = 60;
export const friendsBoardSeconds = 30;

export interface LeaderboardEntry {
  rank: number;
  user: MemberView;
  /** points, seconds played, or completion percent. */
  value: number;
}

export interface Leaderboard {
  board: "points" | GameBoard;
  scope: LeaderboardScope;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null } | null;
  entries: LeaderboardEntry[];
  /** The reader: their rank (null with nothing to rank) and value. `listed` is false when they
   *  are not on this board (a global board leaves out anyone whose trophies or library are not
   *  public); their rank then says where they would be. */
  me: { rank: number | null; value: number; listed: boolean };
  /** The people just above and below the reader, when the reader is listed beyond `entries`. */
  around: LeaderboardEntry[];
  /** How many people are on the board. */
  total: number;
  updatedAt: string;
}
