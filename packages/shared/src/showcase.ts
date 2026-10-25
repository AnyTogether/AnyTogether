import { z } from "zod";
import { TitleId } from "./games.js";
import type { Grade, RarityLabel } from "./games.js";
import type { LevelBadge, TrophyLevel } from "./level.js";
import type { MemberView } from "./messages.js";

/** The launcher's three looks, as deep, middle and bright tones (from its Theme.palette) and the
 *  accent each one starts with. Covers and community icons are drawn in these. */
export const palettes = {
  cosmic: { deep: "#030617", middle: "#0a266b", bright: "#6ba3ff", accent: "#4f94ff" },
  aurora: { deep: "#02080b", middle: "#054d4d", bright: "#8fffc7", accent: "#5cebbd" },
  sunset: { deep: "#0f030a", middle: "#851c38", bright: "#ffa354", accent: "#ff8066" },
} as const;
export type PaletteName = keyof typeof palettes;
export const paletteNames = Object.keys(palettes) as PaletteName[];

/** The accents the launcher offers; a profile picks one of them. */
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

/** Patterns a cover is drawn with, over a palette: "cosmic-ribbons", "sunset-grid" … */
export const coverPatterns = ["ribbons", "grid", "stars", "glow"] as const;
export type CoverPattern = (typeof coverPatterns)[number];
export const coverPresets = paletteNames.flatMap((palette) =>
  coverPatterns.map((pattern) => `${palette}-${pattern}`),
);
export const CoverPreset = z.enum(coverPresets as [string, ...string[]]);

/** Glyphs a community icon is drawn with, over a palette: "rocket-aurora" … */
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
export type IconGlyph = (typeof iconGlyphs)[number];
export const iconPresets = iconGlyphs.flatMap((glyph) =>
  paletteNames.map((palette) => `${glyph}-${palette}`),
);
export const IconPreset = z.enum(iconPresets as [string, ...string[]]);

/** A profile's cover: a preset drawn by the server, or a game's artwork (only a game whose icon
 *  the server already knows). Nothing is uploaded. */
export const CoverChoice = z.union([
  z.object({ kind: z.literal("preset"), id: CoverPreset }),
  z.object({ kind: z.literal("game"), titleId: TitleId }),
]);
export type CoverChoice = z.infer<typeof CoverChoice>;

export interface CoverView {
  kind: "preset" | "game";
  /** The preset, or the game's title ID. */
  id: string;
  url: string;
}

/** PATCH /me/look: only what is sent changes; null goes back to the default. */
export const LookUpdate = z.object({
  cover: CoverChoice.nullable().optional(),
  accent: z
    .enum(accentNames as [AccentName, ...AccentName[]])
    .nullable()
    .optional(),
});

/** Pinned on a profile: up to six earned trophies and four games. */
export const maxShowcaseTrophies = 6;
export const maxShowcaseGames = 4;
export const ShowcaseUpdate = z.object({
  trophies: z
    .array(z.object({ titleId: TitleId, trophyId: z.number().int().min(0).max(9999) }))
    .max(maxShowcaseTrophies)
    .refine(
      (list) => new Set(list.map((t) => `${t.titleId}/${t.trophyId}`)).size === list.length,
      "each trophy once",
    )
    .optional(),
  games: z
    .array(TitleId)
    .max(maxShowcaseGames)
    .refine((list) => new Set(list).size === list.length, "each game once")
    .optional(),
});
export type ShowcaseStored = { trophies?: { titleId: string; trophyId: number }[]; games?: string[] };

export interface ShowcaseTrophy {
  titleId: string;
  gameNames: Record<string, string>;
  trophyId: number;
  grade: Grade;
  hidden: boolean;
  texts: Record<string, { name: string; detail?: string }> | null;
  earnedAt: string;
  rarity: number | null;
  rarityLabel: RarityLabel | null;
}

export interface ShowcaseGame {
  titleId: string;
  names: Record<string, string>;
  iconUrl: string | null;
  secondsPlayed: number;
  /** Null when the trophies are private to the reader. */
  trophiesEarned: number | null;
  trophiesTotal: number | null;
  progress: number | null;
}

/** GET /users/{handle}/showcase: what the reader may see of it (trophies follow the trophies
 *  setting, games the library setting; a part the reader may not see is null). */
export interface ShowcaseView {
  trophies: ShowcaseTrophy[] | null;
  games: ShowcaseGame[] | null;
}

/** The look and level a profile shows; the level only to who may see the trophies. */
export interface ProfileLook {
  cover: CoverView | null;
  accent: AccentName | null;
  trophyLevel: TrophyLevel | null;
}

/** One game in a comparison list: both people's progress in it. */
export interface CompareGame {
  titleId: string;
  names: Record<string, string>;
  iconUrl: string | null;
  mine: { earned: number; total: number | null; progress: number | null; points: number } | null;
  theirs: { earned: number; total: number | null; progress: number | null; points: number } | null;
}

/** One trophy side by side: when each of the two earned it (null: not yet). */
export interface CompareTrophy {
  id: number;
  grade: Grade;
  hidden: boolean;
  /** Null for a hidden trophy neither the reader has earned. */
  texts: Record<string, { name: string; detail?: string }> | null;
  rarity: number | null;
  rarityLabel: RarityLabel | null;
  mine: string | null;
  theirs: string | null;
}

/** GET /users/{handle}/trophies/compare?titleId=…: the game's trophies with both people's. */
export interface CompareView {
  titleId: string;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  setHash: string | null;
  me: MemberView & { level: LevelBadge };
  them: MemberView & { level: LevelBadge };
  trophies: CompareTrophy[];
  totals: { mine: number; theirs: number; both: number; total: number };
}
