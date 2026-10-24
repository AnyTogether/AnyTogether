import type { Person } from "@/lib/people";

/** Messages, parties and calls as the API shows them (the website keeps its own copy of the shapes). */
export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  authorId: string | null;
  text: string | null;
  replyTo: number | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  createdBy: string | null;
  members: Person[];
  lastSeq: number;
  readSeq: number;
  unread: number;
  lastMessage: Message | null;
  updatedAt: string;
}

export interface PartyMember extends Person {
  joinedAt: string;
}

export interface Party {
  id: string;
  leaderId: string;
  privacy: "invite" | "friends";
  members: PartyMember[];
  invited: Person[];
  call: { id: string; in: string[]; muted?: string[] } | null;
  createdAt: string;
}

export interface PartyInvite {
  partyId: string;
  from: Person | null;
  size: number;
  invitedAt: string;
}

export interface CallPeer {
  userId: string;
  device: string;
  muted?: boolean;
}

export interface CallJoin {
  call: { id: string; kind: "direct" | "party"; partyId: string | null; in: CallPeer[] };
  iceServers: RTCIceServer[];
  expiresAt: string | null;
}

/** An event from the gateway. */
export interface LiveEvent {
  id: string;
  type: string;
  // biome-ignore lint/suspicious/noExplicitAny: each event type has its own data
  data: any;
}

export const maxPartySize = 8;
/** The most people in a group conversation, its creator included. */
export const maxGroupMembers = 32;
/** Typing is said at most this often, and shown this long after the last word of it. */
export const typingEveryMs = 2500;
export const typingShownMs = 5000;
export const editWindowMs = 15 * 60_000;

/** The name of a conversation: its title, the other person, or the others' first names. */
export function conversationName(conversation: Conversation, me: string) {
  if (conversation.title) return conversation.title;
  const others = conversation.members.filter((m) => m.userId !== me);
  if (conversation.kind === "direct") return others[0]?.displayName ?? "?";
  return others.map((m) => m.displayName.split(" ")[0]).join(", ") || "?";
}

/** "14:05" today, "Mon" this week, "12 Oct" before; in the reader's language. */
export function shortTime(iso: string, now: number, locale: string) {
  const date = new Date(iso);
  const age = now - date.getTime();
  if (age < 86_400_000 && new Date(now).getDate() === date.getDate())
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (age < 6 * 86_400_000) return date.toLocaleDateString(locale, { weekday: "short" });
  return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A call to the API through the website's relay; the parsed body, or null with the status. */
export async function social<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(`/me/social/${path}`, init).catch(() => undefined);
  if (!response) return { ok: false, status: 0, body: null };
  const text = await response.text().catch(() => "");
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}
