import { ShowcaseEditor } from "@/components/ShowcaseEditor";
import type { EarnedTrophy, LibraryGame } from "@/lib/games";
import { ago, localName, rarityPercent, trophyText } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import type { Showcase } from "@/lib/psn";
import Link from "next/link";

const cupPath = "M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8";

/** Pinned trophies and favourite games on a profile; the owner edits them here. Nothing shows to
 *  others when nothing is pinned, or when the parts are private to them. */
export function ProfileShowcase({
  showcase,
  self,
  texts,
  mine,
}: {
  showcase: Showcase;
  self: boolean;
  texts: UiStrings;
  /** For the owner: what they may pin (their latest trophies and their games). */
  mine?: { trophies: EarnedTrophy[]; games: LibraryGame[] };
}) {
  const { language } = texts;
  const trophies = showcase.trophies ?? [];
  const games = showcase.games ?? [];
  if (!self && !trophies.length && !games.length) return null;
  return (
    <article className="card in d3">
      <div className="showcase-head">
        <h3 className="sub">{texts.showcase}</h3>
        {self && mine && (
          <ShowcaseEditor
            texts={texts}
            trophies={mine.trophies}
            games={mine.games}
            pinned={{
              trophies: trophies.map((t) => ({ titleId: t.titleId, trophyId: t.trophyId })),
              games: games.map((g) => g.titleId),
            }}
          />
        )}
      </div>
      {!trophies.length && !games.length && <p className="empty">{texts.showcaseEmptyOwn}</p>}
      {trophies.length > 0 && (
        <ul className="showcase-trophies" aria-label={texts.showcaseTrophies}>
          {trophies.map((trophy) => {
            const text = trophyText(trophy.texts, language);
            return (
              <li key={`${trophy.titleId}/${trophy.trophyId}`} className={`showcase-trophy ${trophy.grade}`}>
                <span
                  className={`cup ${trophy.grade}`}
                  title={texts[`grade_${trophy.grade}`]}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={cupPath} />
                  </svg>
                </span>
                <span className="name">{text?.name ?? texts.hiddenTrophy}</span>
                <span className="meta">{localName(trophy.gameNames, language)}</span>
                <span className="meta">
                  {trophy.rarity !== null
                    ? fill(texts.ofPlayers, { p: rarityPercent(trophy.rarity, language) })
                    : ago(trophy.earnedAt, language)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {games.length > 0 && (
        <ul className="showcase-games" aria-label={texts.showcaseGames}>
          {games.map((game) => (
            <li key={game.titleId}>
              <Link href={`/games/${game.titleId}`} className="showcase-game">
                <span
                  className="game-art"
                  style={game.iconUrl ? { backgroundImage: `url("${game.iconUrl}")` } : undefined}
                  aria-hidden="true"
                >
                  {game.iconUrl ? null : (localName(game.names, language) || game.titleId).slice(0, 1)}
                </span>
                <span className="name">{localName(game.names, language) || game.titleId}</span>
                {game.progress !== null && (
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${game.progress}%` }} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
