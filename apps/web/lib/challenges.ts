import type { GameCard } from "@/lib/feed";
import { totalTime } from "@/lib/games";
import type { Person } from "@/lib/people";
import { fill } from "@/lib/people";

/** Challenges and API tokens as the API shows them (the website keeps its own copy of the shapes). */
export type ChallengeMetric = "points" | "trophies" | "time";
export type ChallengeAudience = "friends" | "community" | "public";
export type ChallengeState = "upcoming" | "active" | "ended" | "cancelled";
export const challengeMetrics: ChallengeMetric[] = ["points", "trophies", "time"];
export const challengeAudiences: ChallengeAudience[] = ["friends", "community", "public"];

export interface Standing {
  rank: number;
  /** Null for someone hidden from the reader (a block either way). */
  user: Person | null;
  value: number;
  me: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  description: string | null;
  game: GameCard;
  metric: ChallengeMetric;
  audience: ChallengeAudience;
  community: { id: string; name: string; icon: string; iconUrl: string } | null;
  creator: Person | null;
  startsAt: string;
  endsAt: string;
  state: ChallengeState;
  final: boolean;
  entrants: number;
  joined: boolean;
  mine: boolean;
  canCancel: boolean;
  leader: Standing | null;
  myStanding: { rank: number; value: number } | null;
  createdAt: string;
}

export interface ChallengeDetail extends Challenge {
  standings: Standing[];
  around: Standing[];
  updatedAt: string;
}

export type ApiScope = "profiles:read" | "leaderboards:read" | "challenges:read";
export const apiScopes: ApiScope[] = ["profiles:read", "leaderboards:read", "challenges:read"];

export interface ApiToken {
  id: string;
  name: string;
  start: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** How long a challenge may run, as the API allows: an hour to 90 days, starting within 90 days. */
export const challengeLimits = { minHours: 1, maxDays: 90, aheadDays: 90 } as const;
/** The lengths offered when making one. */
export const challengeLengths = [
  { hours: 24, key: "length1d" },
  { hours: 72, key: "length3d" },
  { hours: 168, key: "length1w" },
  { hours: 336, key: "length2w" },
  { hours: 720, key: "length30d" },
] as const;

type ValueTexts = { minutes: string; hoursOnly: string; pointsValue: string; trophiesValue: string };

/** A standing's value: points, trophies or play time. */
export function challengeValue(metric: ChallengeMetric, value: number, texts: ValueTexts, language: string) {
  const number = new Intl.NumberFormat(language);
  if (metric === "time") return totalTime(value, texts);
  return fill(metric === "points" ? texts.pointsValue : texts.trophiesValue, { n: number.format(value) });
}

/** How long until a moment, roughly: "3 days", "5 hours", "12 minutes". */
export function untilText(iso: string, language: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: "always" });
  const sign = ms < 0 ? -1 : 1;
  if (minutes < 60) return format.format(sign * minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(sign * hours, "hour");
  return format.format(sign * Math.round(hours / 24), "day");
}

/** How far through its window a challenge is, 0 to 1. */
export function progressOf(challenge: Pick<Challenge, "startsAt" | "endsAt">, now = Date.now()) {
  const start = Date.parse(challenge.startsAt);
  const end = Date.parse(challenge.endsAt);
  return Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
}
