import { z } from "zod";
import type { MemberView } from "./messages.js";

/** Where two people played together: a party, a share play, a game session or a looking-for-group
 *  post one let the other in on. */
export const meetingSources = ["party", "share_play", "game_session", "lfg"] as const;
export type MeetingSource = (typeof meetingSources)[number];

/** "Recently played with" shows this many days by default; a meeting is forgotten after
 *  `metKeepDays`. */
export const metListDays = 30;
export const metKeepDays = 90;
export const maxMetList = 100;

/** Someone the reader played with: the last time, where and in which game. */
export interface MetPlayer {
  user: MemberView;
  lastMetAt: string;
  firstMetAt: string;
  source: MeetingSource;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null } | null;
  /** How many times they met in the time kept. */
  times: number;
  friendship: "friends" | "pending_out" | "pending_in" | "none";
}

/** GET /me/players-met: the list, and whether meetings are remembered at all. */
export interface MetPlayersView {
  remember: boolean;
  days: number;
  players: MetPlayer[];
}

/** PATCH /me/players-met: turning remembering off forgets every meeting with the account, both
 *  ways, and none is kept from then on. */
export const MetSettingsUpdate = z.object({ remember: z.boolean() });
