import type { TogetherStrings } from "./i18n-together";
import type { Person } from "./people";

/** A Play Together game in someone's presence (what the API adds while they play in one). */
export interface GamePresence {
  sessionId: string;
  titleId: string;
  kind: "online" | "lan" | "local";
  hostId: string;
  joinable: boolean;
  players: number;
  capacity: number;
}

/** The party's Play Together game, as the party view carries it. */
export interface PartyTogether {
  sessionId: string;
  hostId: string;
  titleId: string;
  gameVersion: string;
  engineBuild: string;
  versionRule: "exact" | "major" | "any";
  players: string[];
  capacity: number;
  startedAt: string;
}

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** "Playing Minecraft together (2/4)" for a friend in a LAN game; null otherwise. */
export function playingTogether(
  presence: { state: string; game?: GamePresence },
  texts: TogetherStrings,
  names: Map<string, string>,
): string | null {
  const game = presence.game;
  if (!game || game.kind !== "lan" || presence.state === "offline") return null;
  return fill(texts.togetherPlaying, {
    game: names.get(game.titleId) ?? game.titleId,
    n: game.players,
    max: game.capacity,
  });
}

/** What the party page shows of its Play Together game. */
export function togetherCard(
  together: PartyTogether,
  members: Person[],
  me: string,
  texts: TogetherStrings,
  names: Map<string, string>,
) {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const host = byId.get(together.hostId);
  const game = names.get(together.titleId) ?? together.titleId;
  const inGame = new Set(together.players);
  return {
    heading: fill(texts.togetherStarted, { name: host?.displayName ?? "?", game }),
    game,
    places: `${together.players.length}/${together.capacity}`,
    version: fill(texts.togetherVersion, { version: together.gameVersion }),
    players: together.players.flatMap((id) => byId.get(id) ?? []),
    waiting: members.filter((m) => !inGame.has(m.userId)),
    playing: inGame.has(me),
    host: together.hostId === me,
  };
}

/** Live events after which the party's Play Together game is read again. */
export const isTogetherEvent = (type: string) =>
  [
    "game_session.started",
    "game_session.member_joined",
    "game_session.member_left",
    "game_session.ended",
  ].includes(type);
