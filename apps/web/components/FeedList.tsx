"use client";

import { When } from "@/components/When";

import { Avatar } from "@/components/Avatar";
import { useLiveEvents } from "@/components/Live";
import { type Activity, type FeedPage, type Reaction, reactions, since } from "@/lib/feed";
import { localName, playTime, rarityPercent, trophyText } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useState } from "react";

/** "{name} earned {trophy}" with each blank filled by a node. */
function rich(template: string, parts: Record<string, ReactNode>) {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed template
    return key && key in parts ? <Fragment key={index}>{parts[key]}</Fragment> : piece;
  });
}

const cupPath = "M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8";

/** The small mark on an item's avatar that says what kind of thing happened. */
function KindMark({ item }: { item: Activity }) {
  const best = item.trophies?.[0]?.grade ?? "bronze";
  const tone = item.kind === "platinum" ? "platinum" : item.kind === "trophy" ? best : item.kind;
  return (
    <span className={`kind-mark ${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {item.kind === "trophy" || item.kind === "platinum" ? (
          <path d={cupPath} />
        ) : item.kind === "first_play" ? (
          <>
            <rect x="2.5" y="7" width="19" height="11" rx="4" />
            <path d="M7.5 10.5v4M5.5 12.5h4" />
            <circle cx="16" cy="11.5" r=".9" fill="currentColor" stroke="none" />
            <circle cx="18" cy="13.6" r=".9" fill="currentColor" stroke="none" />
          </>
        ) : item.kind === "long_session" ? (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </>
        ) : item.kind === "level_up" ? (
          <path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9zM9 13l3-3 3 3" />
        ) : item.kind === "friendship" ? (
          <>
            <circle cx="9" cy="8.5" r="3" />
            <path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5M16 7v6M13 10h6" />
          </>
        ) : (
          <path d="M5 21V4M5 4h11l-2 3.5L16 11H5" />
        )}
      </svg>
    </span>
  );
}

function Item({
  item,
  texts,
  now,
  onReact,
  arrived,
}: {
  item: Activity;
  texts: UiStrings;
  now: number;
  /** Left out for a reader who is not signed in: the counts show, the buttons do nothing. */
  onReact?: ((item: Activity, reaction: Reaction) => void) | undefined;
  /** Came in live: it slides in. */
  arrived: boolean;
}) {
  const { language } = texts;
  const number = new Intl.NumberFormat(language);
  const who = (person: { handle: string; displayName: string }) => (
    <Link href={`/u/${person.handle}`} className="who-name">
      {person.displayName}
    </Link>
  );
  const game = item.game ? (
    <b className="game-name">{localName(item.game.names, language) || item.game.titleId}</b>
  ) : null;
  const trophies = item.trophies ?? [];
  const first = trophies[0];
  const trophyName = (t: (typeof trophies)[number]) =>
    trophyText(t.texts, language)?.name ?? texts.hiddenTrophy;
  let line: ReactNode;
  switch (item.kind) {
    case "trophy":
      line =
        (item.trophyCount ?? 1) === 1 && first
          ? rich(texts.act_trophy_one, { name: who(item.actor), trophy: <b>{trophyName(first)}</b>, game })
          : rich(texts.act_trophy_many, {
              name: who(item.actor),
              n: number.format(item.trophyCount ?? 0),
              game,
            });
      break;
    case "platinum":
      line = rich(texts.act_platinum, { name: who(item.actor), game });
      break;
    case "first_play":
      line = rich(texts.act_first_play, { name: who(item.actor), game });
      break;
    case "long_session":
      line = rich(texts.act_long_session, {
        name: who(item.actor),
        game,
        time: <b>{playTime(item.seconds ?? 0, texts)}</b>,
      });
      break;
    case "level_up":
      line = rich(texts.act_level_up, {
        name: who(item.actor),
        level: <b>{number.format(item.level?.level ?? 0)}</b>,
      });
      break;
    case "friendship":
      line = rich(texts.act_friendship, {
        name: who(item.actor),
        friend: item.friend ? who(item.friend) : "?",
      });
      break;
    default:
      line = rich(texts[`act_milestone_${item.milestone?.kind ?? "trophies"}`], {
        name: who(item.actor),
        value: <b>{number.format(item.milestone?.value ?? 0)}</b>,
      });
  }
  const many = item.kind === "trophy" && (item.trophyCount ?? 1) > 1;
  const single = (item.kind === "trophy" && !many) || item.kind === "platinum" ? first : undefined;
  return (
    <li className={`activity${item.highlight ? ` hl-${item.highlight}` : ""}${arrived ? " arrived" : ""}`}>
      <Link href={`/u/${item.actor.handle}`} className="activity-avatar" tabIndex={-1} aria-hidden="true">
        <Avatar person={item.actor} size={40} />
        <KindMark item={item} />
      </Link>
      <div className="activity-body">
        <p className="activity-line">{line}</p>
        <p className="activity-meta">
          {item.highlight === "platinum" && <span className="flair platinum">{texts.platinumTag}</span>}
          {item.highlight === "rare" && <span className="flair rare">{texts.rare}</span>}
          {item.kind === "milestone" && <span className="flair milestone">{texts.milestoneTag}</span>}
          {item.kind === "level_up" && <span className="flair level">{texts.levelTag}</span>}
          <When iso={item.createdAt} language={language} now={now} />
          {single?.rarity != null && (
            <span>{fill(texts.ofPlayers, { p: rarityPercent(single.rarity, language) })}</span>
          )}
          {item.kind === "first_play" && item.seconds ? (
            <span>{fill(texts.firstSession, { time: playTime(item.seconds, texts) })}</span>
          ) : null}
        </p>
        {many && (
          <ul className="tchips">
            {trophies.slice(0, 3).map((t) => (
              <li
                key={t.trophyId}
                className={`tchip ${t.grade}${t.rarity !== null && t.rarity <= 0.2 ? " rare" : ""}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={cupPath} />
                </svg>
                <span>{trophyName(t)}</span>
              </li>
            ))}
            {(item.trophyCount ?? 0) > 3 && (
              <li className="tchip more">{fill(texts.andMore, { n: (item.trophyCount ?? 0) - 3 })}</li>
            )}
          </ul>
        )}
        <div className="reacts">
          {reactions.map(({ key, emoji }) => {
            const count = item.reactions.counts[key] ?? 0;
            // Read only, only the reactions someone gave are shown.
            if (!onReact && !count) return null;
            const mine = item.reactions.mine === key;
            const label = texts[`react_${key}`];
            return (
              <button
                key={key}
                type="button"
                className={`react${mine ? " on" : ""}${count ? " has" : ""}`}
                aria-pressed={mine}
                aria-label={count ? fill(texts.reactLabel, { reaction: label, n: count }) : label}
                title={label}
                disabled={!onReact}
                onClick={() => onReact?.(item, key)}
              >
                <span aria-hidden="true">{emoji}</span>
                {count > 0 && <span className="react-n">{number.format(count)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

/** A list of feed items: the home feed (live, with older pages) or a profile's recent activity. */
export function FeedList({
  texts,
  initial,
  live = false,
  now: renderedAt,
  empty,
  readOnly = false,
}: {
  texts: UiStrings;
  initial: FeedPage;
  /** The home feed: takes feed.item events and pages through /me/feed. */
  live?: boolean;
  now: number;
  empty: ReactNode;
  /** A reader who is not signed in: no reactions. */
  readOnly?: boolean;
}) {
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(renderedAt);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useLiveEvents((event) => {
    if (!live || event.type !== "feed.item") return;
    const item = event.data as Activity;
    setItems((list) =>
      list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [item, ...list],
    );
    setFresh((ids) => new Set(ids).add(item.id));
    setNow(Date.now());
  });

  async function older() {
    if (!next || loading) return;
    setLoading(true);
    const response = await fetch(`/me/feed?before=${encodeURIComponent(next)}`).catch(() => undefined);
    if (response?.ok) {
      const page = (await response.json()) as FeedPage;
      setItems((list) => [...list, ...page.items.filter((i) => !list.some((known) => known.id === i.id))]);
      setNext(page.next);
    }
    setLoading(false);
  }

  async function react(item: Activity, reaction: Reaction) {
    const undo = item.reactions.mine === reaction;
    const counts = { ...item.reactions.counts };
    if (item.reactions.mine)
      counts[item.reactions.mine] = Math.max(0, (counts[item.reactions.mine] ?? 1) - 1);
    if (!undo) counts[reaction] = (counts[reaction] ?? 0) + 1;
    const set = (value: Activity["reactions"]) =>
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, reactions: value } : i)));
    set({ counts, mine: undo ? null : reaction });
    const response = await fetch(`/me/reactions/${item.id}`, {
      method: undo ? "DELETE" : "PUT",
      headers: { "content-type": "application/json" },
      ...(undo ? {} : { body: JSON.stringify({ reaction }) }),
    }).catch(() => undefined);
    if (response?.ok) set((await response.json()) as Activity["reactions"]);
    else set(item.reactions);
  }

  if (!items.length) return <>{empty}</>;
  return (
    <>
      <ul className="activities">
        {items.map((item) => (
          <Item
            key={item.id}
            item={item}
            texts={texts}
            now={now}
            onReact={readOnly ? undefined : react}
            arrived={fresh.has(item.id)}
          />
        ))}
      </ul>
      {live && next && (
        <div className="more-row">
          <button type="button" className="pill" onClick={older} disabled={loading}>
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}
