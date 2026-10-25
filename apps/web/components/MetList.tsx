"use client";

import { Avatar } from "@/components/Avatar";
import { When } from "@/components/When";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import type { MetPlayer, MetPlayers } from "@/lib/psn";
import { json, social } from "@/lib/social";
import Link from "next/link";
import { useState } from "react";

/** Who the reader played with lately: befriend, block or forget each; and the switch that keeps
 *  (or stops keeping) meetings. */
export function MetList({ texts, initial, now }: { texts: UiStrings; initial: MetPlayers; now: number }) {
  const [players, setPlayers] = useState(initial.players);
  const [remember, setRemember] = useState(initial.remember);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { language } = texts;

  const update = (userId: string, change: Partial<MetPlayer>) =>
    setPlayers((list) => list.map((p) => (p.user.userId === userId ? { ...p, ...change } : p)));

  async function befriend(player: MetPlayer) {
    setBusy(player.user.userId);
    setError(null);
    const response = await fetch("/me/friends/requests", {
      method: "POST",
      ...json({ handle: player.user.handle }),
    }).catch(() => undefined);
    setBusy(null);
    if (!response?.ok) return setError(response?.status === 429 ? texts.tooMany : texts.failed);
    const body = (await response.json().catch(() => ({}))) as { state?: string };
    update(player.user.userId, { friendship: body.state === "accepted" ? "friends" : "pending_out" });
  }

  async function block(player: MetPlayer) {
    if (!window.confirm(fill(texts.confirmBlock, { name: player.user.displayName }))) return;
    setBusy(player.user.userId);
    const response = await fetch("/me/blocks", {
      method: "POST",
      ...json({ userId: player.user.userId }),
    }).catch(() => undefined);
    setBusy(null);
    if (!response?.ok) return setError(texts.failed);
    setPlayers((list) => list.filter((p) => p.user.userId !== player.user.userId));
  }

  async function forget(player: MetPlayer) {
    setBusy(player.user.userId);
    const done = await social(`me/players-met/${player.user.userId}`, { method: "DELETE" });
    setBusy(null);
    if (!done.ok && done.status !== 404) return setError(texts.failed);
    setPlayers((list) => list.filter((p) => p.user.userId !== player.user.userId));
  }

  async function toggle(next: boolean) {
    setRemember(next);
    const saved = await social("me/players-met", { method: "PATCH", ...json({ remember: next }) });
    if (!saved.ok) {
      setRemember(!next);
      return setError(texts.failed);
    }
    if (!next) setPlayers([]);
  }

  return (
    <>
      {players.length === 0 ? (
        <p className="empty">{remember ? texts.playersMetEmpty : texts.playersMetOff}</p>
      ) : (
        <ul className="people">
          {players.map((player) => (
            <li key={player.user.userId} className="person met-row">
              <Link href={`/u/${player.user.handle}`} className="who">
                <Avatar person={player.user} />
                <span className="lines">
                  <span className="name">
                    {player.user.displayName} <span className="handle">@{player.user.handle}</span>
                  </span>
                  <span className="meta">
                    <span className="met-source">{texts[`metVia_${player.source}`]}</span>{" "}
                    {player.game && <b>{localName(player.game.names, language) || player.game.titleId}</b>}
                    {player.game && " · "}
                    <When iso={player.lastMetAt} language={language} now={now} />
                    {player.times > 1 && ` · ${fill(texts.metTimes, { n: player.times })}`}
                  </span>
                </span>
              </Link>
              <div className="acts">
                {player.friendship === "friends" ? (
                  <span className="tag">{texts.friends}</span>
                ) : player.friendship === "pending_out" ? (
                  <span className="tag">{texts.requested}</span>
                ) : (
                  <button
                    type="button"
                    className="pill"
                    disabled={busy === player.user.userId}
                    onClick={() => befriend(player)}
                  >
                    {player.friendship === "pending_in" ? texts.accept : texts.add}
                  </button>
                )}
                <button
                  type="button"
                  className="pill"
                  disabled={busy === player.user.userId}
                  onClick={() => forget(player)}
                  title={texts.forget}
                >
                  {texts.forget}
                </button>
                <button
                  type="button"
                  className="pill danger"
                  disabled={busy === player.user.userId}
                  onClick={() => block(player)}
                >
                  {texts.block}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="toggles remember-row">
        <label className="toggle-row digest">
          <span className="lines">
            <span>{texts.rememberMet}</span>
            <span className="meta">{texts.rememberMetHint}</span>
          </span>
          <input type="checkbox" checked={remember} onChange={(event) => toggle(event.target.checked)} />
          <span className="toggle" />
        </label>
      </div>
    </>
  );
}
