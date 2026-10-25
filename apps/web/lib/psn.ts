import type { Person } from "@/lib/people";

/** Trophy levels, profile looks, the showcase, players met, communities and events, as the API
 *  shows them (the website keeps its own copy of the shapes). */

export type LevelTier = "bronze" | "silver" | "gold" | "platinum";

export interface LevelBadgeData {
  level: number;
  tier: LevelTier;
  frame: number;
}

export interface TrophyLevel extends LevelBadgeData {
  points: number;
  levelPoints: number;
  nextLevelPoints: number | null;
  progress: number;
}

export interface CoverView {
  kind: "preset" | "game";
  id: string;
  url: string;
}

export const coverPalettes = ["cosmic", "aurora", "sunset"] as const;
export const coverPatterns = ["ribbons", "grid", "stars", "glow"] as const;
export const coverPresets = coverPalettes.flatMap((palette) =>
  coverPatterns.map((pattern) => `${palette}-${pattern}`),
);

/** The launcher's accents, as the API names them. */
export const accents = {
  blue: "#4f94ff",
  mint: "#5cebbd",
  coral: "#ff8066",
  violet: "#a885ff",
  gold: "#ffcc5c",
  white: "#f0f0f0",
} as const;
export type AccentName = keyof typeof accents;
export const accentNames = Object.keys(accents) as AccentName[];

export const iconGlyphs = [
  "pad",
  "sword",
  "star",
  "flag",
  "rocket",
  "crown",
  "shield",
  "heart",
  "flame",
  "ghost",
  "wheel",
  "ball",
] as const;
export const iconPresets = iconGlyphs.flatMap((glyph) =>
  coverPalettes.map((palette) => `${glyph}-${palette}`),
);

/** Pictures drawn by the API, on this site's own /api path. */
export const coverSrc = (id: string) => `/api/v1/art/covers/${id}.svg`;
export const iconSrc = (id: string) => `/api/v1/art/icons/${id}.svg`;

/** A picture the API drew comes back with its full address; on the page it is loaded from this
 *  site (the proxy passes /api on), so a page works the same on any address. */
export function localArt(url: string | null | undefined) {
  if (!url) return null;
  const match = /\/api\/v1\/art\/(covers|icons)\/([a-z]+-[a-z]+)\.svg$/.exec(url);
  return match ? `/api/v1/art/${match[1]}/${match[2]}.svg` : url;
}

export interface ShowcaseTrophy {
  titleId: string;
  gameNames: Record<string, string>;
  trophyId: number;
  grade: "bronze" | "silver" | "gold" | "platinum";
  hidden: boolean;
  texts: Record<string, { name: string; detail?: string }> | null;
  earnedAt: string;
  rarity: number | null;
  rarityLabel: string | null;
}

export interface ShowcaseGame {
  titleId: string;
  names: Record<string, string>;
  iconUrl: string | null;
  secondsPlayed: number;
  trophiesEarned: number | null;
  trophiesTotal: number | null;
  progress: number | null;
}

export interface Showcase {
  trophies: ShowcaseTrophy[] | null;
  games: ShowcaseGame[] | null;
}

export interface CompareSide {
  earned: number;
  total: number | null;
  progress: number | null;
  points: number;
}

export interface CompareGame {
  titleId: string;
  names: Record<string, string>;
  iconUrl: string | null;
  mine: CompareSide | null;
  theirs: CompareSide | null;
}

export interface CompareTrophy {
  id: number;
  grade: "bronze" | "silver" | "gold" | "platinum";
  hidden: boolean;
  texts: Record<string, { name: string; detail?: string }> | null;
  rarity: number | null;
  rarityLabel: string | null;
  mine: string | null;
  theirs: string | null;
}

export interface Compare {
  titleId: string;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  setHash: string | null;
  me: Person & { level: LevelBadgeData };
  them: Person & { level: LevelBadgeData };
  trophies: CompareTrophy[];
  totals: { mine: number; theirs: number; both: number; total: number };
}

export type MeetingSource = "party" | "share_play" | "game_session" | "lfg";

export interface MetPlayer {
  user: Person;
  lastMetAt: string;
  firstMetAt: string;
  source: MeetingSource;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null } | null;
  times: number;
  friendship: "friends" | "pending_out" | "pending_in" | "none";
}

export interface MetPlayers {
  remember: boolean;
  days: number;
  players: MetPlayer[];
}

export type CommunityRole = "owner" | "moderator" | "member";

export interface CommunityCard {
  id: string;
  name: string;
  titleId: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  description: string | null;
  icon: string;
  iconUrl: string;
  visibility: "public" | "invite";
  members: number;
  maxMembers: number;
  role: CommunityRole | null;
  invited: boolean;
  upcomingEvents: number;
  createdAt: string;
}

export interface Community extends CommunityCard {
  owner: Person | null;
  moderators: Person[];
  conversationId: string | null;
}

export interface CommunityMember extends Person {
  role: CommunityRole;
  joinedAt: string;
  level: LevelBadgeData | null;
}

export interface CommunityInvite {
  community: CommunityCard;
  from: Person | null;
  invitedAt: string;
}

export interface EventLink {
  kind: "party" | "share_play";
  id: string;
}

export interface PlannedEvent {
  id: string;
  communityId: string;
  community: { name: string; icon: string; iconUrl: string };
  host: Person | null;
  title: string;
  titleId: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "cancelled";
  link: EventLink | null;
  startedAt: string | null;
  going: number;
  maybe: number;
  mine: "going" | "maybe" | null;
  people: Person[];
  canEdit: boolean;
  createdAt: string;
}

export const eventDurations = [30, 60, 90, 120, 180, 240] as const;

/** Where an event's link leads on the website. */
export const linkHref = (link: EventLink) => (link.kind === "share_play" ? `/watch/${link.id}` : "/party");

/** The day an instant falls on in a time zone, as YYYY-MM-DD (for grouping a calendar). */
export function dayKey(iso: string, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts;
}

/** Events grouped by the day they start on, in order. */
export function byDay<T extends { startsAt: string }>(events: T[], timeZone?: string) {
  const days = new Map<string, T[]>();
  for (const event of [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = dayKey(event.startsAt, timeZone);
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, events: list }));
}

/** A datetime-local value ("2026-10-25T21:30") read in the browser's own time zone, as UTC. */
export function localInputToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The other way: an instant as a datetime-local value in the browser's time zone. */
export function isoToLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The reader's games as options for a game picker, by name. */
export function gameOptions(
  games: { titleId: string; names: Record<string, string> }[],
  language: string,
): { titleId: string; name: string }[] {
  return games
    .map((game) => ({
      titleId: game.titleId,
      name: game.names[language] ?? game.names.en ?? Object.values(game.names)[0] ?? game.titleId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, language));
}

/** A community's icon on the page, from the event that names it. */
export const communityIconOf = (event: PlannedEvent) =>
  localArt(event.community.iconUrl) ?? iconSrc(event.community.icon);
