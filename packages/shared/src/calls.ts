import { z } from "zod";
import type { MemberView } from "./messages.js";

/** A call to a friend, or the voice of the party you are in. */
export const CallCreate = z
  .object({ partyId: z.string().uuid().optional(), userId: z.string().uuid().optional() })
  .refine((value) => Boolean(value.partyId) !== Boolean(value.userId), { message: "partyId or userId" });

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
