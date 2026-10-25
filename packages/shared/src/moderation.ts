import { z } from "zod";

/** What can be reported; activities join this list when they exist. */
export const reportTargets = ["user", "message", "theme", "lfg", "media"] as const;
export const reportReasons = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "impersonation",
  "cheating",
  "piracy",
  "other",
] as const;
export type ReportReason = (typeof reportReasons)[number];

export const ReportCreate = z.object({
  targetKind: z.enum(reportTargets),
  /** For a user, their user ID; for a message, a theme, a looking-for-group post or a piece of
   *  media (a photo, clip or voice note), its ID. */
  targetId: z.string().min(1).max(100),
  reason: z.enum(reportReasons),
  note: z.string().trim().max(500).optional(),
});

/** What a moderator can do about a report on the admin page. Any action but dismiss closes every
 *  open report on the same person or message. */
export const reportActions = [
  "dismiss",
  "warn",
  "ban",
  "remove_message",
  "reset_avatar",
  "reset_bio",
  /** Takes a reported looking-for-group post off the board. */
  "remove_post",
  /** Takes a reported theme off the Hub. */
  "hide_theme",
  /** Puts a reported theme (held for review) back on the Hub: its open reports are dismissed. */
  "publish_theme",
  /** Hides reported media (a photo, clip or voice note) from everyone but its owner. */
  "hide_media",
  /** Deletes reported media: gone from messages, the gallery and the owner's storage. */
  "delete_media",
  /** The person may still sign in and play, but not write to others (messages, posts, friend
   *  requests, their name and bio, themes) for some days or until lifted. */
  "mute",
] as const;
export type ReportAction = (typeof reportActions)[number];

/** A ban for some days (1 to 10 years), or until lifted when days is left out or null. */
const BanDays = z.number().int().min(1).max(3650).nullable().optional();
const ModeratorReason = z.string().trim().min(1).max(300).optional();

export const ReportVerdict = z.object({
  action: z.enum(reportActions),
  days: BanDays,
  /** Shown to the person with a warning, kept with a ban or mute (the moderators' note). */
  reason: ModeratorReason,
  /** Why, as the person is told it with a ban or mute (and may appeal against). */
  publicReason: ModeratorReason,
});

export const AdminBan = z.object({ days: BanDays, reason: ModeratorReason, publicReason: ModeratorReason });

/** What an account may not do now, as GET /me, GET /me/restrictions, a refused sign-in and the
 *  account.restricted event give it:
 *  - banned: no sign-in at all, until lifted; suspended: the same until `until`;
 *  - muted: signs in and plays, but writes to no one (see `restricts`). */
export const restrictionKinds = ["banned", "suspended", "muted"] as const;
export type RestrictionKind = (typeof restrictionKinds)[number];
/** What a restriction stops: signing in, or (muted) messages, looking-for-group posts and
 *  requests to join, friend requests, the name and bio, themes shared on the Hub. */
export const restrictedActions = [
  "sign_in",
  "messages",
  "posts",
  "friend_requests",
  "profile",
  "themes",
] as const;
export type RestrictedAction = (typeof restrictedActions)[number];

export interface Restriction {
  id: string;
  kind: RestrictionKind;
  restricts: RestrictedAction[];
  /** The moderator's reason as the person is told it; null when none was given. */
  reason: string | null;
  since: string;
  /** null: until a moderator lifts it. */
  until: string | null;
  /** An appeal can be sent (none is open now). */
  appealable: boolean;
}

export const appealStatuses = ["open", "accepted", "declined"] as const;
export type AppealStatus = (typeof appealStatuses)[number];

export interface AppealView {
  id: string;
  /** The restriction it is about; null when that is gone. */
  restrictionId: string | null;
  status: AppealStatus;
  text: string;
  /** The moderator's answer, once there is one. */
  reply: string | null;
  createdAt: string;
  answeredAt: string | null;
}

/** POST /me/appeals: why the restriction should go, about one restriction (the first in force
 *  when left out). */
export const AppealCreate = z.object({
  restrictionId: z.string().uuid().optional(),
  text: z.string().trim().min(10, "at least 10 characters").max(2000, "at most 2000 characters"),
});

/** POST /admin/appeals/:id: accept (the restriction is lifted) or decline, with an answer the
 *  person reads. */
export const AppealDecision = z.object({
  decision: z.enum(["accept", "decline"]),
  reply: z.string().trim().max(1000).optional(),
});
