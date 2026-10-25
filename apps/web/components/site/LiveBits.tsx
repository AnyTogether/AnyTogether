import type { MotionStrings } from "@/lib/i18n-motion";
import type { CSSProperties } from "react";
import { GlyphShape } from "./Backdrop";

/** The smaller live pieces of the public pages, rebuilt in HTML and moved by CSS alone: the phone
 *  as a DualSense, a party with voice, a chat, the friends list, a call, the board of people
 *  looking for players and a trophy notice. Each loop runs only while on screen (data-loop) and
 *  holds still with reduced motion. All are pictures of the product, hidden from screen readers;
 *  the text around them says what they show. */

const seat = (n: number) => ({ "--seat": `var(--p${n})` }) as CSSProperties;

/** The phone held sideways as the controller. */
export function LivePad({ user = "Robin", className = "" }: { user?: string; className?: string }) {
  return (
    <div className={`lp ${className}`} data-loop aria-hidden="true">
      <div className="lp-screen">
        <span className="lp-shoulder l1">
          <b>L1</b>
        </span>
        <span className="lp-shoulder l2">
          <b>L2</b>
        </span>
        <span className="lp-shoulder r2">
          <b>R2</b>
        </span>
        <span className="lp-shoulder r1">
          <b>R1</b>
        </span>
        <span className="lp-touch">
          <i className="lp-swipe" />
        </span>
        <span className="lp-user">
          <i />
          <b>{user}</b>
        </span>
        <span className="lp-menu">
          <b>≡</b>
        </span>
        <span className="lp-dpad">
          <i className="up" />
          <i className="left" />
          <i className="right" />
          <i className="down" />
        </span>
        <span className="lp-faces">
          {(["triangle", "circle", "cross", "square"] as const).map((shape) => (
            <i key={shape} className={`lp-face ${shape}`}>
              <GlyphShape shape={shape} />
            </i>
          ))}
        </span>
        <span className="lp-stick left">
          <i />
        </span>
        <span className="lp-stick right">
          <i />
        </span>
        <span className="lp-ps">
          <b>PS</b>
        </span>
      </div>
    </div>
  );
}

/** A party of four with voice: whoever speaks lights up. */
export function LiveParty({ t }: { t: MotionStrings["party"] }) {
  return (
    <div className="lv party-card" data-loop aria-hidden="true">
      <header>
        <b>{t.title}</b>
        <span>{t.inGame}</span>
      </header>
      <ul className="party-people">
        {t.members.map((name, i) => (
          <li
            key={name}
            className={i === 3 ? "muted" : ""}
            style={{ ...seat(i + 1), "--i": i } as CSSProperties}
          >
            <span className="party-face">
              <i>{name.slice(0, 1)}</i>
            </span>
            <b>{name}</b>
            <span className="party-state">
              <span className="talk">{t.talking}</span>
              {i === 3 && <span className="mute">{t.muted}</span>}
            </span>
          </li>
        ))}
      </ul>
      <footer>
        <span className="lv-chip">{t.mute}</span>
        <span className="lv-chip quiet">{t.leave}</span>
        <span className="party-level">
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of level bars
            <i key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </span>
      </footer>
    </div>
  );
}

/** A chat arriving line by line. */
export function LiveChat({ t }: { t: MotionStrings["chat"] }) {
  return (
    <div className="lv chat-card" data-loop aria-hidden="true">
      <header>
        <span className="lv-face" style={seat(2)}>
          {t.with.slice(0, 1)}
        </span>
        <b>{t.with}</b>
        <i className="lv-online" />
      </header>
      <div className="chat-lines">
        {t.lines.map(([who = "", text = ""], i) => (
          <p key={text} className={`bubble ${who} b${i}`}>
            {text}
          </p>
        ))}
        <p className="typing">
          <i />
          <i />
          <i />
        </p>
      </div>
    </div>
  );
}

/** Who is online and what they play. */
export function LiveFriends({ t }: { t: MotionStrings["friends"] }) {
  return (
    <div className="lv friends-card" data-loop aria-hidden="true">
      <header>
        <b>{t.title}</b>
        <span>{t.people.filter((p) => p[2] !== "away").length}</span>
      </header>
      <ul>
        {t.people.map(([name = "", what = "", state = ""], i) => (
          <li key={name} className={state}>
            <span className="lv-face" style={seat(i + 1)}>
              {name.slice(0, 1)}
              <i />
            </span>
            <span className="friend-text">
              <b>{name}</b>
              <span>{what}</span>
            </span>
            {state === "playing" && <span className="lv-chip">{t.join}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A friend ringing over the game. */
export function LiveCall({ t }: { t: MotionStrings["call"] }) {
  return (
    <div className="lv call-card" data-loop aria-hidden="true">
      <span className="call-ring" style={seat(3)}>
        <i>{t.who.slice(0, 1)}</i>
      </span>
      <p>
        <b>{t.who}</b> {t.what}
      </p>
      <div className="call-actions">
        <span className="lv-chip ok">{t.answer}</span>
        <span className="lv-chip no">{t.decline}</span>
      </div>
    </div>
  );
}

/** People looking for players, an endless board. */
export function LiveBoard({ t, cta }: { t: MotionStrings["board"]; cta: string }) {
  const card = ([game = "", text = "", meta = ""]: string[], key: string) => (
    <li key={key} className="board-card">
      <span className="board-game">{game}</span>
      <b>{text}</b>
      <span className="board-meta">
        {meta}
        <span className="lv-chip">{cta}</span>
      </span>
    </li>
  );
  return (
    <div className="lv board" data-loop aria-hidden="true">
      <ul className="board-track">
        {t.map((row, i) => card(row, `a${i}`))}
        {t.map((row, i) => card(row, `b${i}`))}
      </ul>
    </div>
  );
}

/** The notice that drops in when a trophy unlocks. */
export function TrophyToast({ t }: { t: MotionStrings["trophy"] }) {
  return (
    <div className="trophy-toast" aria-hidden="true">
      <span className="trophy-medal">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 20h8M12 16v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
        </svg>
      </span>
      <span>
        <small>{t.label}</small>
        <b>{t.name}</b>
        <span>{t.rarity}</span>
      </span>
    </div>
  );
}
