"use client";

import { Avatar } from "@/components/Avatar";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type AccentName,
  type CoverView,
  type TrophyLevel,
  accentNames,
  accents,
  coverPresets,
  coverSrc,
} from "@/lib/psn";
import { rateLimitText } from "@/lib/rateLimit";
import { json, social } from "@/lib/social";
import { type CSSProperties, useEffect, useState } from "react";

type Choice = { kind: "preset"; id: string } | { kind: "game"; titleId: string } | null;
const same = (a: Choice, b: Choice) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === "preset"
      ? a.id === (b as { id: string }).id
      : a.titleId === (b as { titleId: string }).titleId));

/** The site's own blue to violet, the accent a profile has when none is picked. */
const defaultAccent = "#4f7cff";
const defaultSwatch = "linear-gradient(135deg, #4f7cff, #b65cff)";

/** A tick that draws itself on the swatch or cover just picked: the save went through. */
function Tick() {
  return (
    <svg className="look-tick" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.4 6.6 11.4 12.5 4.9" />
    </svg>
  );
}

/** The profile's cover (a preset, or a game's artwork the server has) and accent, each saved as
 *  soon as it is picked, with a small live copy of the profile that shows what they change. */
export function LookSettings({
  texts,
  cover,
  accent,
  games,
  person,
  level,
}: {
  texts: UiStrings;
  cover: CoverView | null;
  accent: AccentName | null;
  /** The owner's games that have artwork here. */
  games: { titleId: string; names: Record<string, string>; iconUrl: string }[];
  /** Who the preview shows. */
  person: { handle: string; displayName: string; avatar: string | null };
  level?: TrophyLevel | undefined;
}) {
  const [current, setCurrent] = useState<Choice>(
    cover
      ? cover.kind === "preset"
        ? { kind: "preset", id: cover.id }
        : { kind: "game", titleId: cover.id }
      : null,
  );
  const [tone, setTone] = useState<AccentName | null>(accent);
  /** A swatch under the pointer or the keyboard: the preview shows it before it is picked. */
  const [peek, setPeek] = useState<AccentName | null | undefined>(undefined);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" } | { kind: "error"; text: string }>({
    kind: "idle",
  });
  /** Which picker the last save came from, for the tick. */
  const [savedFrom, setSavedFrom] = useState<"cover" | "accent" | null>(null);
  const { language } = texts;

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = setTimeout(() => {
      setStatus({ kind: "idle" });
      setSavedFrom(null);
    }, 1600);
    return () => clearTimeout(timer);
  }, [status]);

  async function save(change: { cover?: Choice; accent?: AccentName | null }) {
    const before = { current, tone };
    if (change.cover !== undefined) setCurrent(change.cover);
    if (change.accent !== undefined) setTone(change.accent);
    setSavedFrom(null);
    const saved = await social("me/look", { method: "PATCH", ...json(change) });
    if (!saved.ok) {
      setCurrent(before.current);
      setTone(before.tone);
      const body = (saved.body ?? {}) as { code?: string; retryAfter?: number };
      return setStatus({
        kind: "error",
        text: body.code === "rate_limited" ? rateLimitText(body.retryAfter, texts) : texts.failed,
      });
    }
    setSavedFrom(change.cover !== undefined ? "cover" : "accent");
    setStatus({ kind: "saved" });
  }

  const gameArt = (titleId: string) => games.find((game) => game.titleId === titleId)?.iconUrl ?? null;
  const coverImage = !current
    ? null
    : current.kind === "preset"
      ? coverSrc(current.id)
      : gameArt(current.titleId);
  const shown = peek === undefined ? tone : peek;
  const accentColor = shown ? accents[shown] : defaultAccent;

  const coverOption = (choice: Choice, label: string, image: string | null, key: string, sub?: string) => {
    const on = same(current, choice);
    return (
      <label key={key} className={on ? "on" : undefined}>
        <input type="radio" name="cover" checked={on} onChange={() => save({ cover: choice })} />
        <span
          className={`thumb${image ? "" : " plain"}`}
          style={image ? { backgroundImage: `url("${image}")` } : undefined}
          aria-hidden="true"
        >
          {on && savedFrom === "cover" && <Tick />}
        </span>
        <span className="cover-name">
          {label}
          {sub && <small>{sub}</small>}
        </span>
      </label>
    );
  };

  const swatch = (name: AccentName | null, label: string) => {
    const on = tone === name;
    return (
      <label
        key={name ?? "default"}
        className={on ? "on" : undefined}
        onPointerEnter={() => setPeek(name)}
        onPointerLeave={() => setPeek(undefined)}
      >
        <input
          type="radio"
          name="accent"
          checked={on}
          onChange={() => save({ accent: name })}
          onFocus={() => setPeek(name)}
          onBlur={() => setPeek(undefined)}
        />
        <i style={{ "--swatch": name ? accents[name] : defaultSwatch } as CSSProperties}>
          {on && savedFrom === "accent" && <Tick />}
        </i>
        {label}
      </label>
    );
  };

  return (
    <div className="look-settings">
      <figure className="look-preview" style={{ "--accent": accentColor } as CSSProperties}>
        <span
          className={`lp-cover${coverImage ? "" : " plain"}${current?.kind === "game" ? " game" : ""}`}
          style={coverImage ? { backgroundImage: `url("${coverImage}")` } : undefined}
          aria-hidden="true"
        />
        <div className="lp-body" aria-hidden="true">
          <span className="lp-avatar">
            <Avatar person={person} size={60} />
          </span>
          <span className="lp-name">{person.displayName}</span>
          <span className="lp-handle">@{person.handle}</span>
          <span className="lp-level">
            <span className="lp-level-title">{fill(texts.levelLabel, { n: level?.level ?? 1 })}</span>
            <span className="lp-bar">
              <i style={{ width: `${Math.max(12, Math.min(100, level?.progress ?? 0))}%` }} />
            </span>
          </span>
        </div>
        <figcaption>{texts.lookPreview}</figcaption>
      </figure>

      <div className="look-group">
        <span className="look-heading">{texts.coverLabel}</span>
        <fieldset className="cover-grid">
          <legend className="visually-hidden">{texts.coverLabel}</legend>
          {coverOption(null, texts.coverDefault, null, "default")}
          {coverPresets.map((id) => {
            const [palette, pattern] = id.split("-") as [string, string];
            return coverOption(
              { kind: "preset", id },
              texts[`palette_${palette}` as "palette_cosmic"],
              coverSrc(id),
              id,
              texts[`pattern_${pattern}` as "pattern_grid"],
            );
          })}
        </fieldset>
      </div>

      <div className="look-group">
        <span className="look-heading">{texts.coverGames}</span>
        <p className="hint look-hint">{games.length === 0 ? texts.coverGamesNone : texts.coverGamesHint}</p>
        {games.length > 0 && (
          <fieldset className="cover-grid">
            <legend className="visually-hidden">{texts.coverGames}</legend>
            {games.map((game) =>
              coverOption(
                { kind: "game", titleId: game.titleId },
                localName(game.names, language) || game.titleId,
                game.iconUrl,
                game.titleId,
              ),
            )}
          </fieldset>
        )}
      </div>

      <div className="look-group">
        <span className="look-heading">{texts.accentLabel}</span>
        <p className="hint look-hint">{texts.accentHint}</p>
        <fieldset className="swatches">
          <legend className="visually-hidden">{texts.accentLabel}</legend>
          {swatch(null, texts.accentNone)}
          {accentNames.map((name) => swatch(name, texts[`accent_${name}`]))}
        </fieldset>
      </div>

      {status.kind === "error" ? (
        <p className="error" role="alert">
          {status.text}
        </p>
      ) : (
        // Said to screen readers; the tick on the picked item shows it on screen.
        <output className="visually-hidden">{status.kind === "saved" ? texts.saved : ""}</output>
      )}
    </div>
  );
}
