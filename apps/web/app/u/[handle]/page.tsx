import { Avatar } from "@/components/Avatar";
import { CaptureGrid } from "@/components/Captures";
import { FeedList } from "@/components/FeedList";
import { FriendAction } from "@/components/FriendAction";
import { Gallery } from "@/components/Gallery";
import { LevelBadge, LevelCard } from "@/components/LevelBadge";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ProfileShowcase } from "@/components/ProfileShowcase";
import { providerName } from "@/lib/connections";
import { flag } from "@/lib/countries";
import type { FeedPage } from "@/lib/feed";
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
import { fill, shownName } from "@/lib/people";
import type { Person, Profile, PublicProfile } from "@/lib/people";
import type { PostPage } from "@/lib/posts";
import { type LevelBadgeData, type Showcase, accents, localArt } from "@/lib/psn";
import { api, currentUser, publicJson } from "@/lib/session";
import type { MediaItem, StorageInfo } from "@/lib/storage";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ handle: string }> };

const clean = (handle: string) => decodeURIComponent(handle).replace(/^@/, "").toLowerCase();

/** The card, and each part the viewer may open; a part that is private comes back as null.
 *  Signed out, only what the person opened to everyone comes back. */
async function load(handle: string) {
  if (!/^[a-z0-9_.]{1,40}$/.test(handle)) return null;
  const path = `/users/${encodeURIComponent(handle)}`;
  const [profile, library, trophies, friends, activity, storage, showcase] = await Promise.all([
    publicJson<Profile>(path),
    publicJson<{ games: LibraryGame[] }>(`${path}/library`),
    publicJson<{ trophies: EarnedTrophy[] }>(`${path}/trophies`),
    publicJson<{ friends: (Person & { level?: LevelBadgeData | null })[] }>(`${path}/friends`),
    publicJson<FeedPage>(`${path}/activity?limit=8`),
    publicJson<StorageInfo>("/storage"),
    publicJson<Showcase>(`${path}/showcase`),
  ]);
  if (!profile.body) return null;
  const shown = <T,>(part: { status: number; body: T | null }, fallback: T) =>
    part.status === 403 || part.status === 401 ? null : (part.body ?? fallback);
  // The gallery only where the server keeps files; private (or signed out) comes back as null.
  const gallery = storage.body?.enabled ? await publicJson<{ items: MediaItem[] }>(`${path}/gallery`) : null;
  // Captures are for the signed in: what this reader may see of them (none signed out).
  const posts = storage.body?.enabled ? await publicJson<PostPage>(`${path}/posts?limit=12`) : null;
  return {
    profile: profile.body,
    games: shown(library, { games: [] })?.games ?? null,
    trophies: shown(trophies, { trophies: [] })?.trophies ?? null,
    friends: shown(friends, { friends: [] })?.friends ?? null,
    // Items the viewer may not see are left out by the API; older API answers have none.
    activity: activity.body?.items ?? [],
    gallery: gallery
      ? {
          items: shown(gallery, { items: [] })?.items ?? null,
          max: storage.body?.galleryMax ?? 12,
        }
      : null,
    showcase: showcase.body ?? { trophies: null, games: null },
    posts: posts?.body ?? null,
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

/** The title, and what a link preview (Discord, X, iMessage) shows: always what anyone may see,
 *  read signed out, whoever is looking. The picture is opengraph-image.tsx beside this page. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const handle = clean((await params).handle);
  const texts = await strings();
  const response = /^[a-z0-9_.]{1,40}$/.test(handle)
    ? await api(`/users/${encodeURIComponent(handle)}`).catch(() => undefined)
    : undefined;
  const profile = response?.ok ? ((await response.json()) as PublicProfile) : null;
  if (!profile) return { title: `@${handle} · AnyTogether` };
  const title = fill(texts.profileMeta, { name: profile.displayName, handle: profile.handle });
  const counts = profile.trophyCounts;
  const description =
    profile.bio ||
    (counts
      ? fill(texts.profileMetaTrophies, { trophies: counts.total, platinums: counts.platinum })
      : texts.profileMetaPlain);
  return {
    title: `${profile.displayName} (@${profile.handle}) · AnyTogether`,
    description,
    alternates: { canonical: `/u/${profile.handle}` },
    // Shared links preview; search engines are not asked to list people.
    robots: { index: false, follow: true },
    openGraph: { type: "profile", title, description, url: `/u/${profile.handle}`, username: profile.handle },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** A person's card, their games and play time, and the trophies they earned last. */
export default async function UserProfile({ params }: Params) {
  const handle = clean((await params).handle);
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  const loaded = await load(handle);
  if (!loaded) notFound();
  const { profile, games, trophies, friends, activity, gallery, showcase, posts } = loaded;
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
  const cover = profile.cover ? localArt(profile.cover.url) : null;
  const accent = profile.accent ? accents[profile.accent] : null;
  return (
    <section className="page">
      <article
        className={`card profile in d1${accent ? " accented" : ""}`}
        style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
      >
        <div
          className={`banner${cover ? ` cover ${profile.cover?.kind}` : ""}`}
          style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
          aria-hidden="true"
        />
        {!self && user && (
          <ProfileMenu
            person={profile}
            texts={ui(texts)}
            // A friend may report what only friends see.
            {...(profile.privateName || profile.privateAvatar
              ? {
                  privateReport: {
                    label: texts.reportPrivate,
                    title: fill(texts.reportPrivateTitle, { name: profile.displayName }),
                    lead: texts.reportPrivateLead,
                  },
                }
              : {})}
          />
        )}
        <Avatar
          person={profile}
          size={96}
          presence={presence && presence.state !== "offline" ? presence.state : undefined}
        />
        <h2 className="in d2">{shownName(profile)}</h2>
        {profile.privateName && profile.privateName !== profile.displayName && (
          <p className="private-line in d2">
            <span className="flair">{texts.friendsOnlyTag}</span>
            <span>{fill(texts.publicNameIs, { name: profile.displayName })}</span>
          </p>
        )}
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
        {presence?.share && profile.friendship === "friends" && (
          <Link href={`/watch/${presence.share.sharePlayId}`} className="pill watch-btn watch-link in d2">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="2.8" />
            </svg>
            {fill(texts.shareWatchFriend, name)}
            <span className="watch-game">· {presence.share.title ?? presence.share.titleId}</span>
          </Link>
        )}
        {profile.connections && profile.connections.length > 0 && (
          <ul className="badges in d2" aria-label={texts.sectionConnections}>
            {profile.connections.map((c) => (
              <li key={c.provider}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={`badge-link is-${c.provider}`}
                >
                  <span className="provider-mark">{providerName[c.provider]}</span>
                  {c.name ?? c.username ?? providerName[c.provider]}
                </a>
              </li>
            ))}
          </ul>
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
        {profile.trophyLevel && <LevelCard level={profile.trophyLevel} texts={texts} language={language} />}
        <div className="in d4">
          {user ? (
            <FriendAction profile={profile} texts={ui(texts)} />
          ) : (
            <div className="visitor-actions">
              <Link
                href={`/login?next=${encodeURIComponent(`/u/${profile.handle}`)}`}
                className="pill accent"
              >
                {fill(texts.signInToAdd, name)}
              </Link>
              <p className="hint">{fill(texts.publicView, name)}</p>
            </div>
          )}
        </div>
        {user && (self || (trophies && profile.trophyLevel)) && (
          <div className="profile-links in d4">
            {!self && (
              <Link href={`/u/${profile.handle}/compare`} className="pill">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                  <path d="M7 4h10v4a5 5 0 0 1-10 0zM12 13v4M8 20h8M3 12h4M17 12h4" />
                </svg>
                {texts.compareTrophies}
              </Link>
            )}
            {self && (
              <Link href="/players" className="pill">
                {texts.playersMet}
              </Link>
            )}
            {self && (
              <Link href="/settings#look" className="pill">
                {texts.sectionLook}
              </Link>
            )}
          </div>
        )}
      </article>

      <ProfileShowcase
        showcase={showcase}
        self={self}
        texts={ui(texts)}
        mine={self ? { trophies: trophies ?? [], games: games ?? [] } : undefined}
      />

      {/* Signed out the gallery is left out rather than shown as private. */}
      {gallery && (gallery.items === null ? Boolean(user) : gallery.items.length > 0 || self) && (
        <article className="card gallery-card in d3">
          <h3 className="sub">
            {texts.gallery}{" "}
            {gallery.items ? <span className="n">{gallery.items.length}</span> : <PrivateTag texts={texts} />}
          </h3>
          {gallery.items === null ? (
            <Private text={fill(texts.privateGallery, name)} />
          ) : (
            <Gallery
              items={gallery.items}
              mine={self}
              max={gallery.max}
              name={profile.displayName}
              texts={ui(texts)}
            />
          )}
        </article>
      )}

      {user && posts && (posts.items.length > 0 || self) && (
        <article className="card cap-profile in d3">
          <div className="card-head">
            <h3 className="sub">
              {texts.captures}{" "}
              {posts.items.length > 0 && (
                <span className="n">
                  {posts.items.length}
                  {posts.next ? "+" : ""}
                </span>
              )}
            </h3>
            {self && (
              <Link href="/captures" className="quiet-link">
                {texts.capShare}
              </Link>
            )}
          </div>
          <CaptureGrid
            texts={ui(texts)}
            initial={posts}
            source={{ kind: "user", handle: profile.handle }}
            empty={<p className="empty">{self ? texts.capEmptyMine : fill(texts.capEmptyProfile, name)}</p>}
          />
        </article>
      )}

      <article className="card in d3">
        <h3 className="sub">{texts.recentActivity}</h3>
        <FeedList
          texts={ui(texts)}
          initial={{ items: activity, next: null }}
          readOnly={!user}
          now={Date.now()}
          empty={<p className="empty">{texts.noActivity}</p>}
        />
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
          {friends ? <span className="n">{friends.length}</span> : user && <PrivateTag texts={texts} />}
        </h3>
        {!friends ? (
          <Private text={fill(user ? texts.privateFriends : texts.signInForFriends, name)} />
        ) : friends.length === 0 ? (
          <p className="empty">{texts.noFriendsYet}</p>
        ) : (
          <ul className="friend-grid">
            {friends.slice(0, 24).map((friend) => (
              <li key={friend.userId}>
                <Link href={`/u/${friend.handle}`} className="who">
                  <Avatar person={friend} size={36} />
                  <span className="lines">
                    <span className="name">
                      {friend.displayName}
                      <LevelBadge level={friend.level} texts={texts} />
                    </span>
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
