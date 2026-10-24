import type { Grade, Rarity } from "./games";
import type { Person } from "./people";

/** The activity feed and leaderboards as the API shows them (the website keeps its own copy of
 *  the shapes). */
export type ActivityKind = "trophy" | "platinum" | "first_play" | "long_session" | "friendship" | "milestone";
export type Reaction = "fire" | "clap" | "wow" | "heart";
export const reactions: { key: Reaction; emoji: string }[] = [
  { key: "fire", emoji: "🔥" },
  { key: "clap", emoji: "👏" },
  { key: "wow", emoji: "😮" },
  { key: "heart", emoji: "❤️" },
];

export interface GameCard {
  titleId: string;
  names: Record<string, string>;
  iconUrl: string | null;
}

export interface ActivityTrophy {
  trophyId: number;
  grade: Grade;
  hidden: boolean;
  texts: Record<string, { name: string; detail?: string }> | null;
  rarity: number | null;
  rarityLabel: Rarity | null;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  actor: Person;
  game: GameCard | null;
  highlight: "platinum" | "rare" | null;
  trophies?: ActivityTrophy[];
  trophyCount?: number;
  seconds?: number;
  friend?: Person;
  milestone?: { kind: "trophies" | "platinums" | "games" | "hours"; value: number };
  reactions: { counts: Partial<Record<Reaction, number>>; mine: Reaction | null };
}

export interface FeedPage {
  items: Activity[];
  next: string | null;
}

export type Scope = "friends" | "global";
export type GameBoard = "points" | "time" | "completion";

export interface BoardEntry {
  rank: number;
  user: Person;
  value: number;
}

export interface Board {
  board: "points" | GameBoard;
  scope: Scope;
  game: GameCard | null;
  entries: BoardEntry[];
  me: { rank: number | null; value: number; listed: boolean };
  around: BoardEntry[];
  total: number;
  updatedAt: string;
}

export interface BoardGame extends GameCard {
  players: number;
  mine: boolean;
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", in the reader's language. */
export function since(iso: string, language: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
  if (seconds > -60) return format.format(0, "second");
  if (seconds > -3600) return format.format(Math.round(seconds / 60), "minute");
  if (seconds > -86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (seconds > -7 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" });
}
