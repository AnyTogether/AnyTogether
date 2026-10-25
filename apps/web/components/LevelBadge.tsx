import { fill } from "@/lib/people";
import type { LevelBadgeData, TrophyLevel } from "@/lib/psn";

type LevelTexts = {
  levelLabel: string;
  levelNext: string;
  levelTop: string;
  levelPoints: string;
  trophyLevel: string;
  tier_bronze: string;
  tier_silver: string;
  tier_gold: string;
  tier_platinum: string;
};

/** The hexagon a level sits in: its tier's metal, and a frame that grows every 100 levels (an
 *  inner ring from 100, a crest from 300, a star from 600, a halo at 900). */
function Frame({ level }: { level: LevelBadgeData }) {
  const { frame } = level;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="lvl-frame">
      <path className="lvl-hex" d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25z" />
      {frame >= 2 && <path className="lvl-ring" d="M16 6.2 24.5 11.1v9.8L16 25.8 7.5 20.9v-9.8z" />}
      {frame >= 4 && <path className="lvl-crest" d="M12.5 3.9 16 1.2l3.5 2.7" />}
      {frame >= 7 && (
        <path className="lvl-star" d="M16 .2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L13.1 2.3l2-.3z" />
      )}
      {frame >= 10 && <circle className="lvl-halo" cx="16" cy="16" r="15" />}
    </svg>
  );
}

/** A small level chip for lists: the number in its tier's hexagon. */
export function LevelBadge({
  level,
  texts,
  size = "small",
}: {
  level: LevelBadgeData | null | undefined;
  texts: Pick<LevelTexts, "levelLabel">;
  size?: "small" | "big";
}) {
  if (!level) return null;
  const label = fill(texts.levelLabel, { n: level.level });
  return (
    <span
      className={`lvl ${size} t-${level.tier} f-${level.frame}${level.level >= 100 ? " d3" : ""}`}
      title={label}
      role="img"
      aria-label={label}
    >
      <Frame level={level} />
      <b>{level.level}</b>
    </span>
  );
}

/** The level on a profile: the badge, its tier, and how far to the next one. */
export function LevelCard({
  level,
  texts,
  language,
}: { level: TrophyLevel; texts: LevelTexts; language: string }) {
  const number = new Intl.NumberFormat(language);
  const tier = texts[`tier_${level.tier}`];
  return (
    <div className={`level-card t-${level.tier}`}>
      <LevelBadge level={level} texts={texts} size="big" />
      <div className="lines">
        <span className="level-title">
          {texts.trophyLevel} <b>{number.format(level.level)}</b>
          <span className="level-tier">{tier}</span>
        </span>
        <span className="level-bar" aria-hidden="true">
          <i style={{ width: `${level.progress}%` }} />
        </span>
        <span className="meta">
          {level.nextLevelPoints === null
            ? texts.levelTop
            : fill(texts.levelNext, {
                n: number.format(level.nextLevelPoints - level.points),
                level: number.format(level.level + 1),
              })}
          {" · "}
          {fill(texts.levelPoints, { n: number.format(level.points) })}
        </span>
      </div>
    </div>
  );
}
