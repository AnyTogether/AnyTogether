import { Avatar } from "@/components/Avatar";
import { CaptureGrid } from "@/components/Captures";
import { CommunityRow } from "@/components/Communities";
import { CompatVerdict } from "@/components/CompatVerdict";
import { LfgComposer, RefreshOn } from "@/components/Discover";
import { GameMark, LfgCard, PartyRow, PersonRow, ShareRow, gameName } from "@/components/DiscoverCards";
import { ThemeTile } from "@/components/ThemeTile";
import { type CompatGame, compatPlatforms } from "@/lib/compat";
import type { Discovery, Hub } from "@/lib/discover";
import type { Board } from "@/lib/feed";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill, playedFor } from "@/lib/people";
import type { PostPage } from "@/lib/posts";
import { apiJson, currentUser, publicJson } from "@/lib/session";
import type { ThemePage } from "@/lib/themes";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ titleId: string }> };

const titleOf = (raw: string) => {
  const id = decodeURIComponent(raw).toUpperCase();
  return /^[A-Z]{4}[0-9]{5}$/.test(id) ? id : null;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = titleOf((await params).titleId);
  const hub = id ? (await apiJson<Hub>(`/games/${id}/hub`)).body : null;
  const name = hub ? localName(hub.game.names, "en") || hub.game.titleId : (id ?? "Game");
  return { title: `${name} · AnyTogether` };
}

/** One game's hub: who plays it now, open posts, public parties and share plays, the top players,
 *  how it runs, players who show it, and themes named after it. */
