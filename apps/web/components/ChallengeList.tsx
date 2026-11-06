import { MetricGlyph } from "@/components/Challenges";
import { GameMark } from "@/components/DiscoverCards";
import { type Challenge, challengeValue, progressOf, untilText } from "@/lib/challenges";
import { localName } from "@/lib/games";
import type { Strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import Link from "next/link";

/** Challenges as rows: the game, the name, what counts and when, the leader and the reader's place. */
export function ChallengeList({ challenges, texts }: { challenges: Challenge[]; texts: Strings }) {
  return (
    <ul className="ch-list">
      {challenges.map((challenge) => (
        <li key={challenge.id}>
          <ChallengeRow challenge={challenge} texts={texts} />
        </li>
      ))}
    </ul>
  );
}

function ChallengeRow({ challenge, texts }: { challenge: Challenge; texts: Strings }) {
  const { language } = texts;
  const gameName = localName(challenge.game.names, language) || challenge.game.titleId;
  const when =
    challenge.state === "cancelled"
      ? texts.state_cancelled
      : fill(texts[`state_${challenge.state}`], {
          when: untilText(challenge.state === "upcoming" ? challenge.startsAt : challenge.endsAt, language),
        });
  const value = (n: number) => challengeValue(challenge.metric, n, texts, language);
  const share = progressOf(challenge);
  return (
    <Link href={`/challenges/${challenge.id}`} className={`ch-row state-${challenge.state}`}>
      <GameMark game={challenge.game} titleId={challenge.game.titleId} language={language} />
      <span className="lines">
        <span className="name">
          {challenge.title}
          {challenge.state === "active" && <span className="chip live">{texts.challengeLive}</span>}
          {challenge.state === "ended" && challenge.final && (
            <span className="chip">{texts.challengeFinal}</span>
          )}
        </span>
        <span className="meta">
          <MetricGlyph metric={challenge.metric} />
          {fill(texts[`rowMeta_${challenge.metric}`], { game: gameName })}
        </span>
        <span className="ch-mini" aria-hidden="true">
          <span style={{ "--share": challenge.state === "upcoming" ? 0 : share } as React.CSSProperties} />
        </span>
        <span className="meta">{when}</span>
      </span>
      <span className="ch-side">
        {challenge.myStanding && challenge.myStanding.value > 0 ? (
          <>
            <b className="ch-place">#{challenge.myStanding.rank}</b>
            <span className="meta">{value(challenge.myStanding.value)}</span>
          </>
        ) : challenge.leader ? (
          <>
            <span className="meta">
              {challenge.state === "ended" ? texts.winnerLabel : texts.leaderLabel}
            </span>
            <span className="ch-leader">{challenge.leader.user?.displayName ?? texts.hiddenPlayer}</span>
          </>
        ) : (
          <span className="meta">{fill(texts.entrantsN, { n: challenge.entrants })}</span>
        )}
      </span>
    </Link>
  );
}
