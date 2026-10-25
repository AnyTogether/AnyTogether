import type { chatEn } from "@/lib/i18n-chat";
import {
  type Conversation,
  type Message,
  type MessageReaction,
  type Reaction,
  editWindowMs,
  maxMessageEdits,
} from "@/lib/social";

/** The reactions a message can get and how they are drawn (the API's fixed set). */
export const reactions: { name: MessageReaction; glyph: string; label: keyof typeof chatEn }[] = [
  { name: "like", glyph: "👍", label: "reactionLike" },
  { name: "love", glyph: "❤️", label: "reactionLove" },
  { name: "laugh", glyph: "😂", label: "reactionLaugh" },
  { name: "wow", glyph: "😮", label: "reactionWow" },
  { name: "sad", glyph: "😢", label: "reactionSad" },
  { name: "fire", glyph: "🔥", label: "reactionFire" },
  { name: "gg", glyph: "GG", label: "reactionGg" },
];
export const glyphOf = (name: MessageReaction) => reactions.find((r) => r.name === name)?.glyph ?? name;

/** Pinned conversations first, then the newest. */
export const byPinnedThenUpdated = (a: Conversation, b: Conversation) =>
  Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt);

export type Receipt =
  | { kind: "sent" | "delivered" | "read" }
  | { kind: "seen"; count: number; everyone: boolean };

/** Where one's own message has got: sent, delivered or read in a direct chat, and how many have
 *  seen it in a group; null for someone else's message, a removed one, or an API without receipts. */
export function receiptOf(conversation: Conversation, message: Message, me: string): Receipt | null {
  if (message.authorId !== me || message.deletedAt || !conversation.receipts) return null;
  if (conversation.kind === "group") {
    const count = conversation.receipts.filter((r) => r.readSeq !== null && r.readSeq >= message.seq).length;
    return { kind: "seen", count, everyone: count > 0 && count === conversation.receipts.length };
  }
  const other = conversation.receipts[0];
  if (!other) return null;
  if (other.readSeq !== null && other.readSeq >= message.seq) return { kind: "read" };
  if (other.deliveredSeq !== null && other.deliveredSeq >= message.seq) return { kind: "delivered" };
  return { kind: "sent" };
}

interface MarkEvent {
  type: string;
  data: { conversationId?: string; userId?: string; upToSeq?: number; unread?: number } | null;
}

/** A conversation after a read or delivered mark from the gateway: one's own from another device
 *  (the read mark and what is left unread), or another member's (their receipt, never backwards). */
export function withEvent(conversation: Conversation, event: MarkEvent, me: string): Conversation {
  const data = event.data;
  if (!data || data.conversationId !== conversation.id || typeof data.upToSeq !== "number")
    return conversation;
  const upTo = data.upToSeq;
  if (event.type === "conversation.read" && data.userId === me)
    return {
      ...conversation,
      readSeq: Math.max(conversation.readSeq, upTo),
      unread: typeof data.unread === "number" ? data.unread : Math.max(0, conversation.lastSeq - upTo),
    };
  if (event.type !== "conversation.read" && event.type !== "conversation.delivered") return conversation;
  if (!conversation.receipts) return conversation;
  return {
    ...conversation,
    receipts: conversation.receipts.map((r) => {
      if (r.userId !== data.userId) return r;
      const deliveredSeq = r.deliveredSeq === null ? null : Math.max(r.deliveredSeq, upTo);
      if (event.type === "conversation.delivered") return { ...r, deliveredSeq };
      return { ...r, readSeq: Math.max(r.readSeq ?? 0, upTo), deliveredSeq };
    }),
  };
}

/** A message with the reactions a message.reactions event carries, if it is that message. */
export function withReactions(
  message: Message,
  data: { conversationId: string; seq: number; reactions: Reaction[] },
): Message {
  if (message.conversationId !== data.conversationId || message.seq !== data.seq) return message;
  return { ...message, reactions: data.reactions };
}

export const hasReacted = (message: Message, name: MessageReaction, me: string) =>
  (message.reactions ?? []).some((r) => r.reaction === name && r.userIds.includes(me));

/** "Love: Ayşe, Utku": what a reaction is and who added it. */
export function reactionLabel(texts: typeof chatEn, reaction: Reaction, names: Map<string, string>) {
  const label = texts[reactions.find((r) => r.name === reaction.reaction)?.label ?? "react"];
  return texts.reactedBy
    .replace("{reaction}", label)
    .replace("{names}", reaction.userIds.map((id) => names.get(id) ?? "?").join(", "));
}

/** One's own text (or caption), within the edit window and under the edit limit. */
export function canEditMessage(message: Message, me: string, now: number) {
  if (message.authorId !== me || message.deletedAt) return false;
  if ((message.editCount ?? 0) >= maxMessageEdits) return false;
  if (now - Date.parse(message.createdAt) >= editWindowMs) return false;
  return !message.kind || message.kind === "text" || Boolean(message.caption);
}

/** The message a reply quotes, as far as the loaded thread knows it. */
export function replyTarget(thread: Message[], seq: number | null | undefined) {
  if (!seq) return null;
  const found = thread.find((m) => m.seq === seq);
  if (!found) return { authorId: null, text: null, removed: false, found: false };
  return {
    authorId: found.authorId,
    text: found.deletedAt
      ? null
      : found.kind && found.kind !== "text"
        ? (found.caption ?? found.text)
        : found.text,
    removed: Boolean(found.deletedAt),
    found: true,
  };
}
