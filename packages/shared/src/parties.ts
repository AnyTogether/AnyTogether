import { z } from "zod";
import type { MemberView } from "./messages.js";

/** Voice in a party is a peer-to-peer mesh, so a party holds at most eight people. */
export const maxPartySize = 8;

/** invite: only people a member invited may join; friends: the leader's friends may join too. */
export const partyPrivacies = ["invite", "friends"] as const;
export type PartyPrivacy = (typeof partyPrivacies)[number];

const UserId = z.string().uuid();

export const PartyCreate = z.object({ privacy: z.enum(partyPrivacies).default("invite") });
export const PartyUpdate = z.object({ privacy: z.enum(partyPrivacies) });
export const PartyInvite = z.object({
  userIds: z
    .array(UserId)
    .min(1)
    .max(maxPartySize - 1),
});
export const PartyTarget = z.object({ userId: UserId });

export interface PartyView {
  id: string;
  leaderId: string;
  privacy: PartyPrivacy;
  members: (MemberView & { joinedAt: string })[];
  /** People invited who have not answered yet. */
  invited: MemberView[];
  /** The party's voice call while one runs: its ID and who is in it. */
  call: { id: string; in: string[] } | null;
  createdAt: string;
}

/** Shown to friends in presence while someone is in a party. */
export interface PartyPresence {
  id: string;
  size: number;
  max: number;
  /** Friends may join without an invite. */
  open: boolean;
}

export type PartyEvent =
  | { type: "party.invite"; data: { partyId: string; from: MemberView; size: number } }
  /** Leader, privacy, invites or the call changed; the whole party as it is now. */
  | { type: "party.updated"; data: PartyView }
  | { type: "party.member_joined"; data: { partyId: string; member: MemberView } }
  | {
      type: "party.member_left";
      data: { partyId: string; userId: string; reason: "left" | "kicked"; leaderId: string | null };
    }
  | { type: "party.ended"; data: { partyId: string } };
