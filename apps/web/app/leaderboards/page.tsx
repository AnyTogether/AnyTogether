import { Avatar } from "@/components/Avatar";
import { BoardPicker } from "@/components/BoardPicker";
import { LevelBadge } from "@/components/LevelBadge";
import type { Board, BoardEntry, BoardGame, GameBoard, Scope } from "@/lib/feed";
import { since } from "@/lib/feed";
import { localName, totalTime } from "@/lib/games";
import { type Strings, strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.leaderboards);

type Search = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const boards: GameBoard[] = ["points", "time", "completion"];
const scopes: Scope[] = ["friends", "global"];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Overall trophy points, or one game's points, play time or completion; friends or everyone. */
export default async function Leaderboards({ searchParams }: Search) {
  const query = await searchParams;
  const game = /^[A-Z]{4}[0-9]{5}$/.test(one(query.game) ?? "") ? (one(query.game) as string) : "";
  const by = boards.find((b) => b === one(query.by)) ?? "points";
  const scope = scopes.find((s) => s === one(query.scope)) ?? "friends";
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/leaderboards");
  const [board, picker] = await Promise.all([
    apiJson<Board>(
      game ? `/games/${game}/leaderboard?by=${by}&scope=${scope}` : `/leaderboards/points?scope=${scope}`,
    ),
    apiJson<{ games: BoardGame[] }>("/leaderboards/games"),
  ]);
  const games = picker.body?.games ?? [];
  const shown = board.body;
  if (shown?.game && !games.some((g) => g.titleId === shown.game?.titleId))
    games.unshift({ ...shown.game, players: 0, mine: false });
  const href = (change: { game?: string; by?: GameBoard; scope?: Scope }) => {
    const next = { game, by, scope, ...change };
    const params = new URLSearchParams();
    if (next.game) params.set("game", next.game);
    if (next.game && next.by !== "points") params.set("by", next.by);
    if (next.scope !== "friends") params.set("scope", next.scope);
    return `/leaderboards${params.size ? `?${params}` : ""}`;
  };
  const kind = game ? by : "points";
  const { language } = texts;
  const number = new Intl.NumberFormat(language);
  const value = (n: number) =>
    kind === "time"
      ? totalTime(n, texts)
      : kind === "completion"
        ? fill(texts.percentValue, { n })
        : fill(texts.pointsValue, { n: number.format(n) });
  const me = user.account.id;
  const title = shown?.game ? localName(shown.game.names, language) || shown.game.titleId : texts.overall;

  return (
    <section className="page boards">
      <h2 className="in d1">{texts.leaderboards}</h2>
      <p className="lead in d2">{texts.boardsLead}</p>
      <nav className="switch in d2" aria-label={texts.leaderboards}>
        <Link href="/">{texts.home}</Link>
        <Link href="/captures">{texts.captures}</Link>
        <Link href="/leaderboards" aria-current="page">
          {texts.leaderboards}
        </Link>
      </nav>

      <div className="board-controls in d3">
        <BoardPicker games={games} current={game} scope={scope} by={by} texts={texts} />
        <div className="board-toggles">
          {game && (
            <nav className="seg" aria-label={texts.pickGame}>
              {boards.map((b) => (
                <Link key={b} href={href({ by: b })} aria-current={b === by ? "true" : undefined}>
                  {{ points: texts.boardPoints, time: texts.boardTime, completion: texts.boardCompletion }[b]}
                </Link>
              ))}
            </nav>
          )}
          <nav className="seg" aria-label={texts.scopeFriends}>
            {scopes.map((s) => (
              <Link key={s} href={href({ scope: s })} aria-current={s === scope ? "true" : undefined}>
                {s === "friends" ? texts.scopeFriends : texts.scopeGlobal}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {shown && <MyRank board={shown} texts={texts} value={value} kind={kind} />}

      <article className="card in d4">
        <h3 className="sub">
          {title} <span className="n">{shown ? number.format(shown.total) : ""}</span>
        </h3>
        {!shown || shown.entries.length === 0 ? (
          <p className="empty">{scope === "global" ? texts.boardEmptyGlobal : texts.boardEmpty}</p>
        ) : (
          <>
            <Rows entries={shown.entries} me={me} value={value} texts={texts} />
            {shown.around.length > 0 && (
              <>
                <div className="board-gap" aria-hidden="true">
                  ···
                </div>
                <Rows entries={shown.around} me={me} value={value} texts={texts} />
              </>
            )}
            <p className="board-updated meta">
              {fill(texts.updated, { when: since(shown.updatedAt, language) })}
            </p>
          </>
        )}
      </article>
    </section>
  );
}

function MyRank({
  board,
  texts,
  value,
  kind,
}: {
  board: Board;
  texts: Strings;
  value: (n: number) => string;
  kind: "points" | GameBoard;
}) {
  const { me } = board;
  return (
    <article className="card my-rank in d3">
      <span className="sub">{texts.yourRank}</span>
      {me.rank === null ? (
        <p className="empty">{me.value > 0 ? texts.notRanked : texts.nothingToRank}</p>
      ) : (
        <div className="my-rank-row">
          <b className="my-rank-n">#{me.rank}</b>
          <div className="lines">
            <span className="name">
              {me.listed ? fill(texts.ofTotal, { total: board.total }) : texts.notRanked}
            </span>
            <span className="meta">{value(me.value)}</span>
          </div>
        </div>
      )}
      {!me.listed && me.rank !== null && (
        <p className="hint-line">
          {fill(kind === "time" ? texts.wouldBeLibrary : texts.wouldBe, { rank: me.rank })}
        </p>
      )}
    </article>
  );
}

function Rows({
  entries,
  me,
  value,
  texts,
}: {
  entries: BoardEntry[];
  me: string;
  value: (n: number) => string;
  texts: Strings;
}) {
  return (
    <ol className="board">
      {entries.map((entry) => (
        <li
          key={entry.user.userId}
          className={`board-row${entry.user.userId === me ? " me" : ""}${entry.rank <= 3 ? ` top top-${entry.rank}` : ""}`}
        >
          <span className="board-rank">{entry.rank}</span>
          <Link href={`/u/${entry.user.handle}`} className="who">
            <Avatar person={entry.user} size={34} />
            <span className="lines">
              <span className="name">
                {entry.user.displayName}
                <LevelBadge level={entry.level} texts={texts} />
                {entry.user.userId === me && <span className="tag you-tag">{texts.you}</span>}
              </span>
              <span className="meta">@{entry.user.handle}</span>
            </span>
          </Link>
          <span className="board-value">{value(entry.value)}</span>
        </li>
      ))}
    </ol>
  );
}
