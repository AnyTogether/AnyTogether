"use client";

import type { EarnedTrophy, LibraryGame } from "@/lib/games";
import { localName, trophyText } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { maxPins, togglePin } from "@/lib/psn";
import { json, social } from "@/lib/social";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

type Pin = { titleId: string; trophyId: number };
/** The editor's six slots, by name. */
const slots = Array.from({ length: maxPins }, (_, i) => `slot-${i}`);
const key = (pin: Pin) => `${pin.titleId}/${pin.trophyId}`;

/** The owner picks up to six of their trophies and games to pin, both kinds together. */
export function ShowcaseEditor({
  texts,
  trophies,
  games,
  pinned,
}: {
  texts: UiStrings;
  trophies: EarnedTrophy[];
  games: LibraryGame[];
  pinned: { trophies: Pin[]; games: string[] };
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  // A showcase saved before the shared limit may hold more: it opens trimmed to six.
  const [chosen, setChosen] = useState(() => {
    const trophies = pinned.trophies.slice(0, maxPins);
    return { trophies, games: pinned.games.slice(0, maxPins - trophies.length) };
  });
  const pins = chosen.trophies;
  const favourites = chosen.games;
  const full = pins.length + favourites.length >= maxPins;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { language } = texts;

  // Pinned trophies stay pickable even when they are older than the latest ones listed.
  const choices = [
    ...trophies,
    ...pinned.trophies
      .filter((p) => !trophies.some((t) => key(t) === key(p)))
      .map(
        (p) =>
          ({ ...p, gameNames: {}, grade: "bronze", hidden: false, texts: null }) as unknown as EarnedTrophy,
      ),
  ];

  const toggleTrophy = (pin: Pin) =>
    setChosen((now) => togglePin(now, "trophies", pin, (a, b) => key(a as Pin) === key(b as Pin)));
  const toggleGame = (titleId: string) => setChosen((now) => togglePin(now, "games", titleId));

  async function save() {
    setBusy(true);
    setError(null);
    const saved = await social("me/showcase", {
      method: "PUT",
      ...json({ trophies: pins, games: favourites }),
    });
    setBusy(false);
    if (!saved.ok) return setError(saved.status === 429 ? texts.tooMany : texts.failed);
    dialog.current?.close();
    router.refresh();
  }

  return (
    <>
      <button type="button" className="pill" onClick={() => dialog.current?.showModal()}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
          <path d="M14.5 4.5l5 5L9 20H4v-5zM12.5 6.5l5 5" />
        </svg>
        {texts.editShowcase}
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby={heading}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") dialog.current?.close();
        }}
      >
        <div className="sheet-body">
          <h3 id={heading}>{texts.editShowcase}</h3>
          <p className="pin-count" aria-live="polite">
            <span className="pin-dots" aria-hidden="true">
              {slots.map((slot, i) => (
                <i
                  key={slot}
                  className={
                    i < pins.length ? "trophy" : i < pins.length + favourites.length ? "game" : undefined
                  }
                />
              ))}
            </span>
            {fill(texts.showcaseCount, { n: pins.length + favourites.length })}
            <span className="hint">{texts.showcaseLimit}</span>
          </p>
          <div className="picker">
            <span className="pick-head">{texts.showcasePickTrophies}</span>
            {choices.length === 0 && <p className="hint">{texts.noTrophies}</p>}
            {choices.map((trophy) => {
              const on = pins.some((p) => key(p) === key(trophy));
              return (
                <label key={key(trophy)} className={`pick${on ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => toggleTrophy({ titleId: trophy.titleId, trophyId: trophy.trophyId })}
                  />
                  <span className={`cup ${trophy.grade}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8" />
                    </svg>
                  </span>
                  <span className="lines">
                    <span className="name">
                      {trophyText(trophy.texts, language)?.name ?? `#${trophy.trophyId}`}
                    </span>
                    <span className="meta">{localName(trophy.gameNames, language) || trophy.titleId}</span>
                  </span>
                </label>
              );
            })}
            <span className="pick-head">{texts.showcasePickGames}</span>
            {games.length === 0 && <p className="hint">{texts.noGames}</p>}
            {games.map((game) => {
              const on = favourites.includes(game.titleId);
              return (
                <label key={game.titleId} className={`pick${on ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={() => toggleGame(game.titleId)}
                  />
                  <span className="lines">
                    <span className="name">{localName(game.names, language) || game.titleId}</span>
                    <span className="meta">{game.titleId}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="pill" onClick={() => dialog.current?.close()}>
              {texts.cancel}
            </button>
            <button type="button" className="primary small" disabled={busy} onClick={save}>
              {texts.save}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
