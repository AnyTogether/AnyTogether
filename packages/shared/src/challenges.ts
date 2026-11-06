import { z } from "zod";
import { TitleId } from "./games.js";
import type { MemberView } from "./messages.js";
import { hasLink } from "./profile.js";

/** Challenges: a time-boxed race on one game, between a start and an end. Someone makes one for
 *  their friends, a community they are in, or everyone; people join, the standings count only
 *  what happened in the window, and when it is over the winner is known and everyone in it is
 *  told. What counts:
 *  - points: trophy points (bronze 15, silver 30, gold 90, platinum 300) of trophies earned in the
 *    window,
 *  - trophies: how many trophies were earned in the window,
 *  - time: seconds played in the window (a session counts once it ends and reaches the server).
 *  Trophies kept off the leaderboards (flagged) never count. Results are final an hour after the
 *  end, for sessions and trophies still on their way. */
export const challengeMetrics = ["points", "trophies", "time"] as const;
export type ChallengeMetric = (typeof challengeMetrics)[number];
export const challengeAudiences = ["friends", "community", "public"] as const;
export type ChallengeAudience = (typeof challengeAudiences)[number];
/** upcoming: not started; active: running; ended: over (final once `final` is true); cancelled:
 *  called off by its maker or the community's moderators. */
export const challengeStates = ["upcoming", "active", "ended", "cancelled"] as const;
export type ChallengeState = (typeof challengeStates)[number];

/** How long a challenge may run, how far ahead it may start, and how many may be in one. */
export const challengeHours = { min: 1, max: 90 * 24 } as const;
export const maxChallengeDaysAhead = 90;
export const maxChallengeEntrants = 1000;
/** Challenges one person may have running or coming at once. */
export const maxOpenChallenges = 10;
/** After the end, standings stay open this long for late sessions and trophies, then are final. */
export const challengeGraceMinutes = 60;
/** How many standings rows a challenge answer carries (and the reader's neighbours past them). */
export const challengeStandingRows = 100;

const plain = (max: number, min = 0) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().min(min).max(max))
    .refine((value) => !hasLink(value), "no links");

/** POST /challenges. `communityId` is needed for (and only for) a community challenge; `invite`
 *  names friends to tell about it (at most 50). */
export const ChallengeCreate = z
  .object({
    title: plain(80, 3),
    description: plain(500).optional(),
    titleId: TitleId,
    metric: z.enum(challengeMetrics),
    audience: z.enum(challengeAudiences),
    communityId: z.string().uuid().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    invite: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((value) => (value.audience === "community") === Boolean(value.communityId), {
    message: "communityId: needed for a community challenge, and only for one",
    path: ["communityId"],
  });

export const ChallengeInvite = z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) });

export interface ChallengeStanding {
  rank: number;
  /** Null for someone the reader may not see (a block either way; in the public API, anyone who
   *  keeps that part of their profile from everyone). Their place still counts. */
  user: MemberView | null;
  value: number;
  /** The reader's own row. */
  me: boolean;
}

export interface ChallengeView {
  id: string;
  title: string;
  description: string | null;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null };
  metric: ChallengeMetric;
  audience: ChallengeAudience;
  community: { id: string; name: string; icon: string; iconUrl: string } | null;
  /** Null once the maker's account is gone. */
  creator: MemberView | null;
  /** UTC; clients show them in the reader's time zone. */
  startsAt: string;
  endsAt: string;
  state: ChallengeState;
  /** Ended and past the grace hour: the standings will not change. */
  final: boolean;
  entrants: number;
  joined: boolean;
  /** The reader made it (and may cancel it). */
  mine: boolean;
  /** May the reader cancel it: its maker, or a moderator of its community, before it ends. */
  canCancel: boolean;
  /** First place while it runs, the winner once it ended; null before it starts or with no one
   *  above zero. */
  leader: ChallengeStanding | null;
  /** The reader's place, when they joined and it started. */
  myStanding: { rank: number; value: number } | null;
  createdAt: string;
}

/** GET /challenges/:id: the challenge, its first rows and the reader's neighbours past them. */
export interface ChallengeDetail extends ChallengeView {
  standings: ChallengeStanding[];
  around: ChallengeStanding[];
  updatedAt: string;
}

/** The public API (read only, /api/v1/public, with a personal API token). Every scope reads only
 *  what anyone could see signed out: public profiles and the parts opened to everyone, the global
 *  leaderboards, and challenges made for everyone. */
export const apiScopes = ["profiles:read", "leaderboards:read", "challenges:read"] as const;
export type ApiScope = (typeof apiScopes)[number];
/** Tokens one account may hold at once. */
export const maxApiTokens = 10;
/** Tokens start with this, so a leaked one is easy to spot (and to scan for). */
export const apiTokenPrefix = "atp_";

export const ApiTokenCreate = z.object({
  name: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(60)),
  scopes: z
    .array(z.enum(apiScopes))
    .min(1)
    .transform((list) => [...new Set(list)]),
});

export interface ApiTokenView {
  id: string;
  name: string;
  /** The first characters of the token ("atp_AbCd"), to tell tokens apart. */
  start: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** POST /me/api-tokens: the token itself is in this answer only. */
export interface ApiTokenCreated extends ApiTokenView {
  token: string;
}
