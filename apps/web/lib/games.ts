import type { Strings } from "./i18n";
import { fill } from "./people";

type Names = Record<string, string>;
type TrophyTexts = Record<string, { name: string; detail?: string }> | null;
export type Grade = "bronze" | "silver" | "gold" | "platinum";
export type Rarity = "common" | "uncommon" | "rare" | "very_rare" | "ultra_rare";

/** A game on someone's profile, as the API's library gives it. */
export interface LibraryGame {
  titleId: string;
  names: Names;
  iconUrl: string | null;
  lastPlayedAt: string | null;
  secondsPlayed: number;
  /** Null when the owner keeps their trophies from the viewer. */
  trophiesEarned: number | null;
  trophiesTotal: number;
  progress: number | null;
  points: number | null;
}

/** A trophy someone earned, newest first. Texts are null for a hidden one the viewer lacks. */
export interface EarnedTrophy {
  titleId: string;
  gameNames: Names;
  trophyId: number;
  grade: Grade;
  hidden: boolean;
  texts: TrophyTexts;
  earnedAt: string;
  rarity: number | null;
  rarityLabel: Rarity | null;
}

/** The viewer's language first, then English, then whatever the game has. */
export const localName = (names: Names, language: string) =>
  names[language] ?? names.en ?? Object.values(names)[0] ?? "";

export const trophyText = (texts: TrophyTexts, language: string) =>
  texts ? (texts[language] ?? texts.en ?? Object.values(texts)[0] ?? null) : null;

/** "42 min" under an hour, "3 h 5 min" after. */
export function playTime(seconds: number, texts: Pick<Strings, "minutes" | "hours">) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return fill(texts.minutes, { m: minutes });
  return fill(texts.hours, { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** Hours only, for the totals: "128 h", or minutes under an hour. */
export function totalTime(seconds: number, texts: Pick<Strings, "minutes" | "hoursOnly">) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? fill(texts.minutes, { m: minutes })
    : fill(texts.hoursOnly, { h: Math.floor(minutes / 60) });
}

/** "2 days ago", "today", in the viewer's language. */
export function ago(iso: string, language: string, now = Date.now()) {
  const days = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(days, "day");
}

/** "1.2 %" of players have it. */
export const rarityPercent = (rarity: number, language: string) =>
  new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: rarity < 0.1 ? 1 : 0 }).format(
    rarity,
  );
