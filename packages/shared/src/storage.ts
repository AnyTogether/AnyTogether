import { z } from "zod";
import { TitleId } from "./games.js";

/** Cloud saves and media: one quota per account for both, kept by the server's file store
 *  (a directory or an S3-compatible bucket). Off until the server has one. */

const mb = 1024 * 1024;

/** The default quota per account, saves and media together (the server may set another). */
export const defaultStorageQuotaBytes = 100 * mb;
/** The default biggest save archive (the server may set another). */
export const defaultSaveMaxBytes = 50 * mb;

/** What a piece of media may be, as uploaded. */
export const mediaLimits = {
  /** A screenshot: PNG, JPEG or WebP, re-encoded and stripped of metadata. */
  image: 10 * mb,
  /** A clip: MP4 with H.264 video (AAC audio or none), kept as sent. */
  clip: 25 * mb,
  /** A voice note: Opus (Ogg or WebM) or AAC (MP4/M4A). */
  voice: 1 * mb,
  /** The still shown before a clip plays, from the client. */
  poster: 2 * mb,
  /** The longest voice note. */
  voiceMs: 60_000,
  /** A bigger picture is refused before it is decoded. */
  pixels: 40_000_000,
};

export const mediaKinds = ["image", "clip", "voice"] as const;
export type MediaKind = (typeof mediaKinds)[number];
/** What a message can be: text, or one piece of media with an optional caption. */
export type MessageKind = "text" | MediaKind;
/** What an old client shows instead of media it does not know. */
export const mediaFallbackText: Record<MediaKind, string> = {
  image: "[photo]",
  clip: "[clip]",
  voice: "[voice note]",
};

/** Saves keep this many versions per slot, newest first. */
export const saveVersionsKept = 3;
/** A save upload goes in parts of this size (the last may be smaller). */
export const savePartBytes = 4 * mb;
/** An unfinished upload is dropped after this long. */
export const uploadLifetimeMs = 24 * 3600_000;
/** At most this many unfinished save uploads per account. */
export const maxOpenUploads = 3;
/** The most pinned items in a profile gallery. */
export const maxGalleryItems = 12;

/** A save slot's name as the launcher calls it: "SAVEDATA00", "Slot 1", "autosave". */
export const SaveSlotName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N} _.()-]+$/u, "letters, digits, spaces and _ . ( ) -");
const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "a SHA-256 in hex")
  .transform((value) => value.toLowerCase());

/** POST /me/saves/uploads: a save upload begins. `baseVersion` is the version the device last
 *  had (0 for none): if the cloud has another, the answer is 409 save_conflict. `replaceLatest`
 *  lets the upload take the place of the slot's only version when the quota has no other room. */
export const SaveUploadInit = z.object({
  titleId: TitleId,
  slot: SaveSlotName,
  size: z.number().int().min(1),
  sha256: Sha256,
  device: z.string().trim().max(80).optional(),
  launcherVersion: z.string().trim().max(40).optional(),
  baseVersion: z.number().int().min(0).optional(),
  replaceLatest: z.boolean().optional(),
});
export type SaveUploadInit = z.infer<typeof SaveUploadInit>;

/** POST /me/saves/uploads/:id/complete: may say again what init said about replacing. */
export const SaveUploadComplete = z.object({ replaceLatest: z.boolean().optional() });

/** PUT /me/gallery: the pinned media, in order (at most 12). */
export const GalleryUpdate = z.object({
  items: z
    .array(z.string().uuid())
    .max(maxGalleryItems)
    .refine((list) => new Set(list).size === list.length, "items must be unique"),
});

/** Used bytes in all and by what; `limit` is the account's quota. */
export interface StorageUsage {
  used: number;
  limit: number;
  saves: number;
  media: number;
}

export interface SaveVersionView {
  id: string;
  version: number;
  size: number;
  sha256: string;
  device: string | null;
  launcherVersion: string | null;
  createdAt: string;
  /** A signed link to the archive, good for an hour. */
  download: string;
}

export interface SaveSlotView {
  id: string;
  titleId: string;
  /** The game's name when the catalogue knows it. */
  game: string | null;
  slot: string;
  updatedAt: string;
  /** Newest first, at most three. */
  versions: SaveVersionView[];
}

/** A save version dropped to keep three per slot or to make room in the quota. */
export interface DroppedVersion {
  id: string;
  version: number;
  size: number;
  reason: "kept" | "quota" | "replaced";
}

export interface MediaView {
  id: string;
  kind: MediaKind;
  contentType: string;
  /** Bytes it takes from the quota: the file, its thumbnail and its poster. */
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Signed links that expire; refetch the list or message for new ones. */
  url: string;
  thumb: string | null;
  poster: string | null;
  /** Hidden by a moderator: only its owner still sees it. */
  hidden?: boolean;
  /** Its place in the owner's profile gallery, when pinned. */
  gallery?: number | null;
  createdAt: string;
}

/** Media in a message as a member sees it: the media, or why it is not there. */
export type AttachmentView =
  | ({ removed?: false; blocked?: false } & MediaView)
  | { id: string; kind: MediaKind; removed: true }
  | { id: string; kind: MediaKind; blocked: true };

/** GET /storage, for anyone: whether this server keeps files, and its limits. */
export interface StorageInfo {
  enabled: boolean;
  quota: number;
  saveMax: number;
  saveVersions: number;
  partSize: number;
  media: typeof mediaLimits;
  galleryMax: number;
}
