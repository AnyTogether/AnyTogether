import { Avatar } from "@/components/Avatar";
import { FriendAction } from "@/components/FriendAction";
import { ProfileMenu } from "@/components/ProfileMenu";
import { flag } from "@/lib/countries";
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
import type { Person, Profile } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ handle: string }> };

const clean = (handle: string) => decodeURIComponent(handle).replace(/^@/, "").toLowerCase();

/** The card, and each part the viewer may open; a part that is private comes back as null. */
async function load(handle: string) {
  if (!/^[a-z0-9_.]{1,40}$/.test(handle)) return null;
  const path = `/users/${encodeURIComponent(handle)}`;
  const [profile, library, trophies, friends] = await Promise.all([
    apiJson<Profile>(path),
    apiJson<{ games: LibraryGame[] }>(`${path}/library`),
    apiJson<{ trophies: EarnedTrophy[] }>(`${path}/trophies`),
    apiJson<{ friends: Person[] }>(`${path}/friends`),
  ]);
  if (!profile.body) return null;
  return {
    profile: profile.body,
    games: library.status === 403 ? null : (library.body?.games ?? []),
    trophies: trophies.status === 403 ? null : (trophies.body?.trophies ?? []),
    friends: friends.status === 403 ? null : (friends.body?.friends ?? []),
  };
}

function Private({ text }: { text: string }) {
  return (
    <div className="private">
      <span className="lock">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </svg>
      </span>
      <p>{text}</p>
    </div>
  );
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
  const { profile, games, trophies, friends } = loaded;
  // An old handle still finds the person for 30 days; the address shows the new one.
  if (profile.handle.toLowerCase() !== handle) redirect(`/u/${profile.handle}`);
  const { language } = texts;
  const self = profile.friendship === "me";
  const name = { name: profile.displayName };
  const seconds = (games ?? []).reduce((sum, game) => sum + game.secondsPlayed, 0);
  const earned = (games ?? []).reduce((sum, game) => sum + (game.trophiesEarned ?? 0), 0);
  const points = (games ?? []).reduce((sum, game) => sum + (game.points ?? 0), 0);
  // Trophy counts are left out of an open library when the trophies are private.
  const countsHidden = (games ?? []).some((game) => game.trophiesEarned === null);
  const presence = profile.presence;
  const number = new Intl.NumberFormat(language);
  const stats = [
    [texts.statGames, number.format(games?.length ?? 0)],
    [texts.statPlayed, totalTime(seconds, texts)],
    [texts.statTrophies, countsHidden ? "–" : number.format(earned)],
    [texts.statPoints, countsHidden ? "–" : number.format(points)],
  ];
  return (
    <section className="page">
      <article className="card profile in d1">
        <div className="banner" aria-hidden="true" />
        {!self && <ProfileMenu person={profile} texts={ui(texts)} />}
        <Avatar
          person={profile}
          size={96}
          presence={presence && presence.state !== "offline" ? presence.state : undefined}
        />
        <h2 className="in d2">{profile.displayName}</h2>
        <p className="handle in d2">
          @{profile.handle}
          {profile.country && (
            <span className="country">
              {" · "}
              <span aria-hidden="true">{flag(profile.country)}</span>{" "}
              {new Intl.DisplayNames([language], { type: "region" }).of(profile.country)}
            </span>
          )}
        </p>
        {presence && presence.state !== "offline" && (
          <p className={`status in d2 ${presence.state === "in_game" ? "playing" : presence.state}`}>
            {presence.state === "in_game"
              ? fill(texts.inGame, {
                  title:
                    localName(
                      games?.find((game) => game.titleId === presence.titleId)?.names ?? {},
                      language,
                    ) ||
                    (presence.titleId ?? "?"),
                })
              : presence.state === "online"
                ? texts.stateOnline
                : texts.stateAway}
          </p>
        )}
        <p className={`bio in d3${profile.bio ? "" : " none"}`}>{profile.bio || texts.noBio}</p>
        {games && (
          <dl className="stats in d3">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="in d4">
          <FriendAction profile={profile} texts={ui(texts)} />
        </div>
      </article>

      <article className="card in d3">
        <h3 className="sub">
          {texts.library} {games ? <span className="n">{games.length}</span> : <PrivateTag texts={texts} />}
        </h3>
        {!games ? (
          <Private text={fill(texts.privateLibrary, name)} />
        ) : games.length === 0 ? (
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
                    {game.trophiesEarned === null
                      ? ""
                      : game.trophiesTotal
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
        <h3 className="sub">
          {texts.recentTrophies} {!trophies && <PrivateTag texts={texts} />}
        </h3>
        {!trophies ? (
          <Private text={fill(texts.privateTrophies, name)} />
        ) : trophies.length === 0 ? (
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

      <article className="card in d4">
        <h3 className="sub">
          {texts.friends}{" "}
          {friends ? <span className="n">{friends.length}</span> : <PrivateTag texts={texts} />}
        </h3>
        {!friends ? (
          <Private text={fill(texts.privateFriends, name)} />
        ) : friends.length === 0 ? (
          <p className="empty">{texts.noFriendsYet}</p>
        ) : (
          <ul className="friend-grid">
            {friends.slice(0, 24).map((friend) => (
              <li key={friend.userId}>
                <Link href={`/u/${friend.handle}`} className="who">
                  <Avatar person={friend} size={36} />
                  <span className="lines">
                    <span className="name">{friend.displayName}</span>
                    <span className="meta">@{friend.handle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function PrivateTag({ texts }: { texts: { privateSection: string } }) {
  return <span className="tag private-tag">{texts.privateSection}</span>;
}
