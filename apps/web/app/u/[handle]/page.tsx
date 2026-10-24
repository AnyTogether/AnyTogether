import { Avatar } from "@/components/Avatar";
import { FriendAction } from "@/components/FriendAction";
import {
  type EarnedTrophy,
  type LibraryGame,
  ago,
  localName,
  playTime,
  rarityPercent,
  totalTime,
  trophyText,
} from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import type { Profile } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ handle: string }> };

const clean = (handle: string) => decodeURIComponent(handle).replace(/^@/, "").toLowerCase();

async function load(handle: string) {
  if (!/^[a-z0-9_.]{1,40}$/.test(handle)) return null;
  const path = `/users/${encodeURIComponent(handle)}`;
  const [profile, library, trophies] = await Promise.all([
    apiJson<Profile>(path),
    apiJson<{ games: LibraryGame[] }>(`${path}/library`),
    apiJson<{ trophies: EarnedTrophy[] }>(`${path}/trophies`),
  ]);
  if (!profile.body) return null;
  return {
    profile: profile.body,
    games: library.body?.games ?? [],
    trophies: trophies.body?.trophies ?? [],
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const handle = clean((await params).handle);
  return { title: `@${handle} · AnyTogether` };
}

/** A person's card, their games and play time, and the trophies they earned last. */
export default async function UserProfile({ params }: Params) {
  const handle = clean((await params).handle);
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/u/${handle}`)}`);
  const loaded = await load(handle);
  if (!loaded) notFound();
  const { profile, games, trophies } = loaded;
  const { language } = texts;
  const seconds = games.reduce((sum, game) => sum + game.secondsPlayed, 0);
  const earned = games.reduce((sum, game) => sum + game.trophiesEarned, 0);
  const points = games.reduce((sum, game) => sum + game.points, 0);
  const number = new Intl.NumberFormat(language);
  const stats = [
    [texts.statGames, number.format(games.length)],
    [texts.statPlayed, totalTime(seconds, texts)],
    [texts.statTrophies, number.format(earned)],
    [texts.statPoints, number.format(points)],
  ];
  return (
    <section className="page">
      <article className="card profile in d1">
        <div className="banner" aria-hidden="true" />
        <Avatar person={profile} size={96} />
        <h2 className="in d2">{profile.displayName}</h2>
        <p className="handle in d2">@{profile.handle}</p>
        <p className={`bio in d3${profile.bio ? "" : " none"}`}>{profile.bio || texts.noBio}</p>
        <dl className="stats in d3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="in d4">
          <FriendAction profile={profile} texts={ui(texts)} />
        </div>
      </article>

      <article className="card in d3">
        <h3 className="sub">
          {texts.library} <span className="n">{games.length}</span>
        </h3>
        {games.length === 0 ? (
          <p className="empty">{texts.noGames}</p>
        ) : (
          <ul className="games">
            {games.map((game) => (
              <li key={game.titleId} className="game">
                <div className="lines">
                  <span className="name">{localName(game.names, language) || game.titleId}</span>
                  <span className="meta">
                    {playTime(game.secondsPlayed, texts)}
                    {game.lastPlayedAt &&
                      ` · ${fill(texts.lastPlayed, { when: ago(game.lastPlayedAt, language) })}`}
                  </span>
                </div>
                <div className="progress">
                  <span className="meta">
                    {game.trophiesTotal
                      ? fill(texts.trophiesOf, { e: game.trophiesEarned, t: game.trophiesTotal })
                      : texts.noTrophySet}
                  </span>
                  {game.progress !== null && (
                    <span className="bar" aria-hidden="true">
                      <i style={{ width: `${game.progress}%` }} />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card in d4">
        <h3 className="sub">{texts.recentTrophies}</h3>
        {trophies.length === 0 ? (
          <p className="empty">{texts.noTrophies}</p>
        ) : (
          <ul className="trophies">
            {trophies.slice(0, 30).map((trophy) => {
              const text = trophyText(trophy.texts, language);
              return (
                <li key={`${trophy.titleId}/${trophy.trophyId}`} className="trophy">
                  <span
                    className={`cup ${trophy.grade}`}
                    title={texts[`grade_${trophy.grade}`]}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8" />
                    </svg>
                  </span>
                  <div className="lines">
                    <span className="name">{text?.name ?? texts.hiddenTrophy}</span>
                    <span className="meta">
                      {texts[`grade_${trophy.grade}`]} · {localName(trophy.gameNames, language)} ·{" "}
                      {ago(trophy.earnedAt, language)}
                    </span>
                  </div>
                  {trophy.rarity !== null && (
                    <span className={`rarity ${trophy.rarityLabel ?? ""}`}>
                      {fill(texts.ofPlayers, { p: rarityPercent(trophy.rarity, language) })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}
