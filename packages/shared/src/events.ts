import type { CallEvent, SignalKind } from "./calls.js";
import type { FeedEvent } from "./feed.js";
import type { GamePresence, GameSessionEvent, GameSignalKind } from "./gameSessions.js";
import type { MessageEvent } from "./messages.js";
import type { PartyEvent, PartyPresence } from "./parties.js";
import type { SharePlayEvent, SharePresence } from "./sharePlays.js";

/** What the realtime gateway pushes; the API publishes them for each recipient. */
export type GatewayEvent =
  | { type: "account.signed_out"; data: { sessionId: string } }
  | {
      type: "presence.updated";
      data: {
        userId: string;
        state: PresenceState;
        titleId?: string;
        since?: string;
        party?: PartyPresence;
        game?: GamePresence;
        share?: SharePresence;
      };
    }
  | { type: "auth.handoff"; data: { handoffId: string; deviceName: string; client: string } }
  | { type: "friend.request"; data: { userId: string; handle: string; displayName: string } }
  | { type: "friend.accepted"; data: { userId: string; handle: string; displayName: string } }
  | { type: "friend.removed"; data: { userId: string } }
  | {
      type: "trophy.earned";
      /** name is null for a hidden trophy: friends who have not earned it do not learn it. */
      data: {
        userId: string;
        handle: string;
        displayName: string;
        titleId: string;
        trophyId: number;
        grade: "bronze" | "silver" | "gold" | "platinum";
        name: string | null;
      };
    }
  | MessageEvent
  | PartyEvent
  | CallEvent
  | GameSessionEvent
  | SharePlayEvent
  | FeedEvent;

export type PresenceState = "online" | "away" | "in_game" | "offline";

/** Frames on the gateway socket. */
export type ClientFrame =
  /** `token` is an access token; a browser, which never holds one, sends a one-time `ticket`. */
  | { op: "hello"; token?: string; ticket?: string; client?: string; resume?: string }
  | {
      op: "heartbeat";
      presence?: { state: Exclude<PresenceState, "offline">; titleId?: string; since?: string };
    }
  /** Typing in a conversation: the other members hear it (at most every 2 s). */
  | { op: "typing"; conversation: string }
  /** WebRTC signalling to a peer in the same call: `device` is their session, or "*" for all. */
  | { op: "signal"; to: string; device?: string; call: string; kind: SignalKind; data: unknown }
  /** The same between two players of a game session (`session` is its ID, not a device). */
  | {
      op: "signal";
      to: string;
      device?: string;
      session: string;
      kind: GameSignalKind;
      data: unknown;
      call?: undefined;
    }
  /** The same between the host and a viewer of a share play (`share` is its ID). */
  | {
      op: "signal";
      to: string;
      device?: string;
      share: string;
      kind: GameSignalKind;
      data: unknown;
      call?: undefined;
      session?: undefined;
    };

export type ServerFrame =
  | { op: "ready"; session: string; heartbeat: number }
  | { op: "event"; id: string; type: GatewayEvent["type"]; data: unknown }
  | { op: "error"; code: string; message: string };

export const userChannel = (userId: string) => `user:${userId}`;
export const userEvents = (userId: string) => `events:${userId}`;
/** A one-time gateway ticket by the SHA-256 of its secret (hex): {userId, sessionId}, 30 s. */
export const realtimeTicketKey = (hash: string) => `rt-ticket:${hash}`;
export const realtimeTicketSeconds = 30;

/** Each user's friends, kept by the API for the gateway's presence fan-out. */
export const friendsKey = (userId: string) => `friends:${userId}`;
/** One device's presence while its socket is open, kept by the gateway (60 s, renewed by
 *  heartbeats): the API reads it to tell a device that is still there from one that is gone. */
export const devicePresenceKey = (userId: string, sessionId: string) => `presence:${userId}:${sessionId}`;
/** A user's presence merged over their devices, kept by the gateway. */
export const presenceKey = (userId: string) => `presence:${userId}`;
/** Set (by the API) while a user hides their presence from everyone: the gateway then keeps it to
 *  itself and tells no one. */
export const presenceHiddenKey = (userId: string) => `presence-hidden:${userId}`;
