import { z } from "zod";
import { type SignalKind, signalKinds } from "./calls.js";
import { compareVersions } from "./compat.js";
import { TitleId } from "./games.js";
import type { JoinCode } from "./joinCodes.js";
import type { MemberView } from "./messages.js";

/** The server half of playing online together: a launcher opens a session for the game it runs,
 *  friends see it is joinable, and a joiner gets the details. What the details mean is up to the
 *  launchers; the server keeps `properties` as opaque JSON. */
export const maxSessionPlayers = 16;
export const maxSessionProperties = 4096;
/** What one player may publish about themselves (their launcher's endpoints, a public key). */
export const maxMemberProperties = 2048;

/** "1.02", "01.000.002": the game's own version as the launcher reads it. */
const GameVersion = z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/, "a game version like 1.02");
/** The engine build: only the same build can be relied on to talk to itself. */
const EngineBuild = z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/, "an engine build like 0.2.13-4194");
/** What kind of playing together a session is:
 *  - `online`: the game's own online play through the launchers (the default, as before);
 *  - `lan`: Play Together for a game that finds others on the local network. It belongs to the
 *    host's party (or whoever holds its join code), its host never changes, and it ends when the
 *    host leaves, the host's game exits or the host's launcher goes away;
 *  - `local`: several people on one screen; friends see it, nobody joins over the network. */
export const gameSessionKinds = ["online", "lan", "local"] as const;
export type GameSessionKind = (typeof gameSessionKinds)[number];

/** How far a joiner's game version may be from the host's: the same (`exact`), the same first
 *  dot-separated part (`major`: 01.044.000 fits 01.050.000, not 02.000.000) or any. The host's
 *  launcher knows the game and sets it. */
export const versionRules = ["exact", "major", "any"] as const;
export type VersionRule = (typeof versionRules)[number];

/** Whether a joiner's game version fits the host's under the rule. */
export function versionFits(rule: VersionRule, host: string, joiner: string): boolean {
  if (rule === "any") return true;
  if (rule === "major") return Number(host.split(".")[0]) === Number(joiner.split(".")[0]);
  return host === joiner;
}

/** Why a joiner cannot play in a session: a different game version (and who should update) or
 *  a different engine build. */
export interface JoinRefusal {
  reason: "game_version" | "engine";
  expected: string;
  actual: string;
  /** Who is behind: the joiner (`you`) or the host. */
  update: "you" | "host";
  /** The joiner may try anyway (join again with `overrideVersion`): only a game version
   *  refusal, never a different engine build. */
  overridable: boolean;
}

/** Null when the joiner's game version and engine build fit the session's. */
export function joinRefusal(
  session: { gameVersion: string; engineBuild: string; versionRule: VersionRule },
  joiner: { gameVersion: string; engineBuild: string },
): JoinRefusal | null {
  if (!versionFits(session.versionRule, session.gameVersion, joiner.gameVersion))
    return {
      reason: "game_version",
      expected: session.gameVersion,
      actual: joiner.gameVersion,
      update: compareVersions(joiner.gameVersion, session.gameVersion) < 0 ? "you" : "host",
      overridable: true,
    };
  if (joiner.engineBuild !== session.engineBuild)
    return {
      reason: "engine",
      expected: session.engineBuild,
      actual: joiner.engineBuild,
      update: compareVersions(joiner.engineBuild, session.engineBuild) < 0 ? "you" : "host",
      overridable: false,
    };
  return null;
}

const Properties = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= maxSessionProperties, "at most 4 KB of properties");

export const GameSessionOpen = z.object({
  kind: z.enum(gameSessionKinds).default("online"),
  titleId: TitleId,
  gameVersion: GameVersion,
  engineBuild: EngineBuild,
  capacity: z.number().int().min(2).max(maxSessionPlayers),
  joinable: z.boolean().default(true),
  versionRule: z.enum(versionRules).default("exact"),
  properties: Properties.default({}),
});

/** Why a host ends a session: they ended it, or their game exited. */
export const GameSessionEndReason = z.enum(["ended", "game_exited"]).default("ended");

export const GameSessionUpdate = z
  .object({
    capacity: z.number().int().min(2).max(maxSessionPlayers).optional(),
    joinable: z.boolean().optional(),
    properties: Properties.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

/** `overrideVersion`: the player pressed "Try anyway" after a game version refusal; the version
 *  check is skipped (and recorded), the engine build is still checked. */
export const GameSessionJoin = z.object({
  gameVersion: GameVersion,
  engineBuild: EngineBuild,
  overrideVersion: z.boolean().default(false),
});

/** A player's own properties in the session, replaced whole; opaque to the server and seen only by
 *  the session's players. */
export const GameSessionMemberUpdate = z.object({
  properties: z
    .record(z.unknown())
    .refine((value) => JSON.stringify(value).length <= maxMemberProperties, "at most 2 KB of properties"),
});
export const GameSessionInvite = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(maxSessionPlayers),
});

