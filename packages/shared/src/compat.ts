import { z } from "zod";
import { TitleId, platforms } from "./games.js";
import { hasLink } from "./profile.js";

/** How far a game gets, worst to best: nothing happens, it boots, reaches its menus, plays but
 *  with problems in game, or is playable to the end. */
export const compatStatuses = ["nothing", "boots", "menus", "ingame", "playable"] as const;
export type CompatStatus = (typeof compatStatuses)[number];
export type CompatPlatform = (typeof platforms)[number];

/** Whether the game's own online play worked through the launchers, as the reporter saw it. */
export const compatOnline = ["works", "broken"] as const;
export type CompatOnline = (typeof compatOnline)[number];

/** How the list is ordered: the latest report first (the default), by name, or best status first. */
export const compatSorts = ["updated", "name", "status"] as const;
export type CompatSort = (typeof compatSorts)[number];

export const compatPageSize = 30;
export const maxCompatPage = 100;

const Version = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\w.+-]+$/, "a version like 0.2.13");
const Line = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

/** A report on how a game runs, from the launcher after a session (opt-in) or from the website. */
export const CompatReport = z.object({
  titleId: TitleId,
  /** The game's name, taught to the catalogue if it has none yet. */
  name: Line(200).pipe(z.string().min(1)).optional(),
  platform: z.enum(platforms),
  status: z.enum(compatStatuses),
  /** The launcher's version ("0.2.13") and the engine's ("0.2.13-arm"). */
  launcherVersion: Version,
  engineVersion: Version.optional(),
  /** The Mac model, or the CPU and GPU. */
  machine: Line(120).optional(),
  /** The OS and its version: "macOS 26.1". */
  os: Line(60).optional(),
  fpsAvg: z.number().min(0).max(1000).optional(),
  /** Online play with others, if it was tried. */
  online: z.enum(compatOnline).optional(),
  /** The game's own version, if the launcher knows it. */
  gameVersion: z.string().trim().max(20).optional(),
  note: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(500))
    .refine((value) => !hasLink(value), "no links")
    .optional(),
});
export type CompatReport = z.infer<typeof CompatReport>;

/** The verdict on one platform: what the newest launcher version tested reached. */
export interface CompatSummary {
  status: CompatStatus;
  version: string;
  testedAt: string;
  reports: number;
  /** What most reporters said about online play (each person's latest that says), a tie going
   *  to works; null when nobody tried it on this platform. */
  online: CompatOnline | null;
}

export interface CompatGame {
  titleId: string;
  name: string | null;
  names: Record<string, string>;
  iconUrl: string | null;
  platforms: Partial<Record<CompatPlatform, CompatSummary>>;
}

export interface CompatReportView {
  id: string;
  platform: CompatPlatform;
  status: CompatStatus;
  launcherVersion: string;
  engineVersion: string | null;
  gameVersion: string | null;
  machine: string | null;
  os: string | null;
  fpsAvg: number | null;
  online: CompatOnline | null;
  note: string | null;
  createdAt: string;
  mine: boolean;
}

/** Version strings compared by their numbers: 0.2.13 > 0.2.9, 1.0 > 0.9.9. */
export function compareVersions(a: string, b: string) {
  const parts = (value: string) => (value.match(/\d+/g) ?? []).map(Number);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
