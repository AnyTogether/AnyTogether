import { z } from "zod";
import { TitleId } from "./games.js";
import type { MemberView } from "./messages.js";

/** The server half of playing online together: a launcher opens a session for the game it runs,
 *  friends see it is joinable, and a joiner gets the details. What the details mean is up to the
 *  launchers; the server keeps `properties` as opaque JSON. */
export const maxSessionPlayers = 16;
export const maxSessionProperties = 4096;

/** "1.02", "01.000.002": the game's own version as the launcher reads it. */
const GameVersion = z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/, "a game version like 1.02");
/** The engine build: only the same build can be relied on to talk to itself. */
const EngineBuild = z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/, "an engine build like 0.2.13-4194");
const Properties = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= maxSessionProperties, "at most 4 KB of properties");

export const GameSessionOpen = z.object({
  titleId: TitleId,
  gameVersion: GameVersion,
  engineBuild: EngineBuild,
  capacity: z.number().int().min(2).max(maxSessionPlayers),
  joinable: z.boolean().default(true),
  properties: Properties.default({}),
});

export const GameSessionUpdate = z
  .object({
    capacity: z.number().int().min(2).max(maxSessionPlayers).optional(),
    joinable: z.boolean().optional(),
    properties: Properties.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

export const GameSessionJoin = z.object({ gameVersion: GameVersion, engineBuild: EngineBuild });
export const GameSessionInvite = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(maxSessionPlayers),
});

export interface GameSessionView {
  id: string;
  host: MemberView | null;
  titleId: string;
  gameVersion: string;
  engineBuild: string;
  capacity: number;
  joinable: boolean;
  players: MemberView[];
  properties: Record<string, unknown>;
  createdAt: string;
  endedAt: string | null;
}

/** In the host's presence while they host: friends see the game and whether there is room. */
export interface GamePresence {
  sessionId: string;
  titleId: string;
  /** Open to friends and not full. */
  joinable: boolean;
  players: number;
  capacity: number;
}

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
  | { type: "game_session.ended"; data: { sessionId: string } };
