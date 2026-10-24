"use client";

import type { BoardGame } from "@/lib/feed";
import { localName } from "@/lib/games";
import { useRef } from "react";

/** The game picker of the leaderboards page: a plain GET form, sent as soon as a game is picked. */
export function BoardPicker({
  games,
  current,
  scope,
  by,
  texts,
}: {
  games: BoardGame[];
  current: string;
  scope: string;
  by: string;
  texts: {
    language: string;
    overall: string;
    pickGame: string;
    show: string;
    yourGames: string;
    mostPlayed: string;
  };
}) {
  const form = useRef<HTMLFormElement>(null);
  const mine = games.filter((g) => g.mine);
  const others = games.filter((g) => !g.mine);
  const option = (game: BoardGame) => (
    <option key={game.titleId} value={game.titleId}>
      {localName(game.names, texts.language) || game.titleId}
    </option>
  );
  return (
    <form ref={form} method="get" action="/leaderboards" className="board-picker">
      <label htmlFor="board-game" className="visually-hidden">
        {texts.pickGame}
      </label>
      <select
        id="board-game"
        name="game"
        defaultValue={current}
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="">{texts.overall}</option>
        {mine.length > 0 && others.length > 0 ? (
          <>
            <optgroup label={texts.yourGames}>{mine.map(option)}</optgroup>
            <optgroup label={texts.mostPlayed}>{others.map(option)}</optgroup>
          </>
        ) : (
          games.map(option)
        )}
      </select>
      <input type="hidden" name="scope" value={scope} />
      {current && <input type="hidden" name="by" value={by} />}
      <noscript>
        <button type="submit" className="pill">
          {texts.show}
        </button>
      </noscript>
    </form>
  );
}
