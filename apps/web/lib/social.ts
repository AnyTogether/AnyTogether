import type { Person } from "@/lib/people";
import type { Attachment, MediaKind } from "@/lib/storage";
import type { PartyTogether } from "@/lib/together";

/** Messages, parties and calls as the API shows them (the website keeps its own copy of the shapes). */
export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  authorId: string | null;
  /** text, or one piece of media (older API answers lack it: text). */
  kind?: "text" | MediaKind;
  /** The caption alone; `text` is the caption or a stand-in such as "[photo]". */
  caption?: string | null;
  attachments?: Attachment[];
  text: string | null;
  replyTo: number | null;
  editedAt: string | null;
  /** How often it was edited, and who reacted with what (older API answers lack them). */
  editCount?: number;
  reactions?: Reaction[];
  deletedAt: string | null;
  createdAt: string;
}

export type MessageReaction = "like" | "love" | "laugh" | "wow" | "sad" | "fire" | "gg";
export interface Reaction {
  reaction: MessageReaction;
  count: number;
  userIds: string[];
}

/** How far another member has got: readSeq null unless both share read receipts; deliveredSeq only
 *  in a direct conversation. */
export interface ReceiptMark {
  userId: string;
  readSeq: number | null;
  deliveredSeq: number | null;
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
  /** A community's chat: its members come and go with the community (older API answers lack it). */
  communityId?: string | null;
  muted?: boolean;
  /** Older API answers lack these. */
  pinned?: boolean;
  receipts?: ReceiptMark[];
}

export interface PartyMember extends Person {
  joinedAt: string;
}

/** A join code that works now: anyone holding it may ask to join. */
export interface JoinCode {
  code: string;
  url: string;
  expiresAt: string;
}

export interface Party {
  id: string;
  leaderId: string;
  privacy: "invite" | "friends";
  members: PartyMember[];
  invited: Person[];
  call: { id: string; in: string[]; muted?: string[]; deafened?: string[] } | null;
  /** The party's Play Together game while one runs (older API answers lack it). */
  together?: PartyTogether | null;
  /** Listed in public, and how (older API answers lack it). */
  public?: { join: "request" | "open"; titleId: string | null; language: string | null } | null;
  /** Who asked to join, from the public list or with the code (members only). */
  requests?: Person[];
  /** The leader's join code while it works (members only; older API answers lack it). */
  joinCode?: JoinCode | null;
  /** The party's Discord server or channel (members only). */
  discord?: string | null;
  createdAt: string;
}

/** What a join code opens, as GET /join/{code} says. */
export interface JoinCodeView {
  code: string;
  kind: "party" | "share_play" | "game_session";
  id: string;
  host: { userId?: string; handle: string; displayName: string; avatar: string | null } | null;
  game: {
    titleId: string;
    title: string | null;
    names: Record<string, string>;
    iconUrl: string | null;
  } | null;
  size: number;
  max: number;
  expiresAt: string;
  state?: "none" | "member" | "requested" | "invited";
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A code as typed or pasted: case, spaces and dashes do not matter. */
export const normalizeJoinCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");
export const isJoinCode = (code: string) =>
  code.length === 8 && [...code].every((c) => codeAlphabet.includes(c));
/** XXXX-XXXX, for reading out. */
export const formatJoinCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

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
  deafened?: boolean;
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
/** How often a message may be edited, and how many conversations one keeps pinned. */
export const maxMessageEdits = 20;
export const maxPinnedConversations = 5;

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
