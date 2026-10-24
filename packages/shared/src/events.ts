import type { MessageEvent } from "./messages.js";
import type { PartyEvent, PartyPresence } from "./parties.js";

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
  | PartyEvent;

export type PresenceState = "online" | "away" | "in_game" | "offline";

/** Frames on the gateway socket. */
export type ClientFrame =
  | { op: "hello"; token: string; client?: string; resume?: string }
  | {
      op: "heartbeat";
      presence?: { state: Exclude<PresenceState, "offline">; titleId?: string; since?: string };
    };

export type ServerFrame =
  | { op: "ready"; session: string; heartbeat: number }
  | { op: "event"; id: string; type: GatewayEvent["type"]; data: unknown }
  | { op: "error"; code: string; message: string };

export const userChannel = (userId: string) => `user:${userId}`;
export const userEvents = (userId: string) => `events:${userId}`;

/** Each user's friends, kept by the API for the gateway's presence fan-out. */
export const friendsKey = (userId: string) => `friends:${userId}`;
/** A user's presence merged over their devices, kept by the gateway. */
export const presenceKey = (userId: string) => `presence:${userId}`;
/** Set (by the API) while a user hides their presence from everyone: the gateway then keeps it to
 *  itself and tells no one. */
export const presenceHiddenKey = (userId: string) => `presence-hidden:${userId}`;
