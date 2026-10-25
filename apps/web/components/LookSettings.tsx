"use client";

import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { type AccentName, type CoverView, accentNames, accents, coverPresets, coverSrc } from "@/lib/psn";
import { json, social } from "@/lib/social";
import { useEffect, useState } from "react";

type Choice = { kind: "preset"; id: string } | { kind: "game"; titleId: string } | null;
const same = (a: Choice, b: Choice) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === "preset"
      ? a.id === (b as { id: string }).id
      : a.titleId === (b as { titleId: string }).titleId));

/** The profile's cover (a preset, or a game's artwork the server has) and accent, each saved as
 *  soon as it is picked. */
export function LookSettings({
  texts,
  cover,
  accent,
  games,
}: {
  texts: UiStrings;
  cover: CoverView | null;
  accent: AccentName | null;
  /** The owner's games that have artwork here. */
  games: { titleId: string; names: Record<string, string>; iconUrl: string }[];
}) {
  const [current, setCurrent] = useState<Choice>(
    cover
      ? cover.kind === "preset"
        ? { kind: "preset", id: cover.id }
        : { kind: "game", titleId: cover.id }
      : null,
  );
  const [tone, setTone] = useState<AccentName | null>(accent);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const { language } = texts;

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  async function save(change: { cover?: Choice; accent?: AccentName | null }) {
    const before = { current, tone };
    if (change.cover !== undefined) setCurrent(change.cover);
    if (change.accent !== undefined) setTone(change.accent);
    const saved = await social("me/look", { method: "PATCH", ...json(change) });
    if (!saved.ok) {
      setCurrent(before.current);
      setTone(before.tone);
      return setStatus("error");
    }
    setStatus("saved");
  }

  const coverOption = (choice: Choice, label: string, image: string | null, key: string) => (
    <label key={key} className={same(current, choice) ? "on" : undefined}>
      <input
        type="radio"
        name="cover"
        checked={same(current, choice)}
        onChange={() => save({ cover: choice })}
      />
      <span
        className={`thumb${image ? "" : " plain"}`}
        style={image ? { backgroundImage: `url("${image}")` } : undefined}
        aria-hidden="true"
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="look">
      <span className="look-label">{texts.coverLabel}</span>
      <fieldset className="cover-grid">
        <legend className="visually-hidden">{texts.coverLabel}</legend>
        {coverOption(null, texts.coverDefault, null, "default")}
        {coverPresets.map((id) => {
          const [palette, pattern] = id.split("-") as [string, string];
          const label = `${texts[`palette_${palette}` as "palette_cosmic"]} · ${texts[`pattern_${pattern}` as "pattern_grid"]}`;
          return coverOption({ kind: "preset", id }, label, coverSrc(id), id);
        })}
      </fieldset>
      <span className="look-label">{texts.coverGames}</span>
      {games.length === 0 ? (
        <p className="hint">{texts.coverGamesNone}</p>
      ) : (
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
      <span className="look-label">{texts.accentLabel}</span>
      <fieldset className="swatches">
        <legend className="visually-hidden">{texts.accentLabel}</legend>
        <label className={tone === null ? "on" : undefined}>
          <input type="radio" name="accent" checked={tone === null} onChange={() => save({ accent: null })} />
          <i style={{ "--swatch": "linear-gradient(135deg, #4f7cff, #b65cff)" } as React.CSSProperties} />
          {texts.accentNone}
        </label>
        {accentNames.map((name) => (
          <label key={name} className={tone === name ? "on" : undefined}>
            <input
              type="radio"
              name="accent"
              checked={tone === name}
              onChange={() => save({ accent: name })}
            />
            <i style={{ "--swatch": accents[name] } as React.CSSProperties} />
            {texts[`accent_${name}`]}
          </label>
        ))}
      </fieldset>
      <div className="save-row">
        {status === "error" ? (
          <p className="error" role="alert">
            {texts.failed}
          </p>
        ) : (
          <output className={`saved${status === "saved" ? " on" : ""}`}>
            {status === "saved" ? texts.saved : ""}
          </output>
        )}
      </div>
    </div>
  );
}
