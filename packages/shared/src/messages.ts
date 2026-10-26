import { z } from "zod";
import type { AttachmentView, MessageKind } from "./storage.js";

/** The most people in a group conversation, its creator included. */
export const maxGroupMembers = 32;
/** How long the author may still edit a message. */
export const editWindowMs = 15 * 60_000;
/** How many times one message may be edited within that window; it shows "edited" after the first. */
export const maxMessageEdits = 20;
export const maxMessageLength = 4000;
/** The most conversations one person keeps pinned at the top of their list. */
export const maxPinnedConversations = 5;

/** The reactions a message can get, one of each per person, toggled. Clients draw them as
 *  👍 ❤️ 😂 😮 😢 🔥 and "GG" (messageReactionGlyphs). Not the feed's set. */
export const messageReactions = ["like", "love", "laugh", "wow", "sad", "fire", "gg"] as const;
export type MessageReaction = (typeof messageReactions)[number];
export const messageReactionGlyphs: Record<MessageReaction, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  fire: "🔥",
  gg: "GG",
};
export const MessageReactionName = z.enum(messageReactions);

const UserId = z.string().uuid();
const Text = z.string().trim().min(1).max(maxMessageLength);

/** One other person and no group asked for: the direct conversation with them, made once and reused.
 *  Anything else is a new group. */
export const ConversationCreate = z.object({
  members: z
    .array(UserId)
    .min(1)
    .max(maxGroupMembers - 1)
    .refine((list) => new Set(list).size === list.length, "members must be unique"),
  title: z.string().trim().min(1).max(80).optional(),
  group: z.boolean().optional(),
});

export const ConversationUpdate = z.object({ title: z.string().trim().min(1).max(80).nullable() });
export const ConversationMembers = z.object({
  userIds: z
    .array(UserId)
    .min(1)
    .max(maxGroupMembers - 1),
});

/** clientId is the client's own UUID (v7), so a resent message is stored once. Text, or one piece
 *  of the sender's own media (uploaded first with POST /me/media) with an optional caption. */
export const MessageSend = z
  .object({
    clientId: z.string().uuid(),
    text: z.string().trim().max(maxMessageLength).optional(),
    replyTo: z.number().int().positive().optional(),
    attachments: z
      .array(z.object({ mediaId: z.string().uuid() }))
      .max(1)
      .optional(),
  })
  .refine((m) => Boolean(m.text) || Boolean(m.attachments?.length), {
    message: "a message needs text or an attachment",
    path: ["text"],
  });
export const MessageEdit = z.object({ text: Text });
export const ReadUpTo = z.object({ upToSeq: z.number().int().min(0) });
/** A device got messages over the gateway up to this seq (fetching them says so by itself). */
export const DeliveredUpTo = ReadUpTo;
export const MuteSet = z.object({ muted: z.boolean() });
export const PinSet = z.object({ pinned: z.boolean() });
/** PATCH /me/read-receipts. */
export const ReadReceiptsSet = z.object({ readReceipts: z.boolean() });

export type ConversationKind = "direct" | "group";

/** A message as every client sees it; a deleted one keeps its place with no text. A message with
 *  media has its kind and attachments; its `text` is the caption or, for clients that know no media,
 *  a stand-in such as "[photo]", and `caption` is the caption alone. */
export interface MessageView {
  id: string;
  conversationId: string;
  seq: number;
  authorId: string | null;
  kind: MessageKind;
  text: string | null;
  caption: string | null;
  attachments: AttachmentView[];
  replyTo: number | null;
  editedAt: string | null;
  /** How many times it was edited (older API answers lack it). */
  editCount: number;
  /** Who reacted with what, in messageReactions order; empty once unsent. */
  reactions: ReactionView[];
  /** Unsent by its author or removed by a moderator: text, media and reactions are gone and only
   *  its place stays ("message removed"). */
  deletedAt: string | null;
  createdAt: string;
}

export interface ReactionView {
  reaction: MessageReaction;
  count: number;
  userIds: string[];
}

/** How far another member has got. readSeq is null unless both of you share read receipts (and
 *  neither blocked the other); deliveredSeq is for a direct conversation only (null in a group).
 *  A group's "seen by N" for a message is the members with readSeq >= its seq. */
export interface ReceiptView {
  userId: string;
  readSeq: number | null;
  deliveredSeq: number | null;
}

export interface MemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  /** Only for the person and their accepted friends (see PrivateIdentity); left out otherwise. */
  privateName?: string | null;
  privateAvatar?: string | null;
}

export interface ConversationView {
  id: string;
  kind: ConversationKind;
  title: string | null;
  createdBy: string | null;
  members: MemberView[];
  lastSeq: number;
  readSeq: number;
  /** The others' messages after readSeq that are still there (unsent ones do not count). */
  unread: number;
  lastMessage: MessageView | null;
  updatedAt: string;
  /** The community whose chat it is: its members come and go with the community's. */
  communityId?: string | null;
  muted?: boolean;
  /** Pinned to the top of the list; the list has pinned ones first (older API answers lack it). */
  pinned?: boolean;
  /** The other members' read and delivered marks (older API answers lack it). */
  receipts?: ReceiptView[];
}

export type MessageEvent =
  | { type: "message.created"; data: MessageView }
  | { type: "message.updated"; data: MessageView }
  | { type: "message.deleted"; data: MessageView }
  /** Someone read up to a seq: told to their own devices (with their new `unread` count) and to
   *  members who see their read receipts. */
  | {
      type: "conversation.read";
      data: { conversationId: string; userId: string; upToSeq: number; unread?: number };
    }
  /** The other person of a direct conversation got messages up to a seq on one of their devices. */
  | { type: "conversation.delivered"; data: { conversationId: string; userId: string; upToSeq: number } }
  /** A message's reactions changed. */
  | {
      type: "message.reactions";
      data: { conversationId: string; seq: number; reactions: ReactionView[] };
    }
  /** The person's own read-receipts setting changed on another device. */
  | { type: "messages.settings"; data: { readReceipts: boolean } }
  /** Made, renamed, or its members changed; `removed` is set for whoever is no longer in it. */
  | { type: "conversation.updated"; data: { conversationId: string; removed?: boolean } }
  /** Someone is typing in it: passed on by the gateway, never kept; show it for a few seconds. */
  | { type: "typing"; data: { conversationId: string; userId: string } };

/** Who is in a conversation (user IDs), kept by the API for the gateway's typing indicators. */
export const conversationMembersKey = (conversationId: string) => `conversation:${conversationId}:members`;
export const conversationMembersSeconds = 86_400;
/** A client says it is typing at most this often per conversation; more is dropped. */
export const typingEveryMs = 2000;
