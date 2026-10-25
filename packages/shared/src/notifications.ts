import { z } from "zod";
import type { MemberView } from "./messages.js";

/** What a notification can be about. Each but `warning` and `appeal` can be turned off in the
 *  settings; a moderator's warning, and their answer to an appeal, always arrive. */
export const notificationKinds = [
  "friend_request",
  "friend_accepted",
  "message",
  "party_invite",
  "game_invite",
  "missed_call",
  "lfg_request",
  "lfg_accepted",
  "warning",
  "family_invite",
  "family_request",
  "family_answer",
  "family_alert",
  "family_summary",
  "appeal",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export const optionalNotificationKinds = notificationKinds.filter(
  (kind): kind is Exclude<NotificationKind, "warning" | "appeal"> => kind !== "warning" && kind !== "appeal",
);
export type OptionalNotificationKind = (typeof optionalNotificationKinds)[number];

/** Messages come in a notification only while none of the person's devices has a socket open (a
 *  connected client shows them itself); one notification per conversation gathers them until it is
 *  read, counting how many came. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  /** Who did it: the asker, the inviter, the caller, the last one who wrote. Null for a warning. */
  actor: MemberView | null;
  /** What it is about: a conversation, party, game session or call ID; null for friends. */
  subjectId: string | null;
  /** message: {conversationId, title, group, count, text}; party_invite: {partyId, size};
   *  game_invite: {sessionId, titleId}; missed_call: {callId}; warning: {reason};
   *  appeal: {decision: accepted | declined, reply};
   *  lfg_request: {postId, titleId, gameNames, purpose, count}; lfg_accepted: {postId, titleId,
   *  gameNames, purpose, invite: {kind, id} | null}; family_invite: {inviteId, familyId, familyName,
   *  role}; family_request: {requestId, kind, minutes, titleId, gameName, person}; family_answer:
   *  {requestId, kind, approved, minutes}; family_alert: {event: "limit_reached", childId, date,
   *  titleId}; family_summary: {familyId, from, until, children: [{userId, displayName, seconds,
   *  games: [{titleId, name, seconds}], friendsAdded}]}. */
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
  /** Later than createdAt when more gathered into it (another message). */
  updatedAt: string;
}

export type NotificationEvent =
  /** A new notification, or one that gathered another message; `unread` is the new badge count. */
  | { type: "notification"; data: { notification: NotificationView; unread: number } }
  /** Read on some device: these IDs, or all of them (ids null). */
  | { type: "notification.read"; data: { ids: string[] | null; unread: number } };

/** Each kind on or off (all on unless turned off), the mail digest and the weekly family summary by
 *  mail (both off unless turned on). */
export type NotificationSettings = Record<OptionalNotificationKind, boolean> & {
  digest: boolean;
  familyMail: boolean;
};
export const defaultNotificationSettings: NotificationSettings = {
  friend_request: true,
  friend_accepted: true,
  message: true,
  party_invite: true,
  game_invite: true,
  missed_call: true,
  lfg_request: true,
  lfg_accepted: true,
  family_invite: true,
  family_request: true,
  family_answer: true,
  family_alert: true,
  family_summary: true,
  digest: false,
  familyMail: false,
};

export function notificationSettingsOf(stored: unknown): NotificationSettings {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const result = { ...defaultNotificationSettings };
  for (const key of Object.keys(result) as (keyof NotificationSettings)[])
    if (typeof saved[key] === "boolean") result[key] = saved[key] as boolean;
  return result;
}

/** PATCH /me/notifications/settings: only what is sent changes. */
export const NotificationSettingsUpdate = z
  .object(
    Object.fromEntries(
      [...optionalNotificationKinds, "digest", "familyMail"].map((key) => [key, z.boolean().optional()]),
    ) as Record<keyof NotificationSettings, z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();

/** A browser's push subscription as PushSubscription.toJSON() gives it, and the language the
 *  device reads its notifications in. */
export const PushSubscriptionInput = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((url) => url.startsWith("https://"), "an https endpoint"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  lang: z.enum(["en", "tr"]).optional(),
});
export const PushUnsubscribe = z.object({ endpoint: z.string().max(1000) });

/** At most one mail digest per account in this long. */
export const digestEveryMs = 6 * 3_600_000;
