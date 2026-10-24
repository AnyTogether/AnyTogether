import { z } from "zod";

/** The most people in a group conversation, its creator included. */
export const maxGroupMembers = 32;
/** How long the author may still edit a message. */
export const editWindowMs = 15 * 60_000;
export const maxMessageLength = 4000;

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

/** clientId is the client's own UUID (v7), so a resent message is stored once. Text only for now. */
export const MessageSend = z.object({
  clientId: z.string().uuid(),
  text: Text,
  replyTo: z.number().int().positive().optional(),
});
export const MessageEdit = z.object({ text: Text });
export const ReadUpTo = z.object({ upToSeq: z.number().int().min(0) });

export type ConversationKind = "direct" | "group";

/** A message as every client sees it; a deleted one keeps its place with no text. */
export interface MessageView {
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

export interface MemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatar: string | null;
}

export interface ConversationView {
  id: string;
  kind: ConversationKind;
  title: string | null;
  createdBy: string | null;
  members: MemberView[];
  lastSeq: number;
  readSeq: number;
  unread: number;
  lastMessage: MessageView | null;
  updatedAt: string;
}

export type MessageEvent =
  | { type: "message.created"; data: MessageView }
  | { type: "message.updated"; data: MessageView }
  | { type: "message.deleted"; data: MessageView }
  | { type: "conversation.read"; data: { conversationId: string; userId: string; upToSeq: number } }
  /** Made, renamed, or its members changed; `removed` is set for whoever is no longer in it. */
  | { type: "conversation.updated"; data: { conversationId: string; removed?: boolean } }
  /** Someone is typing in it: passed on by the gateway, never kept; show it for a few seconds. */
  | { type: "typing"; data: { conversationId: string; userId: string } };

/** Who is in a conversation (user IDs), kept by the API for the gateway's typing indicators. */
export const conversationMembersKey = (conversationId: string) => `conversation:${conversationId}:members`;
export const conversationMembersSeconds = 86_400;
/** A client says it is typing at most this often per conversation; more is dropped. */
export const typingEveryMs = 2000;
