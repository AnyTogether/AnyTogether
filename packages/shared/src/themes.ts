import { z } from "zod";
import { hasLink } from "./profile.js";

/** The launcher's theme file: a zip of theme.json and the files it names. */
export const themeExtension = "anyps5theme";

/** How the Hub lists themes: newest first, most downloaded, most liked. */
export const themeSorts = ["new", "popular", "liked"] as const;
export type ThemeSort = (typeof themeSorts)[number];
export const themePageSize = 24;
export const maxThemePage = 60;

/** published: everyone sees it; review: hidden after reports until a moderator looks; hidden: a
 *  moderator took it down. Only its maker sees a theme that is not published. */
export const themeStatuses = ["published", "review", "hidden"] as const;
export type ThemeStatus = (typeof themeStatuses)[number];
/** A moderator's verdict on a theme from the admin page. */
export const ThemeModeration = z.object({ status: z.enum(themeStatuses) });
/** Open reports from this many people put a theme back in review. */
export const themeReportsToReview = 3;

const mb = 1024 * 1024;
/** What a theme file may hold. The launcher allows bigger files on one Mac; the Hub keeps them
 *  small enough to share. */
export const themeLimits = {
  /** The .anyps5theme file as uploaded. */
  file: 50 * mb,
  /** Everything read out of it, unpacked. */
  unpacked: 80 * mb,
  entries: 64,
  json: 64 * 1024,
  picture: 15 * mb,
  video: 40 * mb,
  music: 20 * mb,
  preview: 8 * mb,
  /** A bigger picture is refused before it is decoded. */
  pixels: 40_000_000,
};

/** Background pictures and videos, music and previews, by file extension. */
export const themePictureTypes = ["jpg", "jpeg", "png", "webp"] as const;
export const themeVideoTypes = ["mp4", "mov", "m4v"] as const;
export const themeMusicTypes = ["m4a", "mp3", "aac", "wav", "aif", "aiff", "caf"] as const;

/** The animated backgrounds the launcher draws: 0 cosmic, 1 aurora, 2 sunset (more may come). */
export const themeStyles = ["cosmic", "aurora", "sunset"] as const;

const Hex = z
  .string()
  .regex(/^#?[0-9A-Fa-f]{6}$/, "a color like #4F7CFF")
  .transform((value) => `#${value.replace("#", "").toUpperCase()}`);
/** A file name with no folders in it, as the launcher's installer takes them. */
const PlainName = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (name) => !/[/\\]/.test(name) && !name.startsWith(".") && !name.includes("\0"),
    "a plain file name",
  );
const ThemeName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(60));

/** theme.json, as the launcher writes it. Other keys are kept if they are plain values, for
 *  launchers newer than this server. */
export const ThemeJson = z
  .object({
    id: z.string().max(128).optional(),
    name: ThemeName,
    author: z.string().max(80).optional(),
    version: z.number().int().min(1).max(100_000).optional(),
    style: z.number().int().min(0).max(31).default(0),
    deep: Hex,
    middle: Hex,
    bright: Hex,
    accent: Hex,
    background: PlainName.nullish(),
    music: PlainName.nullish(),
    /** A still of the theme the launcher made when it exported it. */
    preview: PlainName.nullish(),
  })
  .catchall(z.union([z.string().max(500), z.number(), z.boolean(), z.null()]));
export type ThemeJson = z.infer<typeof ThemeJson>;

export const ThemeDescription = z
  .string()
  .transform((value) =>
    value
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  )
  .pipe(z.string().max(500))
  .refine((value) => !hasLink(value), "no links");

/** A maker changes the words on their theme; the file itself changes with a new version. */
export const ThemeUpdate = z
  .object({ name: ThemeName.optional(), description: ThemeDescription.optional() })
  .refine((value) => value.name !== undefined || value.description !== undefined, "nothing to change");

export interface ThemeColors {
  deep: string;
  middle: string;
  bright: string;
  accent: string;
}

/** A theme as the Hub lists it. */
export interface ThemeCard {
  id: string;
  name: string;
  maker: { userId: string; handle: string; displayName: string; avatar: string | null } | null;
  version: number;
  style: number;
  colors: ThemeColors;
  /** What the theme brings besides its colors. */
  background: "picture" | "video" | null;
  music: boolean;
  downloads: number;
  likes: number;
  /** 1280x720 and 640x360 WebP stills. */
  preview: string;
  thumb: string;
  /** The .anyps5theme file, and the link that opens it in the launcher. */
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
  /** For the signed-in asker: whether they like it and whether it is theirs. */
  liked: boolean;
  mine: boolean;
}

export interface ThemePage {
  themes: ThemeCard[];
  next: string | null;
}
