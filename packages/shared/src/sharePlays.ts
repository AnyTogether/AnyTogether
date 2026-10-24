import { z } from "zod";
import type { IceServer } from "./calls.js";
import { type GameSignalKind, gameSignalKinds } from "./gameSessions.js";
import { TitleId } from "./games.js";
import type { MemberView } from "./messages.js";

/** Share play: a host streams the game they run to friends (WebRTC, host → each viewer), and lets
 *  a viewer play along as player 2, 3 or 4 with their own pad. The server introduces them, relays
 *  the signalling and keeps who watches and who holds which pad; the picture, the sound and the
 *  pad never pass through it. State lives in Valkey only: a share play lasts as long as the game. */

/** The host uploads one stream per viewer, so a handful at most. */
export const maxShareViewers = 4;
/** Player 1 is the host; a viewer may be handed one of these. */
export const sharePadSlots = [2, 3, 4] as const;
export type SharePadSlot = (typeof sharePadSlots)[number];

const GameName = z.string().trim().min(1).max(80);

export const SharePlayStart = z.object({
  titleId: TitleId,
  /** The game's name as the launcher shows it, for viewers who do not know the title ID. */
  title: GameName.optional(),
  /** Friends may walk in without an invite. */
  open: z.boolean().default(true),
  maxViewers: z.number().int().min(1).max(maxShareViewers).default(2),
});

export const SharePlayUpdate = z
  .object({
    titleId: TitleId.optional(),
    title: GameName.nullable().optional(),
    open: z.boolean().optional(),
    maxViewers: z.number().int().min(1).max(maxShareViewers).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

export const SharePlayInvite = z.object({ userIds: z.array(z.string().uuid()).min(1).max(8) });

/** The host hands a viewer a pad (2-4), or takes it back (null). */
export const SharePlaySlot = z.object({
  slot: z.union([z.literal(2), z.literal(3), z.literal(4), z.null()]),
});

export interface SharePlayViewer {
  user: MemberView;
  /** The device (session) they watch on: where the host's signals for them go. */
  device: string;
  /** The pad they play with, or null while they only watch. */
  slot: SharePadSlot | null;
  joinedAt: string;
}

export interface SharePlayView {
  id: string;
  host: MemberView | null;
  /** The host's device (session): where a viewer's signals go. */
  hostDevice: string;
  titleId: string;
  title: string | null;
  open: boolean;
  maxViewers: number;
  viewers: SharePlayViewer[];
  /** People invited who have not come yet; only the host sees them. */
  invited?: MemberView[];
  startedAt: string;
}

/** What starting and joining return: the share play, and the ICE servers to reach each other. */
export interface SharePlayJoin {
  sharePlay: SharePlayView;
  iceServers: IceServer[];
  /** When the TURN credentials stop working. */
  expiresAt: string | null;
}

export interface SharePlayInviteView {
  sharePlayId: string;
  from: MemberView | null;
  titleId: string;
  title: string | null;
  invitedAt: string;
}

/** In the host's presence while they share: friends see the game and whether there is room. */
export interface SharePresence {
  sharePlayId: string;
  titleId: string;
  title: string | null;
  /** Open to friends and not full. */
  open: boolean;
  viewers: number;
  maxViewers: number;
}

export type SharePlayEvent =
  | {
      type: "share_play.invite";
      data: { sharePlayId: string; from: MemberView; titleId: string; title: string | null };
    }
  /** Someone came or went, a pad was handed over or taken back, or the host changed it. */
  | { type: "share_play.updated"; data: SharePlayView }
  /** Over for this person: the host stopped (ended), or took them out (removed). */
  | { type: "share_play.ended"; data: { sharePlayId: string; reason: "ended" | "removed" } }
  /** Signalling between the host and a viewer, relayed by the gateway and never stored. */
  | {
      type: "share_play.signal";
      data: { sharePlayId: string; from: string; device: string; kind: GameSignalKind; data: unknown };
    };

export const shareSignalKinds = gameSignalKinds;

/** The share play itself (JSON), its viewers (user ID → {device, slot, joinedAt}), who may signal in
 *  it (host and viewers), who is invited (user ID → {from, at}), and who the host took out. */
export const sharePlayKey = (id: string) => `share-play:${id}`;
export const sharePlayViewersKey = (id: string) => `share-play:${id}:viewers`;
export const sharePlayMembersKey = (id: string) => `share-play:${id}:members`;
export const sharePlayInvitesKey = (id: string) => `share-play:${id}:invites`;
export const sharePlayRemovedKey = (id: string) => `share-play:${id}:removed`;
/** The share play a user hosts, and the one they watch. */
export const hostSharePlayKey = (userId: string) => `share-host:${userId}`;
export const watchSharePlayKey = (userId: string) => `share-watch:${userId}`;
/** Share plays a user is invited to (share play ID → invited at). */
export const userShareInvitesKey = (userId: string) => `share-invites:${userId}`;
/** Share plays a device hosts or watches, so it can be taken out when its socket is gone. */
export const deviceSharePlaysKey = (device: string) => `device-shares:${device}`;
/** Devices whose gateway socket closed while in a share play, as "userId:device", scored by when
 *  the API takes them out (a host's share play ends); a device back by then stays in. */
export const shareDeparturesKey = "share-departures";
/** Renewed by everything the host and the viewers do; a forgotten share play goes by itself. */
export const sharePlayKeepSeconds = 12 * 3600;
