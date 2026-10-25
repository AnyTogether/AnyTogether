/** The trophy level: one number from all the trophy points someone has earned (bronze 15, silver
 *  30, gold 90, platinum 300), on the curve PlayStation uses since 2020. Each level costs the points
 *  of its band; level 1 is where everyone starts and 999 is the top. */
export const maxTrophyLevel = 999;

/** Points it takes to go up one level from a level in each band. */
export const levelBands = [
  { from: 1, points: 60 },
  { from: 100, points: 90 },
  { from: 200, points: 450 },
  { from: 300, points: 900 },
  { from: 400, points: 1350 },
  { from: 500, points: 1800 },
  { from: 600, points: 2250 },
  { from: 700, points: 2700 },
  { from: 800, points: 3150 },
  { from: 900, points: 3600 },
] as const;

/** The tier a level is drawn in: bronze 1-99, silver 100-299, gold 300-599, platinum 600-999. */
export const levelTiers = ["bronze", "silver", "gold", "platinum"] as const;
export type LevelTier = (typeof levelTiers)[number];

export function levelTier(level: number): LevelTier {
  if (level >= 600) return "platinum";
  if (level >= 300) return "gold";
  if (level >= 100) return "silver";
  return "bronze";
}

/** The frame around the level changes every 100 levels: 1 for 1-99, 2 for 100-199 … 10 for
 *  900-999. */
export const levelFrame = (level: number) => Math.min(10, Math.floor(level / 100) + 1);

/** The points a level starts at. */
export function levelStart(level: number): number {
  const target = Math.max(1, Math.min(maxTrophyLevel, Math.floor(level)));
  let points = 0;
  for (let index = 0; index < levelBands.length; index++) {
    const band = levelBands[index] as (typeof levelBands)[number];
    const next = levelBands[index + 1]?.from ?? maxTrophyLevel;
    if (target <= band.from) break;
    points += (Math.min(target, next) - band.from) * band.points;
  }
  return points;
}

/** A level as a badge: the number, its tier and frame. */
export interface LevelBadge {
  level: number;
  tier: LevelTier;
  frame: number;
}

/** A level with the way to the next one. */
export interface TrophyLevel extends LevelBadge {
  /** All trophy points. */
  points: number;
  /** Where this level started and where the next one starts (null at the top). */
  levelPoints: number;
  nextLevelPoints: number | null;
  /** How far towards the next level, 0-99 (100 at the top). */
  progress: number;
}

export function levelOf(points: number): number {
  const total = Math.max(0, Math.floor(points));
  let level = 1;
  let start = 0;
  for (let index = 0; index < levelBands.length; index++) {
    const band = levelBands[index] as (typeof levelBands)[number];
    const end = levelBands[index + 1]?.from ?? maxTrophyLevel;
    const steps = end - band.from;
    if (total < start + steps * band.points) return band.from + Math.floor((total - start) / band.points);
    start += steps * band.points;
    level = end;
  }
  return Math.min(level, maxTrophyLevel);
}

export const levelBadge = (level: number): LevelBadge => ({
  level,
  tier: levelTier(level),
  frame: levelFrame(level),
});

export function trophyLevelOf(points: number): TrophyLevel {
  const total = Math.max(0, Math.floor(points));
  const level = levelOf(total);
  const levelPoints = levelStart(level);
  const nextLevelPoints = level >= maxTrophyLevel ? null : levelStart(level + 1);
  return {
    ...levelBadge(level),
    points: total,
    levelPoints,
    nextLevelPoints,
    progress:
      nextLevelPoints === null
        ? 100
        : Math.min(99, Math.floor(((total - levelPoints) * 100) / (nextLevelPoints - levelPoints))),
  };
}

/** The same curve in SQL over a points expression, for working levels out in the database (the
 *  migration that first filled them in has this expression written out). */
export function trophyLevelSql(points: string) {
  const parts: string[] = [];
  let start = 0;
  levelBands.forEach((band, index) => {
    const end = levelBands[index + 1]?.from ?? maxTrophyLevel;
    const limit = start + (end - band.from) * band.points;
    parts.push(`when ${points} < ${limit} then ${band.from} + (${points} - ${start}) / ${band.points}`);
    start = limit;
  });
  return `(case ${parts.join(" ")} else ${maxTrophyLevel} end)`;
}
