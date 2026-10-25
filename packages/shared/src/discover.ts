import { z } from "zod";
import { LanguageCode, TitleId } from "./games.js";
import type { MemberView } from "./messages.js";
import { type PublicJoin, maxPartySize } from "./parties.js";
import { sharePadSlots } from "./sharePlays.js";

/** Finding people to play with beyond one's friends: the looking-for-group board, parties and
 *  share plays their host lists in public, and people to meet. Who sees whom always follows the
 *  blocks (either way) and each person's privacy settings. */

/** What a post is for: co-op over share play, an online game, a party to talk in, help with
 *  trophies. */
export const lfgPurposes = ["coop", "online", "party", "trophies"] as const;
export type LfgPurpose = (typeof lfgPurposes)[number];

/** Rough regions, so people far apart can skip each other; optional on a post. */
export const regions = ["eu", "na", "sa", "asia", "oceania", "africa", "me"] as const;
export type Region = (typeof regions)[number];

const Languages = (max: number) =>
  z
    .array(LanguageCode)
    .max(max)
    .transform((list) => [...new Set(list)]);

/** A post lives at most a day; the poster may close it sooner, and it closes itself when full. */
export const maxLfgHours = 24;
export const maxLfgNote = 140;
/** Open posts one person may have at a time. */
export const maxOpenLfgPosts = 3;
/** Co-op goes over share play, where a viewer can be handed pad 2, 3 or 4. */
export const maxCoopSlots = sharePadSlots.length;
/** Everyone else ends up in a party with the poster. */
export const maxLfgSlots = maxPartySize - 1;
export const lfgPageSize = 30;

export const LfgCreate = z
  .object({
    titleId: TitleId,
    purpose: z.enum(lfgPurposes),
    /** When to play; left out or null for now. Within the next 24 hours. */
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    languages: Languages(3).refine((list) => list.length > 0, "at least one language"),
    region: z.enum(regions).nullable().optional(),
    /** How many people the poster is looking for. */
    slots: z.number().int().min(1).max(maxLfgSlots),
    note: z.string().trim().max(maxLfgNote).optional(),
    /** When the post goes; within 24 hours, three hours after it starts when left out. */
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((post) => post.purpose !== "coop" || post.slots <= maxCoopSlots, {
    message: `co-op over share play has room for ${maxCoopSlots} more players`,
    path: ["slots"],
  });

export type LfgStatus = "open" | "full" | "closed" | "expired" | "removed";
export type LfgRequestStatus = "pending" | "accepted" | "declined";

/** Where an accepted player was invited: the poster's party, or the share play they host. */
export interface LfgInvite {
  kind: "party" | "share_play";
  id: string;
}

export interface LfgRequestView {
  user: MemberView;
  status: LfgRequestStatus;
  invite: LfgInvite | null;
  createdAt: string;
}

export interface LfgView {
  id: string;
  author: MemberView;
  titleId: string;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  purpose: LfgPurpose;
  /** Null: now. */
  startsAt: string | null;
  languages: string[];
  region: Region | null;
  slots: number;
  /** Players accepted so far. */
  filled: number;
  note: string | null;
  expiresAt: string;
  status: LfgStatus;
  createdAt: string;
  mine: boolean;
  /** The asker's own "I'm in", if they sent one. */
  myRequest: { status: LfgRequestStatus; invite: LfgInvite | null } | null;
  /** Only for the poster: who wants in. */
  requests?: LfgRequestView[];
}

/** A party in the public list. */
export interface PublicPartyView {
  id: string;
  host: MemberView | null;
  titleId: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  language: string | null;
  join: PublicJoin;
  size: number;
  max: number;
  /** The asker asked to join and waits. */
  requested: boolean;
  listedAt: string;
}

/** A share play in the public list, or under Live now. */
export interface PublicShareView {
  id: string;
  host: MemberView | null;
  titleId: string;
  title: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  language: string | null;
  join: PublicJoin;
  live: boolean;
  viewers: number;
  maxViewers: number;
  requested: boolean;
  startedAt: string;
}

/** Discovery: whether the account shows in "Players of", suggestions and game hubs. Left unset it
 *  follows the library: on while the library is public, off otherwise. */
export const DiscoveryUpdate = z
  .object({
    /** null goes back to following the library. */
    discoverable: z.boolean().nullable().optional(),
    /** Languages the person plays in, for "speaks your language" and the board's default. */
    languages: Languages(5).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

export interface DiscoveryView {
  /** Whether the account shows in discovery now. */
  discoverable: boolean;
  /** What the person chose; null while it follows the library. */
  chosen: boolean | null;
  languages: string[];
}

/** Why someone is suggested: games both play, friends in common, a shared language. */
export type SuggestionReason =
  | { kind: "game"; titleId: string; names: Record<string, string> }
  | { kind: "friends"; count: number }
  | { kind: "language"; language: string };

export type DiscoverEvent =
  /** Someone wants in on the asker's post. */
  | { type: "lfg.request"; data: { postId: string; titleId: string; from: MemberView } }
  /** They took it back. */
  | { type: "lfg.request_cancelled"; data: { postId: string; userId: string } }
  /** The poster answered; on yes, where they were invited. */
  | {
      type: "lfg.answered";
      data: { postId: string; answer: "accepted" | "declined"; invite: LfgInvite | null };
    }
  /** On the board (topics lfg and lfg:<titleId>): a post opened, changed or closed; read it again. */
  | {
      type: "lfg.changed";
      data: { postId: string; titleId: string; change: "opened" | "updated" | "closed" };
    }
  /** Someone asked to join, from the public list or with the join code (`via`). */
  | { type: "party.request"; data: { partyId: string; from: MemberView; via: "list" | "code" } }
  | { type: "party.request_cancelled"; data: { partyId: string; userId: string } }
  | { type: "party.request_answered"; data: { partyId: string; answer: "accepted" | "declined" } }
  | { type: "share_play.request"; data: { sharePlayId: string; from: MemberView; via: "list" | "code" } }
  | { type: "share_play.request_cancelled"; data: { sharePlayId: string; userId: string } }
  | {
      type: "share_play.request_answered";
      data: { sharePlayId: string; answer: "accepted" | "declined" };
    }
  /** In the public lists (topics discover and discover:<titleId>): a party or share play was
   *  listed, changed (size, game, how to join) or left the list. */
  | {
      type: "discover.changed";
      data: {
        kind: "party" | "share_play";
        id: string;
        titleId: string | null;
        change: "listed" | "updated" | "unlisted";
      };
    };

/** Topics a gateway socket may watch with {op: "watch"}: the whole board or one game's, and the
 *  public parties and share plays, all or one game's. They carry only "changed" events, never who
 *  posted, so a block never leaks through them: clients read the list again. */
export const topicPattern = /^(lfg|discover)(:[A-Z]{4}[0-9]{5})?$/;
export const maxWatchedTopics = 8;
export const topicChannel = (topic: string) => `topic:${topic}`;

/** Share plays listed in public, scored by when they started. */
export const publicSharePlaysKey = "public-share-plays";
/** Who asked to join a share play: user ID → when. */
export const sharePlayRequestsKey = (id: string) => `share-play:${id}:requests`;
/** Players in a game now, as the gateway sees their presence: user ID scored by the last
 *  heartbeat that said so. */
export const playingKey = (titleId: string) => `playing:${titleId}`;
/** A score older than this in a playing set is gone (two missed heartbeats and some). */
export const playingFreshMs = 90_000;
