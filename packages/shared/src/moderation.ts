import { z } from "zod";

/** What can be reported; activities join this list when they exist. */
export const reportTargets = ["user", "message", "theme", "lfg"] as const;
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
  /** For a user, their user ID; for a message, a theme or a looking-for-group post, its ID. */
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
] as const;
export type ReportAction = (typeof reportActions)[number];

/** A ban for some days (1 to 10 years), or until lifted when days is left out or null. */
const BanDays = z.number().int().min(1).max(3650).nullable().optional();
const ModeratorReason = z.string().trim().min(1).max(300).optional();

export const ReportVerdict = z.object({
  action: z.enum(reportActions),
  days: BanDays,
  /** Shown to the person with a warning, kept with a ban. */
  reason: ModeratorReason,
});

export const AdminBan = z.object({ days: BanDays, reason: ModeratorReason });
