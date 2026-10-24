import type { Person } from "./people";

/** The Theme Hub as the API shows it (the website keeps its own copy of the shapes). */
export type ThemeSort = "new" | "popular" | "liked";
export const themeSorts: ThemeSort[] = ["new", "popular", "liked"];
export type ThemeStatus = "published" | "review" | "hidden";

export interface ThemeColors {
  deep: string;
  middle: string;
  bright: string;
  accent: string;
}

export interface ThemeCard {
  id: string;
  name: string;
  maker: Pick<Person, "userId" | "handle" | "displayName" | "avatar"> | null;
  version: number;
  style: number;
  colors: ThemeColors;
  background: "picture" | "video" | null;
  music: boolean;
  downloads: number;
  likes: number;
  preview: string;
  thumb: string;
  download: string;
  open: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeDetail extends ThemeCard {
  description: string | null;
  sha256: string;
  status: ThemeStatus;
  liked: boolean;
  mine: boolean;
}

export interface ThemePage {
  themes: ThemeCard[];
  next: string | null;
}

/** The theme's own colors as CSS variables, for the gradient behind its still and its accents. */
export const themeStyle = (colors: ThemeColors) =>
  ({
    "--t-deep": colors.deep,
    "--t-middle": colors.middle,
    "--t-bright": colors.bright,
    "--t-accent": colors.accent,
  }) as React.CSSProperties;

/** A theme file and its preview, as large as the API takes them, plus the form around them. */
export const themeUploadBytes = 59 * 1024 * 1024;

export const isThemeId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** 2.4 MB, 820 KB. */
export function fileSize(bytes: number, language: string) {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return bytes >= 1024 * 1024
    ? `${number.format(bytes / 1024 / 1024)} MB`
    : `${number.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export const compact = (n: number, language: string) =>
  new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(n);
