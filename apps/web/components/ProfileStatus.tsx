"use client";

import { useLiveEvents } from "@/components/Live";
import type { UiStrings } from "@/lib/i18n";
import { type Presence, fill, listeningLine, presenceDot } from "@/lib/people";
import { type PresenceStatus, profilePresenceAfter } from "@/lib/presenceMode";
import { useEffect, useState } from "react";

type Texts = Pick<
  UiStrings,
  "inGame" | "listeningTo" | "listeningToBy" | "stateDnd" | "stateIdle" | "stateOnline"
>;

/** The status line under a profile's name (Online, Idle, Do Not Disturb, or the game), kept live
 *  by the gateway like the mark on one's own avatar in the header: a friend's presence.updated,
 *  and on one's own profile presence.mode, so a status picked in the launcher shows here at once.
 *  Nothing while offline. Signed out there is no socket and the line stays as loaded. Under it,
 *  for friends, what the person listens to while they share it. */
export function ProfileStatus({
  userId,
  self,
  initial,
  picked,
  games,
  texts,
}: {
  userId: string;
  self: boolean;
  initial: Presence | undefined;
  /** One's own picked status (self only; anyone else's is not known to the reader). */
  picked: PresenceStatus;
  /** Game names by title ID, in the reader's language, for "Playing …". */
  games: Record<string, string>;
  texts: Texts;
}) {
  const [shown, setShown] = useState({ presence: initial ?? { state: "offline" as const }, picked });
  useEffect(() => setShown({ presence: initial ?? { state: "offline" }, picked }), [initial, picked]);
  useLiveEvents((event) => setShown((current) => profilePresenceAfter(current, event, { userId, self })));
  const { presence } = shown;
  if (presence.state === "offline") return null;
  const dot = presenceDot(presence);
  const playing = presence.state === "in_game";
  const heard = listeningLine(presence, texts);
  return (
    <>
      <p className={`status in d2 ${playing ? "playing" : dot}`}>
        {playing
          ? fill(texts.inGame, {
              title: (presence.titleId && games[presence.titleId]) || (presence.titleId ?? "?"),
            })
          : dot === "dnd"
            ? texts.stateDnd
            : dot === "idle"
              ? texts.stateIdle
              : texts.stateOnline}
      </p>
      {heard && (
        <p className="listening in d2">
          <span className="eq" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="heard">{heard}</span>
        </p>
      )}
    </>
  );
}
