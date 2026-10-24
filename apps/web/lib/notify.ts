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
    | "warning";
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
] as const;
export type NoticeKind = (typeof noticeKinds)[number];
export type NoticeSettings = Record<NoticeKind, boolean> & { digest: boolean };

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
    default:
      return null;
  }
}
