import { Avatar } from "@/components/Avatar";
import { AddFriend, JoinPublic, LfgActions, LfgRequests } from "@/components/Discover";
import {
  type GameInfo,
  type LfgPost,
  type PersonCard,
  type PublicParty,
  type PublicShare,
  languageName,
  startTime,
  startsNow,
  untilShort,
} from "@/lib/discover";
import { since } from "@/lib/feed";
import { localName } from "@/lib/games";
import type { Strings, UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import Link from "next/link";

/** The three Find players pages. */
export function FindTabs({ current, texts }: { current: "board" | "live" | "people"; texts: Strings }) {
  const tabs = [
    ["board", "/find", texts.tabBoard],
    ["live", "/find/live", texts.tabLive],
    ["people", "/find/people", texts.tabPeople],
    ["communities", "/communities", texts.communities],
  ] as const;
  return (
    <nav className="switch find-tabs in d2" aria-label={texts.findPlayers}>
      {tabs.map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={key === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** A game's icon, or its first letter. */
export function GameMark({
  game,
  titleId,
  language,
  big,
}: {
  game: GameInfo | null;
  titleId: string;
  language: string;
  big?: boolean;
}) {
  const name = (game && localName(game.names, language)) || titleId;
  return (
    <span className={`game-icon${big ? " big" : ""}`} aria-hidden="true">
      {game?.iconUrl ? <img src={game.iconUrl} alt="" /> : name.slice(0, 1)}
    </span>
  );
}

export const gameName = (game: GameInfo | null, titleId: string, language: string) =>
  (game && localName(game.names, language)) || titleId;

/** One looking-for-group post: the game, what for and when, who posts, the note, how many spots
 *  are left; the reader's actions, and on their own post who wants in. */
export function LfgCard({
  post,
  texts,
  ui,
  now,
  showGame = true,
}: {
  post: LfgPost;
  texts: Strings;
  ui: UiStrings;
  now: number;
  showGame?: boolean;
}) {
  const { language } = texts;
  const left = Math.max(0, post.slots - post.filled);
  const closed = post.status !== "open";
  return (
    <article
      className={`lfg-card p-${post.purpose}${closed ? " is-closed" : ""}${post.mine ? " is-mine" : ""}`}
    >
      <div className="lfg-head">
        {showGame ? (
          <Link href={`/games/${post.titleId}`} className="lfg-game">
            <GameMark game={post.game} titleId={post.titleId} language={language} />
            <span className="lines">
              <span className="name">{gameName(post.game, post.titleId, language)}</span>
              <span className="meta">
                <span className={`purpose-tag p-${post.purpose}`}>{texts[`purpose_${post.purpose}`]}</span>
              </span>
            </span>
          </Link>
        ) : (
          <span className={`purpose-tag p-${post.purpose}`}>{texts[`purpose_${post.purpose}`]}</span>
        )}
        <span className={`lfg-when${startsNow(post, now) ? " now" : ""}`}>
          {closed ? (
            texts[`status_${post.status}`]
          ) : post.startsAt && !startsNow(post, now) ? (
            fill(texts.startsAtTime, { time: startTime(post.startsAt, language, now) })
          ) : (
            <>
              <i className="dot" />
              {texts.startsNow}
            </>
          )}
        </span>
      </div>

      <div className="lfg-body">
        <Link href={`/u/${post.author.handle}`} className="who lfg-author">
          <Avatar person={post.author} size={28} />
          <span className="name">{post.author.displayName}</span>
        </Link>
        <span className="lfg-facts">
          {post.languages.map((code) => (
            <span key={code} className="lang-tag" title={languageName(code, language)}>
              {code.toUpperCase()}
            </span>
          ))}
          {post.region && <span className="meta">{texts[`region_${post.region}`]}</span>}
        </span>
      </div>
      {post.note && <p className="lfg-note">{post.note}</p>}

      <div className="lfg-foot">
        <span className="lfg-spots">
          <span className="spots" aria-hidden="true">
            {Array.from({ length: post.slots }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: one dot per slot, in order
              <i key={i} className={i < post.filled ? "taken" : ""} />
            ))}
          </span>
          <span className="meta">
            {left === 0 ? texts.spotsFull : fill(texts.spotsLeft, { n: left, total: post.slots })}
            {!closed && <> · {fill(texts.endsIn, { when: untilShort(post.expiresAt, language, now) })}</>}
          </span>
        </span>
        <LfgActions post={post} texts={ui} />
      </div>
      {post.mine && <LfgRequests post={post} texts={ui} />}
    </article>
  );
}

/** A public party in a list. */
export function PartyRow({ party, texts, ui }: { party: PublicParty; texts: Strings; ui: UiStrings }) {
  const { language } = texts;
  const full = party.size >= party.max;
  return (
    <li className="person public-row">
      {party.host ? <Avatar person={party.host} /> : <span className="avatar" />}
      <span className="lines">
        <span className="name">
          {party.titleId ? (
            <Link href={`/games/${party.titleId}`} className="plain">
              {gameName(party.game, party.titleId, language)}
            </Link>
          ) : (
            texts.noGameListed
          )}
        </span>
        <span className="meta">
          {party.host && fill(texts.hostedBy, { name: party.host.displayName })}
          {" · "}
          {fill(texts.partyMembers, { n: party.size, max: party.max })}
          {party.language && <> · {languageName(party.language, language)}</>}
        </span>
      </span>
      <span className={`flair join-flair ${party.join}`}>
        {party.join === "open" ? texts.joinOpenFlair : texts.joinRequestFlair}
      </span>
      <JoinPublic
        kind="party"
        id={party.id}
        join={party.join}
        requested={party.requested}
        full={full}
        texts={ui}
      />
    </li>
  );
}

/** A public share play in a list, or under Live now. */
export function ShareRow({ share, texts, ui }: { share: PublicShare; texts: Strings; ui: UiStrings }) {
  const { language } = texts;
  const full = share.viewers >= share.maxViewers;
  return (
    <li className="person public-row share-row">
      {share.host ? <Avatar person={share.host} /> : <span className="avatar" />}
      <span className="lines">
        <span className="name">
          {share.live && <span className="live-dot" aria-hidden="true" />}
          <Link href={`/games/${share.titleId}`} className="plain">
            {share.title ?? gameName(share.game, share.titleId, language)}
          </Link>
        </span>
        <span className="meta">
          {share.host && fill(texts.hostedBy, { name: share.host.displayName })}
          {" · "}
          {fill(texts.watching, { n: share.viewers, max: share.maxViewers })}
          {share.language && <> · {languageName(share.language, language)}</>}
          {" · "}
          {since(share.startedAt, language)}
        </span>
      </span>
      {!share.live && (
        <span className={`flair join-flair ${share.join}`}>
          {share.join === "open" ? texts.joinOpenFlair : texts.joinRequestFlair}
        </span>
      )}
      <JoinPublic
        kind="share_play"
        id={share.id}
        join={share.join}
        requested={share.requested}
        full={full}
        texts={ui}
      />
    </li>
  );
}

/** Why someone is suggested, in one short line. */
function reasonText(card: PersonCard, texts: Strings) {
  return (card.reasons ?? [])
    .map((reason) =>
      reason.kind === "friends"
        ? reason.count === 1
          ? texts.reasonFriend
          : fill(texts.reasonFriends, { n: reason.count })
        : reason.kind === "game"
          ? fill(texts.reasonGame, { game: localName(reason.names, texts.language) || reason.titleId })
          : fill(texts.reasonLanguage, { language: languageName(reason.language, texts.language) }),
    )
    .join(" · ");
}

/** Someone in a discovery list, with Add. */
export function PersonRow({
  card,
  texts,
  ui,
  now,
}: {
  card: PersonCard;
  texts: Strings;
  ui: UiStrings;
  now: number;
}) {
  const state = card.presence?.state as "online" | "away" | "in_game" | undefined;
  const line = card.reasons?.length
    ? reasonText(card, texts)
    : card.lastPlayedAt
      ? fill(texts.playedWhen, { when: since(card.lastPlayedAt, texts.language, now) })
      : `@${card.user.handle}`;
  return (
    <li className="person">
      <Link href={`/u/${card.user.handle}`} className="who">
        <Avatar person={card.user} presence={state} />
        <span className="lines">
          <span className="name">
            {card.user.displayName} <span className="handle">@{card.user.handle}</span>
          </span>
          <span className="meta">{line}</span>
        </span>
      </Link>
      <div className="acts">
        <AddFriend card={card} texts={ui} />
      </div>
    </li>
  );
}
