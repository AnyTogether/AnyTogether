import { Avatar } from "@/components/Avatar";
import { ChallengeActions, ChallengeTrack, MetricGlyph } from "@/components/Challenges";
import { GameMark } from "@/components/DiscoverCards";
import { type ChallengeDetail, type Standing, challengeValue, untilText } from "@/lib/challenges";
import { since } from "@/lib/feed";
import { localName } from "@/lib/games";
import { type Strings, strings, ui } from "@/lib/i18n";
import { type Person, fill } from "@/lib/people";
import { localArt } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const found = uuid.test(id) ? (await apiJson<ChallengeDetail>(`/challenges/${id}`)).body : null;
  const texts = await strings();
  return { title: `${found?.title ?? texts.challenges} · AnyTogether` };
}

/** One challenge: the game and what counts, the window as a track, the standings, and joining. */
export default async function ChallengePage({ params }: Params) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=/challenges/${id}`);
  const [found, friends] = await Promise.all([
    apiJson<ChallengeDetail>(`/challenges/${id}`),
    apiJson<{ friends: Person[] }>("/me/friends"),
  ]);
  const challenge = found.body;
  if (!challenge) notFound();
  const { language } = texts;
  const t = ui(texts);
  const gameName = localName(challenge.game.names, language) || challenge.game.titleId;
  const value = (n: number) => challengeValue(challenge.metric, n, texts, language);
  const ended = challenge.state === "ended";
  const audience =
    challenge.audience === "community" && challenge.community
      ? fill(texts.challengeFor_community, { community: challenge.community.name })
      : texts[`challengeFor_${challenge.audience}`];
  const when =
    challenge.state === "cancelled"
      ? texts.state_cancelled
      : fill(texts[`state_${challenge.state}`], {
          when: untilText(challenge.state === "upcoming" ? challenge.startsAt : challenge.endsAt, language),
        });

  return (
    <section className="page challenge">
      <nav className="crumbs in d1">
        <Link href="/challenges">{texts.challenges}</Link>
        <Link href={`/leaderboards?game=${challenge.game.titleId}`}>{gameName}</Link>
      </nav>
      <article className={`card raise ch-hero in d1 state-${challenge.state}`}>
        <div className="ch-head">
          <GameMark game={challenge.game} titleId={challenge.game.titleId} language={language} big />
          <div className="lines">
            <span className="ch-kicker">
              <MetricGlyph metric={challenge.metric} />
              {fill(texts[`rowMeta_${challenge.metric}`], { game: gameName })}
            </span>
            <h2>{challenge.title}</h2>
            <span className="meta ch-facts">
              {challenge.state === "active" && <span className="chip live">{texts.challengeLive}</span>}
              {challenge.state === "cancelled" && (
                <span className="chip cancelled">{texts.state_cancelled}</span>
              )}
              {ended && (
                <span className="chip">
                  {challenge.final ? texts.challengeFinal : texts.challengeCounting}
                </span>
              )}
              <span>{when}</span>
            </span>
          </div>
        </div>
        {challenge.description && <p className="community-desc">{challenge.description}</p>}
        <ChallengeTrack challenge={challenge} texts={t} />
        <p className="hint ch-who">
          {challenge.community && (
            <img className="ch-community" src={localArt(challenge.community.iconUrl) ?? ""} alt="" />
          )}
          <span>{audience}</span>
          {challenge.creator && (
            <span>{fill(texts.challengeBy, { name: challenge.creator.displayName })}</span>
          )}
          <span>{fill(texts.entrantsN, { n: challenge.entrants })}</span>
        </p>
        <ChallengeActions challenge={challenge} texts={t} friends={friends.body?.friends ?? []} />
      </article>

      {ended && challenge.leader && <Winner standing={challenge.leader} texts={texts} value={value} />}

      {challenge.myStanding && (
        <article className="card my-rank in d2">
          <span className="sub">{texts.yourPlace}</span>
          <div className="my-rank-row">
            <b className="my-rank-n">#{challenge.myStanding.rank}</b>
            <div className="lines">
              <span className="name">
                {fill(texts.placeOf, { rank: challenge.myStanding.rank, n: challenge.entrants })}
              </span>
              <span className="meta">{value(challenge.myStanding.value)}</span>
            </div>
          </div>
        </article>
      )}

      <article className="card in d3">
        <h3 className="sub">
          {texts.standingsTitle} <span className="n">{challenge.entrants}</span>
        </h3>
        {challenge.state === "upcoming" ? (
          <>
            <p className="empty">{texts.standingsBefore}</p>
            <Rows standings={challenge.standings} texts={texts} value={null} />
          </>
        ) : challenge.standings.length === 0 ? (
          <p className="empty">{texts.standingsEmpty}</p>
        ) : (
          <>
            <Rows standings={challenge.standings} texts={texts} value={value} />
            {challenge.around.length > 0 && (
              <>
                <div className="board-gap" aria-hidden="true">
                  ···
                </div>
                <Rows standings={challenge.around} texts={texts} value={value} />
              </>
            )}
            <p className="board-updated meta">
              {fill(texts.updated, { when: since(challenge.updatedAt, language) })}
            </p>
          </>
        )}
        <p className="hint ch-note">{texts.finalNote}</p>
      </article>
    </section>
  );
}

function Winner({
  standing,
  texts,
  value,
}: {
  standing: Standing;
  texts: Strings;
  value: (n: number) => string;
}) {
  return (
    <article className="card ch-winner in d2">
      <span className="ch-medal" aria-hidden="true">
        1
      </span>
      {standing.user ? (
        <Avatar person={standing.user} size={52} />
      ) : (
        <span className="avatar system" style={{ "--size": "52px" } as React.CSSProperties} />
      )}
      <span className="lines">
        <span className="sub">{texts.winnerLabel}</span>
        <span className="name">{standing.user?.displayName ?? texts.hiddenPlayer}</span>
        <span className="meta">{value(standing.value)}</span>
      </span>
    </article>
  );
}

function Rows({
  standings,
  texts,
  value,
}: {
  standings: Standing[];
  texts: Strings;
  /** Null before the start: only who is in it. */
  value: ((n: number) => string) | null;
}) {
  return (
    <ol className="board">
      {standings.map((row, index) => (
        <li
          key={row.user?.userId ?? `hidden-${index}`}
          className={`board-row${row.me ? " me" : ""}${value && row.rank <= 3 && row.value > 0 ? ` top top-${row.rank}` : ""}`}
        >
          <span className="board-rank">{value ? row.rank : "–"}</span>
          {row.user ? (
            <Link href={`/u/${row.user.handle}`} className="who">
              <Avatar person={row.user} size={34} />
              <span className="lines">
                <span className="name">
                  {row.user.displayName}
                  {row.me && <span className="tag you-tag">{texts.you}</span>}
                </span>
                <span className="meta">@{row.user.handle}</span>
              </span>
            </Link>
          ) : (
            <span className="who">
              <span className="avatar system" style={{ "--size": "34px" } as React.CSSProperties} />
              <span className="lines">
                <span className="name hidden-player">{texts.hiddenPlayer}</span>
              </span>
            </span>
          )}
          {value && <span className="board-value">{value(row.value)}</span>}
        </li>
      ))}
    </ol>
  );
}
