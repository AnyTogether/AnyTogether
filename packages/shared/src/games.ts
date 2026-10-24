import { z } from "zod";

/** A PlayStation title ID: four capitals and five digits ("PPSA01234"). */
export const TitleId = z.string().regex(/^[A-Z]{4}[0-9]{5}$/, "a title ID like PPSA01234");
/** The hash of a game's trophy file, as the launcher computes it. */
export const SetHash = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/, "a trophy set hash");
/** A language tag: "en", "tr", "pt-BR". */
const Language = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "a language like en or pt-BR");

export const platforms = ["macos", "windows", "linux"] as const;
export const grades = ["bronze", "silver", "gold", "platinum"] as const;
export type Grade = (typeof grades)[number];
export const sessionExits = ["normal", "crashed", "killed"] as const;

/** Points per grade, summed into the library and leaderboards. */
export const trophyPoints: Record<Grade, number> = { bronze: 15, silver: 30, gold: 90, platinum: 300 };

/** Teaching the catalogue: names per language, and the icon if the launcher has one. */
export const GameTeach = z.object({
  names: z
    .record(Language, z.string().trim().min(1).max(200))
    .refine((names) => Object.keys(names).length > 0, "at least one name"),
  iconUrl: z.string().url().startsWith("https://").max(500).optional(),
});

/** This computer, by the launcher's own random ID. */
export const DeviceRegister = z.object({
  id: z.string().uuid(),
  platform: z.enum(platforms),
  name: z.string().trim().min(1).max(60),
  model: z.string().trim().max(120).optional(),
});

/** Batches from the launcher's outbox: at most 200 items, each checked on its own. */
export const maxBatch = 200;
const items = z.array(z.unknown()).min(1).max(maxBatch);
export const SessionBatch = z.object({ sessions: items });
export const TrophyBatch = z.object({ trophies: items });

export const PlaySession = z
  .object({
    id: z.string().uuid(),
    titleId: TitleId,
    deviceId: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    exit: z.enum(sessionExits).optional(),
  })
  .refine((s) => Date.parse(s.endedAt) > Date.parse(s.startedAt), "endedAt must be after startedAt");

export const TrophySet = z.object({
  trophies: z
    .array(
      z.object({
        id: z.number().int().min(0).max(9999),
        grade: z.enum(grades),
        hidden: z.boolean().default(false),
        texts: z
          .record(
            Language,
            z.object({
              name: z.string().trim().min(1).max(200),
              detail: z.string().trim().max(500).optional(),
            }),
          )
          .refine((texts) => Object.keys(texts).length > 0, "at least one language"),
      }),
    )
    .min(1)
    .max(1000)
    .refine((list) => new Set(list.map((t) => t.id)).size === list.length, "trophy IDs must be unique"),
});

export const EarnedTrophy = z.object({
  titleId: TitleId,
  setHash: SetHash,
  trophyId: z.number().int().min(0).max(9999),
  earnedAt: z.string().datetime({ offset: true }),
});

/** What happened to each item of a batch, in the order sent. */
export type BatchResult = {
  index: number;
  status: "stored" | "duplicate" | "rejected";
  code?: string;
  detail?: string;
};

export type RarityLabel = "common" | "uncommon" | "rare" | "very_rare" | "ultra_rare";

/** Rarity labels from the share of players who have a trophy (0..1). */
export function rarityLabel(rarity: number | null): RarityLabel | null {
  if (rarity === null) return null;
  if (rarity > 0.5) return "common";
  if (rarity > 0.2) return "uncommon";
  if (rarity > 0.05) return "rare";
  if (rarity >= 0.01) return "very_rare";
  return "ultra_rare";
}