/** A player as the session's players see them: what they published, and from which device. */
export interface GameSessionMember {
  userId: string;
  /** The device (session ID) that last published properties: where signals for it go. */
  device: string | null;
  properties: Record<string, unknown>;
  joinedAt: string;
  /** Their game version when they joined (null for players from before it was kept). */
  gameVersion: string | null;
  /** They joined with a game version that did not fit, by trying anyway. */
  versionOverride: boolean;
  /** When the properties were last published; null before the first time. */
  updatedAt: string | null;
}

export interface GameSessionView {
  id: string;
  kind: GameSessionKind;
  /** The party a `lan` session belongs to; null for others and for a host not in a party. */
  partyId: string | null;
  host: MemberView | null;
  titleId: string;
  gameVersion: string;
  engineBuild: string;
  versionRule: VersionRule;
  capacity: number;
  joinable: boolean;
  players: MemberView[];
  /** The join code the host handed out, while it works (players only). */
  joinCode?: JoinCode | null;
  /** Each player in join order with their own properties; only the players themselves see it. */
  members?: GameSessionMember[];
  properties: Record<string, unknown>;
  createdAt: string;
  endedAt: string | null;
}

/** In the host's presence while they host (and, for Play Together, every player's): friends see
 *  the game and whether there is room. */
export interface GamePresence {
  sessionId: string;
  titleId: string;
  kind: GameSessionKind;
  hostId: string;
  /** Open to friends and not full (never for `lan` and `local`: the party or a code gets in). */
  joinable: boolean;
  players: number;
  capacity: number;
}

/** A party's Play Together game while one runs, in the party's view. */
export interface PartyTogether {
  sessionId: string;
  hostId: string;
  titleId: string;
  gameVersion: string;
  engineBuild: string;
  versionRule: VersionRule;
  /** Who plays, the host first. */
  players: string[];
  /** The players who joined with a game version that did not fit, by trying anyway. */
  versionOverrides: string[];
  capacity: number;
  startedAt: string;
}

/** Why a session ended: the host ended it, left it, their game exited, they left the party, their
 *  launcher went away, or they opened another. */
export type GameSessionEnded =
  | "ended"
  | "host_left"
  | "game_exited"
  | "host_left_party"
  | "host_gone"
  | "replaced";
/** Why a player is no longer in a session. */
export type GameSessionLeft = "left" | "left_party" | "gone";

export type GameSessionEvent =
  | {
      type: "game_session.invite";
      data: {
        sessionId: string;
        from: MemberView;
        titleId: string;
        gameVersion: string;
        engineBuild: string;
      };
    }
  /** Someone joined or left, or the host changed it; the session as it is now. */
  | { type: "game_session.updated"; data: GameSessionView }
  /** A party member started Play Together: the rest of the party hears it, to join. */
  | { type: "game_session.started"; data: { partyId: string; session: GameSessionView } }
  | { type: "game_session.member_joined"; data: { sessionId: string; member: MemberView } }
  | { type: "game_session.member_left"; data: { sessionId: string; userId: string; reason: GameSessionLeft } }
  | { type: "game_session.ended"; data: { sessionId: string; reason: GameSessionEnded } }
  /** A player's signalling (offers, candidates, anything the launchers agree on), relayed by the
   *  gateway between the session's players and never stored. */
  | {
      type: "game_session.signal";
      data: { sessionId: string; from: string; device: string; kind: GameSignalKind; data: unknown };
    };

/** The call kinds, and "message" for anything else the launchers say to each other. */
export const gameSignalKinds = [...signalKinds, "message"] as const;
export type GameSignalKind = SignalKind | "message";

/** Who may signal in a game session (its players' user IDs), and what each published
 *  (user ID → {device, properties, updatedAt}); kept by the API, a day after the last change. */
export const gameSessionMembersKey = (sessionId: string) => `game-session:${sessionId}:members`;
export const gameSessionPropertiesKey = (sessionId: string) => `game-session:${sessionId}:properties`;
export const gameSessionKeepSeconds = 86_400;

/** The devices playing in a Play Together session (device → session IDs), and the devices whose
 *  gateway socket went (score: when the grace runs out, member `userId:device`). */
export const deviceGameSessionsKey = (device: string) => `device-games:${device}`;
export const gameDeparturesKey = "game-departures";
