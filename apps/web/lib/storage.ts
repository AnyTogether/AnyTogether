/** Cloud saves and media as the API shows them (the website keeps its own copy of the shapes),
 *  and the small sums the pages make with them. */

export type MediaKind = "image" | "clip" | "voice";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  thumb: string | null;
  poster: string | null;
  hidden?: boolean;
  gallery?: number | null;
  createdAt: string;
}

/** Media in a message: the media, or why it is not there. */
export type Attachment =
  | MediaItem
  | { id: string; kind: MediaKind; removed: true }
  | { id: string; kind: MediaKind; blocked: true };

export const isShown = (a: Attachment): a is MediaItem => !("removed" in a) && !("blocked" in a);

export interface StorageUsage {
  used: number;
  limit: number;
  saves: number;
  media: number;
}

export interface SaveVersion {
  id: string;
  version: number;
  size: number;
  sha256: string;
  device: string | null;
  launcherVersion: string | null;
  createdAt: string;
  download: string;
}

export interface SaveSlot {
  id: string;
  titleId: string;
  game: string | null;
  slot: string;
  updatedAt: string;
  versions: SaveVersion[];
}

export interface StorageLimits {
  quota: number;
  saveMax: number;
  saveVersions: number;
  media: { image: number; clip: number; voice: number; poster: number; voiceMs: number };
  galleryMax: number;
}

export interface StorageInfo extends Partial<StorageLimits> {
  enabled: boolean;
}

export interface StorageOverview {
  enabled: true;
  limits: StorageLimits;
  usage: StorageUsage;
  saves: SaveSlot[];
  media: MediaItem[];
  next: string | null;
}

/** "840 KB", "12.4 MB", "100 MB": the reader's number style, binary units as the quota counts. */
export function formatBytes(bytes: number, locale = "en") {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 || Number.isInteger(value) ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${units[unit]}`;
}

/** "0:07", "1:00": a voice note or clip's length. */
export function formatDuration(ms: number | null | undefined) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The usage bar's parts as percentages of the quota (never past 100 together), and how full it is. */
export function usageParts(usage: StorageUsage) {
  const of = (bytes: number) => (usage.limit > 0 ? Math.min(100, (bytes / usage.limit) * 100) : 0);
  const saves = of(usage.saves);
  const media = Math.min(100 - saves, of(usage.media));
  const used = usage.limit > 0 ? usage.used / usage.limit : 0;
  return {
    saves,
    media,
    free: Math.max(0, 100 - saves - media),
    level: used >= 0.95 ? "full" : used >= 0.8 ? "high" : "ok",
  } as const;
}

/** Which kind of media a picked or dropped file is, by its type; null when it is none we take. */
export function kindOfFile(file: { type: string; name?: string }): "image" | "clip" | null {
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "image";
  if (file.type === "video/mp4" || (!file.type && /\.mp4$/i.test(file.name ?? ""))) return "clip";
  return null;
}

/** The recording format this browser can make for a voice note, in the order the API prefers. */
export function voiceFormat(supported: (type: string) => boolean) {
  return (
    ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find(
      supported,
    ) ?? null
  );
}

/** Saves grouped by game, the most recently changed game first. */
export function savesByGame(slots: SaveSlot[]) {
  const games = new Map<
    string,
    { titleId: string; game: string | null; slots: SaveSlot[]; size: number; updatedAt: string }
  >();
  for (const slot of slots) {
    const entry = games.get(slot.titleId) ?? {
      titleId: slot.titleId,
      game: slot.game,
      slots: [],
      size: 0,
      updatedAt: slot.updatedAt,
    };
    entry.slots.push(slot);
    entry.size += slot.versions.reduce((sum, v) => sum + v.size, 0);
    if (slot.updatedAt > entry.updatedAt) entry.updatedAt = slot.updatedAt;
    games.set(slot.titleId, entry);
  }
  return [...games.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Uploads a photo, clip or voice note through the website, telling how far it got. */
export function uploadMedia(
  file: Blob,
  kind: MediaKind,
  onProgress?: (fraction: number) => void,
): Promise<{
  ok: boolean;
  status: number;
  body: { media?: MediaItem; usage?: StorageUsage; code?: string; title?: string };
}> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/me/upload?kind=${kind}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, body: {} });
    xhr.send(file);
  });
}

/** A still from a clip for its poster: the frame at a quarter second (or its middle, if shorter),
 *  as a JPEG no wider than 1280 px; null when the browser cannot decode it. */
export async function posterOf(file: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("no video"));
    });
    video.currentTime = Math.min(0.25, (video.duration || 0.5) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720) * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.84));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A few bar heights for a voice note's picture, the same every time for the same note. */
export function waveform(seed: string, bars = 28) {
  let state = 0;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    state = (state * 1103515245 + 12345) >>> 0;
    const base = 0.35 + ((state >>> 8) % 1000) / 1600;
    // Softer at both ends, like speech starting and stopping.
    const edge = Math.min(1, (i + 1) / 4, (bars - i) / 4);
    return Math.max(0.18, Math.min(1, base * edge));
  });
}