export default async function GameHub({ params }: Params) {
  const id = titleOf((await params).titleId);
  if (!id) notFound();
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=/games/${id}`);
  const [hub, board, compat, discovery, captures] = await Promise.all([
    apiJson<Hub>(`/games/${id}/hub`),
    apiJson<Board>(`/games/${id}/leaderboard?by=points&scope=global&limit=5`),
    publicJson<CompatGame>(`/compat/${id}`),
    apiJson<Discovery>("/me/discovery"),
    apiJson<PostPage>(`/games/${id}/posts?limit=12`),
  ]);
  if (!hub.body) notFound();
  const { game, playing, lfg, parties, sharePlays, recentPlayers, players } = hub.body;
  const communities = hub.body.communities ?? [];
  const { language } = texts;
  const t = ui(texts);
  const now = Date.now();
  const name = gameName(game, game.titleId, language);
  const themes =
    name !== game.titleId
      ? (await publicJson<ThemePage>(`/themes?q=${encodeURIComponent(name)}&sort=popular&limit=4`)).body
      : null;
  const top = (board.body?.entries ?? []).slice(0, 5);
  const number = new Intl.NumberFormat(language);

  return (
    <section className="page find game-hub">
      <RefreshOn
        topics={[`lfg:${id}`, `discover:${id}`]}
        events={["lfg.changed", "lfg.request", "lfg.answered", "discover.changed"]}
      />
      <nav className="crumbs in d1">
        <Link href="/find">{texts.findPlayers}</Link>
      </nav>
      <div className="hub-title in d1">
        <GameMark game={game} titleId={game.titleId} language={language} big />
        <div className="lines">
          <h2>{name}</h2>
          <span className="meta">
            {game.titleId} · {fill(texts.playersTotal, { n: number.format(players) })}
          </span>
        </div>
        <LfgComposer
          texts={t}
          games={[{ titleId: game.titleId, name }]}
          defaultLanguages={discovery.body?.languages.length ? discovery.body.languages : [language]}
          defaultGame={game.titleId}
        />
      </div>

      <article className="card playing-card in d2">
        <h3 className="sub">
          <i className="dot" />
          {texts.playingNow} <span className="n">{playing.total}</span>
        </h3>
        {playing.people.length === 0 ? (
          <p className="hint empty">{texts.noPlayingNow}</p>
        ) : (
          <ul className="playing-row">
            {playing.people.map(({ user: person, since }) => (
              <li key={person.userId}>
                <Link href={`/u/${person.handle}`} className="playing-face" title={person.displayName}>
                  <Avatar person={person} size={44} presence="in_game" />
                  <span className="playing-name">{person.displayName.split(" ")[0]}</span>
                  <span className="meta">{playedFor(since ?? undefined, now, texts) ?? "·"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </article>

      <div className="hub-grid in d3">
        <div className="hub-main">
          <div className="lfg-section">
            <div className="card-head">
              <h3 className="sub">
                {texts.hubBoard} <span className="n">{lfg.length}</span>
              </h3>
              <Link href={`/find?game=${id}`} className="quiet-link">
                {texts.seeAll}
              </Link>
            </div>
            {lfg.length === 0 ? (
              <p className="card empty-card">{texts.noHubPosts}</p>
            ) : (
              <div className="lfg-list">
                {lfg.map((post) => (
                  <LfgCard key={post.id} post={post} texts={texts} ui={t} now={now} showGame={false} />
                ))}
              </div>
            )}
          </div>

          {captures.body && (
            <article className="card cap-game-card">
              <div className="card-head">
                <h3 className="sub">
                  {texts.capGameSection}{" "}
                  {captures.body.items.length > 0 && <span className="n">{captures.body.items.length}</span>}
                </h3>
                <Link href="/captures" className="quiet-link">
                  {texts.capShare}
                </Link>
              </div>
              <CaptureGrid
                texts={t}
                initial={captures.body}
                source={{ kind: "game", titleId: id }}
                empty={<p className="empty">{texts.capEmptyGame}</p>}
              />
            </article>
          )}

          <article className="card">
            <h3 className="sub">
              {texts.hubLists} <span className="n">{parties.length + sharePlays.length}</span>
            </h3>
            {parties.length + sharePlays.length === 0 ? (
              <p className="hint empty">{texts.noHubLists}</p>
            ) : (
              <ul className="people">
                {sharePlays.map((share) => (
                  <ShareRow key={share.id} share={share} texts={texts} ui={t} />
                ))}
                {parties.map((party) => (
                  <PartyRow key={party.id} party={party} texts={texts} ui={t} />
                ))}
              </ul>
            )}
          </article>

          <article className="card">
            <div className="card-head">
              <h3 className="sub">
                {texts.communities} <span className="n">{communities.length}</span>
              </h3>
              <Link href={`/communities?game=${id}`} className="quiet-link">
                {texts.seeAll}
              </Link>
            </div>
            {communities.length === 0 ? (
              <p className="hint empty">{texts.noCommunities}</p>
            ) : (
              <ul className="community-list">
                {communities.map((community) => (
                  <li key={community.id}>
                    <CommunityRow community={community} texts={t} />
                  </li>
                ))}
              </ul>
            )}
          </article>

          {recentPlayers.length > 0 && (
            <article className="card">
              <div className="card-head">
                <h3 className="sub">{texts.hubPlayers}</h3>
                <Link href={`/find/people?game=${id}`} className="quiet-link">
                  {texts.seeAll}
                </Link>
              </div>
              <ul className="people">
                {recentPlayers.map((card) => (
                  <PersonRow key={card.user.userId} card={card} texts={texts} ui={t} now={now} />
                ))}
              </ul>
            </article>
          )}
        </div>

        <aside className="hub-side">
          <article className="card">
            <div className="card-head">
              <h3 className="sub">{texts.hubTop}</h3>
              <Link href={`/leaderboards?game=${id}&scope=global`} className="quiet-link">
                {texts.seeAll}
              </Link>
            </div>
            {top.length === 0 ? (
              <p className="hint empty">{texts.noHubTop}</p>
            ) : (
              <ol className="board hub-board">
                {top.map((entry) => (
                  <li
                    key={entry.user.userId}
                    className={`board-row${entry.rank <= 3 ? ` top top-${entry.rank}` : ""}`}
                  >
                    <span className="board-rank">{entry.rank}</span>
                    <Link href={`/u/${entry.user.handle}`} className="who">
                      <Avatar person={entry.user} size={28} />
                      <span className="lines">
                        <span className="name">{entry.user.displayName}</span>
                      </span>
                    </Link>
                    <span className="board-value">
                      {fill(texts.pointsValue, { n: number.format(entry.value) })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </article>

          <article className="card compat">
            <div className="card-head">
              <h3 className="sub">{texts.hubCompat}</h3>
              <Link href={`/compatibility/${id}`} className="quiet-link">
                {texts.seeAll}
              </Link>
            </div>
            <div className="verdict-stack">
              {compatPlatforms.map((platform) => (
                <CompatVerdict
                  key={platform}
                  platform={platform}
                  summary={compat.body?.platforms[platform]}
                  texts={texts}
                />
              ))}
            </div>
          </article>
        </aside>
      </div>

      {themes && themes.themes.length > 0 && (
        <div className="hub-themes in d4">
          <h3 className="sub">{texts.hubThemes}</h3>
          <ul className="theme-grid">
            {themes.themes.map((theme) => (
              <ThemeTile key={theme.id} theme={theme} texts={texts} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
