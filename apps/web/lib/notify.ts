import type { Person } from "@/lib/people";

/** A notification as the API shows it (the website keeps its own copy of the shape). */
export interface Notice {
  id: string;
  kind:
    | "friend_request"
    | "friend_accepted"
    | "message"
    | "party_invite"
    | "game_invite"
    | "missed_call"
    | "lfg_request"
    | "lfg_accepted"
    | "warning"
    | "family_invite"
    | "family_request"
    | "family_answer"
    | "family_alert"
    | "family_summary"
    | "appeal"
    | "level_up"
    | "community_invite"
    | "event_reminder"
    | "event_started"
    | "post_like"
    | "post_comment"
    | "comment_reply";
  actor: Person | null;
  subjectId: string;
  data: {
    count?: number;
    text?: string;
    title?: string | null;
    group?: boolean;
    titleId?: string;
    gameNames?: Record<string, string>;
    reason?: string;
    /** appeal: the moderator's decision and answer. */
    decision?: "accepted" | "declined";
    reply?: string | null;
    postId?: string;
    purpose?: string;
    invite?: { kind: "party" | "share_play"; id: string } | null;
    /** Family notifications. */
    kind?: string;
    minutes?: number | null;
    gameName?: string | null;
    person?: Person | null;
    approved?: boolean;
    event?: string;
    familyName?: string;
    children?: { userId: string; displayName: string; seconds: number }[];
    level?: number;
    name?: string;
    community?: string;
    communityId?: string;
    eventId?: string;
    startsAt?: string;
    link?: { kind: "party" | "share_play"; id: string } | null;
    /** comment_reply: the comment answered. */
    commentId?: string;
  };
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoticePage {
  notifications: Notice[];
  unread: number;
  more: boolean;
}

/** The kinds the settings turn on and off, in the order they are listed. */
export const noticeKinds = [
  "friend_request",
  "friend_accepted",
  "message",
  "party_invite",
  "game_invite",
  "missed_call",
  "lfg_request",
  "lfg_accepted",
  "family_invite",
  "family_request",
  "family_answer",
  "family_alert",
  "family_summary",
  "level_up",
  "community_invite",
  "event_reminder",
  "event_started",
  "post_like",
  "post_comment",
  "comment_reply",
] as const;
export type NoticeKind = (typeof noticeKinds)[number];
/** familyMail: the weekly family summary by mail (older servers leave it out). */
export type NoticeSettings = Record<NoticeKind, boolean> & { digest: boolean; familyMail?: boolean };

export interface NoticeSetup {
  settings: NoticeSettings;
  /** The server's VAPID key, when it sends browser push. */
  push: { publicKey: string } | null;
  canMail: boolean;
}

/** Where a notification leads; null when it has nowhere to go on the website. */
export function noticeHref(notice: Notice) {
  switch (notice.kind) {
    case "message":
      return `/messages?c=${notice.subjectId}`;
    case "friend_request":
    case "friend_accepted":
      return notice.actor ? `/u/${notice.actor.handle}` : "/friends";
    case "party_invite":
      return "/party";
    case "missed_call":
      return notice.actor ? `/u/${notice.actor.handle}` : null;
    case "lfg_request":
      return "/find#mine";
    case "lfg_accepted":
      return notice.data.invite?.kind === "share_play" ? `/watch/${notice.data.invite.id}` : "/party";
    case "family_invite":
    case "family_request":
    case "family_answer":
    case "family_alert":
    case "family_summary":
      return "/family";
    case "appeal":
      return "/restricted";
    case "level_up":
      return notice.actor ? `/u/${notice.actor.handle}` : null;
    case "community_invite":
      return `/communities/${notice.subjectId}`;
    case "event_reminder":
      return `/events/${notice.subjectId}`;
    case "event_started":
      return notice.data.link?.kind === "share_play"
        ? `/watch/${notice.data.link.id}`
        : notice.data.link
          ? "/party"
          : `/events/${notice.subjectId}`;
    case "post_like":
    case "post_comment":
    case "comment_reply":
      return notice.data.postId ? `/p/${notice.data.postId}` : null;
    default:
      return null;
  }
}
