"use client";

import type { MotionStrings } from "@/lib/i18n-motion";
import { type CSSProperties, useEffect, useRef, useState } from "react";

/** The launcher's home screen, rebuilt in HTML rather than shown as a picture: the selection glides
 *  along the games, the artwork behind changes with it, friends' notices drop in and the badges
 *  count up. The games and their numbers are the ones in the launcher's own screenshots; the
 *  people are made up. It scales as one piece with its width (1em is 1 % of it). */

type Game = {
  key: string;
  name: string;
  art?: string;
  trophies: string;
  size: number;
  id: string;
  version: string;
  status: "ready" | "converting" | "playing";
};

const games: Game[] = [
  {
    key: "silksong",
    name: "Hollow Knight: Silksong",
    art: "/art/silksong.webp",
    trophies: "8/34",
    size: 8.39,
    id: "PPSA12544",
    version: "01.000.010",
    status: "ready",
  },
  {
    key: "catquest",
    name: "Cat Quest III",
    art: "/art/catquest.webp",
    trophies: "0/31",
    size: 1.48,
    id: "PPSA15065",
    version: "01.004.008",
    status: "ready",
  },
  {
    key: "pvz",
    name: "Plants vs. Zombies™: Replanted",
    art: "/art/pvz.webp",
    trophies: "0/38",
    size: 1.99,
    id: "PPSA29802",
    version: "01.510.000",
    status: "converting",
  },
  { key: "sarah", name: "Dreaming Sarah", trophies: "", size: 0, id: "", version: "", status: "ready" },
  { key: "doom", name: "DOOM", trophies: "", size: 0, id: "", version: "", status: "ready" },
  { key: "quake3", name: "Quake III Arena", trophies: "", size: 0, id: "", version: "", status: "ready" },
  { key: "quake2", name: "Yamagi Quake II", trophies: "", size: 0, id: "", version: "", status: "ready" },
];
const cycle = 3;
const stepMs = 4200;

