import { z } from "zod";

/** What can be reported; messages, activities and themes join this list when they exist. */
export const reportTargets = ["user"] as const;
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
  /** For a user, their user ID. */
  targetId: z.string().min(1).max(100),
  reason: z.enum(reportReasons),
  note: z.string().trim().max(500).optional(),
});
