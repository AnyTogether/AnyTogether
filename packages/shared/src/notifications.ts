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
  "level_up",
  "community_invite",
  "event_reminder",
  "event_started",
  "warning",
  "family_invite",
  "family_request",
  "family_answer",
  "family_alert",
  "family_summary",
  "appeal",
  "post_like",
  "post_comment",
  "comment_reply",
  "challenge_invite",
  "challenge_started",
  "challenge_ended",
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
   *  games: [{titleId, name, seconds}], friendsAdded}]}; level_up: {level, tier, frame};
   *  community_invite: {communityId, name, icon}; event_reminder: {eventId, communityId, title,
   *  startsAt, titleId, gameNames}; event_started: the same and {link: {kind, id}};
   *  post_like: {postId, count (everyone else who likes it now)}; post_comment: {postId, text,
   *  count}; comment_reply: {postId, commentId, text, count};
   *  challenge_invite, challenge_started: {challengeId, title, titleId, gameNames, metric, endsAt};
   *  challenge_ended: the same and {rank, value, entrants, winner: {displayName, handle, value} |
   *  null}; rank is null for someone who left nothing to rank. The latest liker or commenter is
   *  the actor; subjectId is the post (the comment answered, for a reply), the challenge for a
   *  challenge. */
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
 *  mail (both off unless turned on), and for push: whether a push shows what was written (a
 *  message's or comment's text; on unless turned off) and whether a call rings the phone (on). */
export type NotificationSettings = Record<OptionalNotificationKind, boolean> & {
  digest: boolean;
  familyMail: boolean;
  pushPreview: boolean;
  pushCalls: boolean;
};
/** The settings that are not a kind. */
export const notificationSwitches = ["digest", "familyMail", "pushPreview", "pushCalls"] as const;
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
  level_up: true,
  community_invite: true,
  event_reminder: true,
  event_started: true,
  post_like: true,
  post_comment: true,
  comment_reply: true,
  challenge_invite: true,
  challenge_started: true,
  challenge_ended: true,
  digest: false,
  familyMail: false,
  pushPreview: true,
  pushCalls: true,
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
      [...optionalNotificationKinds, ...notificationSwitches].map((key) => [key, z.boolean().optional()]),
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

/** Where a phone's pushes go: Apple's push service (APNs) for an iPhone, Firebase Cloud Messaging
 *  for Android. */
export const pushPlatforms = ["apns", "fcm"] as const;
export type PushPlatform = (typeof pushPlatforms)[number];

/** POST /me/push/device: the phone app's push token, tied to its sign-in. An iPhone says which app
 *  it is (its bundle ID, the APNs topic; it must be one the server pushes to) and whether the build
 *  uses Apple's development push service. */
export const PushDeviceInput = z.object({
  platform: z.enum(pushPlatforms),
  token: z
    .string()
    .min(8)
    .max(4096)
    .regex(/^[A-Za-z0-9:_\-]+$/, "a push token"),
  app: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9.\-]+$/, "a bundle ID")
    .optional(),
  sandbox: z.boolean().optional(),
  lang: z.enum(["en", "tr"]).optional(),
});
export const PushDeviceRemove = z.object({ token: z.string().max(4096) });

/** Which phones this server pushes to (GET /me/notifications/settings): APNs for these bundle IDs,
 *  and FCM. Null when it pushes to no phone. */
export interface NativePushView {
  apns: string[];
  fcm: boolean;
}

/** At most one mail digest per account in this long. */
export const digestEveryMs = 6 * 3_600_000;