const icon = {
  grid: "M5 5h3v3H5zM10.5 5h3v3h-3zM16 5h3v3h-3zM5 10.5h3v3H5zM10.5 10.5h3v3h-3zM16 10.5h3v3h-3zM5 16h3v3H5zM10.5 16h3v3h-3zM16 16h3v3h-3z",
  gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19 12l2-1.5-2-3.5-2.4.8a7 7 0 0 0-1.6-.9L14.5 4h-5l-.5 2.9c-.6.2-1.1.5-1.6.9L5 7 3 10.5 5 12l-2 1.5L5 17l2.4-.8c.5.4 1 .7 1.6.9l.5 2.9h5l.5-2.9c.6-.2 1.1-.5 1.6-.9L19 17l2-3.5z",
  friends:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5zM16.5 11a2.5 2.5 0 1 0 0-5M17 14c2 .3 3.6 2 4 5h-3",
  chat: "M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v5a2.5 2.5 0 0 1-2.5 2.5H10l-3.5 3v-3A2.5 2.5 0 0 1 4 11.5zM19 9v6.5a2 2 0 0 1-2 2h-.5V20l-2.5-2.5",
  party:
    "M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 11a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM3 17c.4-2.4 2-4 4-4M21 17c-.4-2.4-2-4-4-4M7.5 19c.5-3 2.3-5 4.5-5s4 2 4.5 5z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  trophy: "M8 20h8M12 16v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  play: "M8 5v14l11-7z",
  check: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.5 2.5L16 9.5",
  down: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v8M8.5 12l3.5 3.5 3.5-3.5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
};

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`ll-ico ${className}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function LiveLauncher({
  t,
  language,
  label,
  unlocking = true,
  className = "",
}: {
  t: MotionStrings["launcher"];
  language: string;
  /** What the launcher shows, for screen readers: the rebuilt screen itself is decorative. */
  label: string;
  /** False where the launcher has nothing to convert (the PC launcher): every game is ready. */
  unlocking?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState(0);
  const [noticeOn, setNoticeOn] = useState(false);
  const [count, setCount] = useState({ friends: 2, messages: 2, bell: 3 });
  const [clock, setClock] = useState("21:30");

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const tickClock = () => {
      const now = new Date();
      setClock(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    };
    tickClock();
    const clockTimer = window.setInterval(tickClock, 15000);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => window.clearInterval(clockTimer);
    }
    let step = 0;
    let timer = 0;
    const timeouts: number[] = [];
    const advance = () => {
      step += 1;
      const next = step % cycle;
      setSelected(next);
      const which = (step - 1) % t.notices.length;
      timeouts.push(
        window.setTimeout(() => {
          setNotice(which);
          setNoticeOn(true);
          setCount((c) =>
            step > 6
              ? { friends: 2, messages: 2, bell: 3 }
              : {
                  friends: which === 0 ? c.friends + 1 : c.friends,
                  messages: which === 1 ? c.messages + 1 : c.messages,
                  bell: c.bell + 1,
                },
          );
        }, 1300),
        window.setTimeout(() => setNoticeOn(false), 3900),
      );
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearInterval(timer);
        if (entry?.isIntersecting) timer = window.setInterval(advance, stepMs);
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
      for (const timeout of timeouts) window.clearTimeout(timeout);
    };
  }, [t.notices.length]);

  const game = games[selected] ?? games[0];
  if (!game) return null;
  const status = game.status === "converting" && !unlocking ? "ready" : game.status;
  const size = new Intl.NumberFormat(language, { minimumFractionDigits: 2 }).format(game.size);
  const shown = t.notices[notice];

  return (
    <div ref={box} className={`ll ${className}`} role="img" aria-label={label}>
      <div className="ll-screen" aria-hidden="true">
        <div className="ll-art">
          {games.map((g, i) =>
            g.art ? (
              <img
                key={g.key}
                src={g.art}
                alt=""
                className={i === selected ? "on" : ""}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "low"}
                decoding="async"
              />
            ) : null,
          )}
        </div>
        <div className="ll-top">
          <b className="ll-heading">{t.games}</b>
          <div className="ll-bar">
            <span className="ll-btn">
              <Icon d={icon.grid} />
            </span>
            <span className="ll-btn">
              <Icon d={icon.gear} />
            </span>
            <span className="ll-btn">
              <Icon d={icon.friends} />
              <i key={`f${count.friends}`} className="ll-badge">
                {count.friends}
              </i>
            </span>
            <span className="ll-btn">
              <Icon d={icon.chat} />
              <i key={`m${count.messages}`} className="ll-badge">
                {count.messages}
              </i>
            </span>
            <span className="ll-btn">
              <Icon d={icon.party} />
            </span>
            <span className="ll-btn">
              <Icon d={icon.bell} />
              <i key={`b${count.bell}`} className="ll-badge">
                {count.bell}
              </i>
            </span>
            <span className="ll-me">
              <i>{t.user.slice(0, 1)}</i>
              {t.user}
            </span>
            <span className="ll-clock">{clock}</span>
          </div>
        </div>

        <div className="ll-row" style={{ "--sel": selected } as CSSProperties}>
          {games.map((g, i) => (
            <span
              key={g.key}
              className={`ll-tile${i === selected ? " on" : ""}${i > selected ? " after" : ""}`}
              style={{ "--n": i } as CSSProperties}
            >
              {g.key === "quake3" && <Icon d={icon.lock} className="ll-lock" />}
            </span>
          ))}
          <span className="ll-focus" />
        </div>
        <div className="ll-name" key={`n${selected}`}>
          <b>{game.name}</b>
          <span className={`ll-state ${status}`}>
            <Icon d={status === "converting" ? icon.down : icon.check} />
            {status === "converting" ? t.converting : t.ready}
          </span>
        </div>

        <div className="ll-detail" key={`d${selected}`}>
          <h3 className="ll-title">{game.name}</h3>
          <div className="ll-actions">
            <span className="ll-play">
              <Icon d={icon.play} />
              {status === "converting" ? t.cancel : t.play}
            </span>
            <span className="ll-trophy">
              <Icon d={icon.trophy} />
              {game.trophies}
            </span>
            <span className="ll-more">···</span>
            {status === "converting" && (
              <span className="ll-progress">
                <span>{t.converting}</span>
                <i />
              </span>
            )}
          </div>
          <div className="ll-cards">
            <span>
              <small>{t.status}</small>
              <b className={`ll-state ${status}`}>
                <Icon d={status === "converting" ? icon.down : icon.check} />
                {status === "converting" ? t.converting : t.ready}
              </b>
            </span>
            <span>
              <small>{t.size}</small>
              <b>{size} GB</b>
            </span>
            <span>
              <small>{t.titleId}</small>
              <b>{game.id}</b>
            </span>
            <span>
              <small>{t.version}</small>
              <b>{game.version}</b>
            </span>
          </div>
        </div>

        <div className="ll-hints">
          {t.hints.map((hint, i) => (
            <span key={hint}>
              <kbd>{["← → ↑ ↓", "L1 R1", "✕", "◯"][i]}</kbd>
              {hint}
            </span>
          ))}
        </div>

        <div className={`ll-notice${noticeOn ? " on" : ""}`}>
          {shown && (
            <>
              <i className="ll-notice-ico">
                <Icon d={notice === 2 ? icon.trophy : notice === 1 ? icon.chat : icon.friends} />
              </i>
              <span>
                <b>{shown.who}</b>
                {shown.what}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
