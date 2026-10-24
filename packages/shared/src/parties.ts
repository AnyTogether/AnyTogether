import { z } from "zod";
import { LanguageCode, TitleId } from "./games.js";
import type { MemberView } from "./messages.js";

/** Voice in a party is a peer-to-peer mesh, so a party holds at most eight people. */
export const maxPartySize = 8;

/** invite: only people a member invited may join; friends: the leader's friends may join too. */
export const partyPrivacies = ["invite", "friends"] as const;
export type PartyPrivacy = (typeof partyPrivacies)[number];

const UserId = z.string().uuid();

/** Listing a party or share play in public, chosen by its host and never on by default.
 *  request: others ask and the host lets them in; open: anyone may walk in. */
export const publicJoins = ["request", "open"] as const;
export type PublicJoin = (typeof publicJoins)[number];

/** A party in the public list: how to get in, and the game and language it is about. */
export const PartyListing = z.object({
  join: z.enum(publicJoins),
  titleId: TitleId.nullable().optional(),
  language: LanguageCode.nullable().optional(),
});

export const PartyCreate = z.object({
  privacy: z.enum(partyPrivacies).default("invite"),
  /** List it in public at once; null or left out keeps it off the list. */
  public: PartyListing.nullable().optional(),
});
export const PartyUpdate = z
  .object({ privacy: z.enum(partyPrivacies).optional(), public: PartyListing.nullable().optional() })
  .refine((value) => value.privacy !== undefined || value.public !== undefined, "nothing to change");
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
  /** The party's voice call while one runs: its ID, who is in it and who of them is muted. */
  call: { id: string; in: string[]; muted: string[] } | null;
  /** In the public list, and how; null when it is not listed. */
  public: { join: PublicJoin; titleId: string | null; language: string | null } | null;
  /** People who asked to join (members only). */
  requests?: MemberView[];
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
