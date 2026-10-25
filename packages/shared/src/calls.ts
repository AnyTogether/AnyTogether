import { z } from "zod";
import type { MemberView } from "./messages.js";

/** A call to a friend, or the voice of the party you are in. */
export const CallCreate = z
  .object({ partyId: z.string().uuid().optional(), userId: z.string().uuid().optional() })
  .refine((value) => Boolean(value.partyId) !== Boolean(value.userId), { message: "partyId or userId" });

/** Muting yourself in a call: the others are told, and see it in the call and the party.
 *  Deafened (hearing no one) is always muted too: deafening mutes, and unmuting undeafens. */
export const CallMute = z.object({ muted: z.boolean(), deafened: z.boolean().optional() });

/** TURN REST credentials live this long; GET /ice-servers renews them for a long call. */
export const turnCredentialSeconds = 12 * 3600;

export const signalKinds = ["offer", "answer", "candidate", "bye", "renegotiate"] as const;
export type SignalKind = (typeof signalKinds)[number];

/** As RTCPeerConnection takes them. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Who is in a call now, by user, with the device (session) they are in it on. */
export interface CallPeer {
  userId: string;
  device: string;
  /** They muted themselves. */
  muted: boolean;
  /** They hear no one (and are muted). */
  deafened: boolean;
}

export interface CallView {
  id: string;
  kind: "direct" | "party";
  partyId: string | null;
  startedBy: string | null;
  /** The person called, for a direct call. */
  calleeId: string | null;
  in: CallPeer[];
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

/** What POST /calls and answering return: the call, and the ICE servers to reach the others. */
export interface CallJoin {
  call: CallView;
  iceServers: IceServer[];
  /** When the TURN credentials stop working. */
  expiresAt: string | null;
}

export type CallEvent =
  /** Rings on every device of the person called. */
  | { type: "call.ringing"; data: { callId: string; from: MemberView; device: string } }
  /** Answered on one device: the others stop ringing; the caller starts talking to `device`. */
  | { type: "call.answered"; data: { callId: string; userId: string; device: string } }
  | { type: "call.joined"; data: { callId: string; partyId: string | null; userId: string; device: string } }
  | { type: "call.left"; data: { callId: string; partyId: string | null; userId: string } }
  /** A member muted or unmuted, deafened or undeafened themselves. */
  | {
      type: "call.updated";
      data: { callId: string; partyId: string | null; userId: string; muted: boolean; deafened: boolean };
    }
  | {
      type: "call.ended";
      data: { callId: string; partyId: string | null; reason: "ended" | "declined" | "party_ended" };
    }
  /** A peer's offer, answer, ICE candidate or bye, relayed by the gateway and never stored. */
  | {
      type: "signal";
      data: { call: string; from: string; device: string; kind: SignalKind; data: unknown };
    };

/** Who may signal in a call (a set of user IDs), and who is in it now (user ID → device). */
export const callMembersKey = (callId: string) => `call:${callId}:members`;
export const callInKey = (callId: string) => `call:${callId}:in`;
/** Who in a call muted themselves (a set of user IDs). */
export const callMutedKey = (callId: string) => `call:${callId}:muted`;
/** Who in a call deafened themselves (a set of user IDs, all of them in the muted set too). */
export const callDeafenedKey = (callId: string) => `call:${callId}:deafened`;
/** The calls a device (session) is in now, so it can be taken out when its socket is gone. */
export const deviceCallsKey = (device: string) => `device-calls:${device}`;
/** Devices whose gateway socket closed while in a call, as "userId:device", scored by when the API
 *  takes them out of their calls; a device back on the gateway by then stays in. */
export const callDeparturesKey = "call-departures";
/** Long enough to ride out a reconnect, short enough that nobody talks to an empty seat for long. */
export const callDepartureGraceMs = 20_000;
