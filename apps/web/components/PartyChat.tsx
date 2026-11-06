"use client";

import { useLive, useLiveEvents } from "@/components/Live";
import { type Pending, type Thread, ThreadView, refusal } from "@/components/MessagesBoard";
import { hasReacted, withEvent, withReactions } from "@/lib/chat";
import type { UiStrings } from "@/lib/i18n";
import type { Person } from "@/lib/people";
import {
  type Conversation,
  type Message,
  type MessageReaction,
  type Party,
  json,
  social,
  typingEveryMs,
  typingShownMs,
} from "@/lib/social";
import { useCallback, useEffect, useRef, useState } from "react";

const noMedia = { enabled: false, limits: null };

/** The party's text chat beside its voice: the party's conversation, read and written by its
 *  members while they are in it, kept live by the gateway. Text only, with replies, reactions,
 *  edits, unsend and reports as in messages. */
export function PartyChat({ party, texts, locale }: { party: Party; texts: UiStrings; locale: string }) {
  const { me, send: sendFrame } = useLive();
  const id = party.conversationId;
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [thread, setThread] = useState<Thread | undefined>(undefined);
  const [pending, setPending] = useState<Pending[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastTyped = useRef(0);
  const threadRef = useRef(thread);
  threadRef.current = thread;
  /** Everyone seen in the party here, so the messages of someone who left keep their name. */
  const seen = useRef(new Map<string, Person>());
  for (const member of party.members) seen.current.set(member.userId, member);

  const loadConversation = useCallback(async () => {
    if (!id) return;
    const { body } = await social<Conversation>(`conversations/${id}`);
    if (body?.id === id) setConversation(body);
  }, [id]);

  const loadThread = useCallback(
    async (before?: number) => {
      if (!id) return;
      const query = before ? `?before=${before}&limit=40` : "?limit=40";
      const { body } = await social<{ messages: Message[]; more: boolean }>(
        `conversations/${id}/messages${query}`,
      );
      if (!body) return;
      setThread((known) => ({
        messages: before && known ? [...body.messages, ...known.messages] : body.messages,
        more: body.more,
      }));
    },
    [id],
  );

  // A new chat (another party) starts afresh.
  useEffect(() => {
    setThread(undefined);
    setPending([]);
    setConversation(null);
    loadConversation();
    loadThread();
  }, [loadConversation, loadThread]);

  // Members came or went: the chat's members (and its receipts) follow.
  const memberKey = party.members.map((m) => m.userId).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the members change
  useEffect(() => {
    loadConversation();
  }, [memberKey, loadConversation]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Typing fades out a few seconds after the last word of it.
  const someoneTyping = Object.keys(typing).length > 0;
  useEffect(() => {
    if (!someoneTyping) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setTyping((all) => Object.fromEntries(Object.entries(all).filter(([, until]) => until > at)));
    }, 1000);
    return () => clearInterval(timer);
  }, [someoneTyping]);

  /** The chat is beside the voice, so what arrives while the page is in view is read. */
  const markRead = useCallback(async () => {
    const newest = threadRef.current?.messages.at(-1)?.seq;
    if (!id || document.hidden || newest === undefined) return;
    if (conversation && conversation.readSeq >= newest) return;
    setConversation((c) => (c ? { ...c, readSeq: newest, unread: 0 } : c));
    await social(`conversations/${id}/read`, { method: "POST", ...json({ upToSeq: newest }) });
  }, [id, conversation]);

  useEffect(() => {
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [markRead]);

  /** A message, new or changed, into the thread. */
  const take = useCallback(
    (message: Message) => {
      if (message.conversationId !== id) return;
      setThread((known) => {
        if (!known) return known;
        const at = known.messages.findIndex((m) => m.seq === message.seq);
        const messages =
          at >= 0
            ? known.messages.map((m) => (m.seq === message.seq ? message : m))
            : [...known.messages, message].sort((a, b) => a.seq - b.seq);
        return { ...known, messages };
      });
      if (message.authorId === me) setPending((all) => all.filter((p) => p.clientId !== message.id));
    },
    [id, me],
  );

  /** After a reconnect: what came in while the socket was away. */
  const catchUp = useCallback(async () => {
    const last = threadRef.current?.messages.at(-1)?.seq;
    if (!id) return;
    if (last === undefined) return loadThread();
    const { body } = await social<{ messages: Message[] }>(
      `conversations/${id}/messages?after=${last}&limit=100`,
    );
    for (const message of body?.messages ?? []) take(message);
  }, [id, loadThread, take]);

  useLiveEvents((event) => {
    const data = event.data as { conversationId?: string } | null;
    if (event.type === "live.ready") {
      catchUp();
      loadConversation();
      return;
    }
    if (!id || data?.conversationId !== id) return;
    switch (event.type) {
      case "message.created": {
        const message = event.data as Message;
        if (message.authorId) setTyping(({ [message.authorId as string]: _, ...rest }) => rest);
        return take(message);
      }
      case "message.updated":
      case "message.deleted":
        return take(event.data as Message);
      case "message.reactions":
        setThread((known) =>
          known
            ? {
                ...known,
                messages: known.messages.map((m) =>
                  withReactions(m, event.data as Parameters<typeof withReactions>[1]),
                ),
              }
            : known,
        );
        return;
      case "typing":
        if (event.data.userId !== me)
          setTyping((all) => ({ ...all, [event.data.userId]: Date.now() + typingShownMs }));
        return;
      case "conversation.read":
      case "conversation.delivered":
        setConversation((c) => (c ? withEvent(c, event, me) : c));
        return;
    }
  });

  // A new message while in view is read at once.
  const newest = thread?.messages.at(-1)?.seq;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a newer message arrives
  useEffect(() => {
    markRead();
  }, [newest]);

  async function send(text: string, clientId = crypto.randomUUID(), replyTo?: number) {
    if (!id) return;
    setPending((all) => [
      ...all.filter((p) => p.clientId !== clientId),
      { clientId, text, failed: false, ...(replyTo ? { replyTo } : {}) },
    ]);
    lastTyped.current = 0;
    const result = await social<Message & { code?: string }>(`conversations/${id}/messages`, {
      method: "POST",
      ...json({ clientId, text, ...(replyTo ? { replyTo } : {}) }),
    });
    if (result.ok && result.body) return take(result.body);
    setPending((all) => all.map((p) => (p.clientId === clientId ? { ...p, failed: true } : p)));
    if (result.status === 403 || result.status === 429 || result.body?.code === "link_blocked")
      setNotice(
        result.status === 429
          ? texts.tooMany
          : refusal(texts, result.status, result.body?.code, (result.body as { side?: string } | null)?.side),
      );
  }

  async function edit(message: Message, text: string) {
    const result = await social<Message & { code?: string }>(
      `conversations/${message.conversationId}/messages/${message.seq}`,
      { method: "PATCH", ...json({ text }) },
    );
    if (result.ok && result.body) take(result.body);
    else
      setNotice(
        result.body?.code === "edit_limit"
          ? texts.editLimit
          : refusal(texts, result.status, result.body?.code),
      );
  }

  async function remove(message: Message) {
    const result = await social(`conversations/${message.conversationId}/messages/${message.seq}`, {
      method: "DELETE",
    });
    if (result.ok)
      take({ ...message, text: null, attachments: [], reactions: [], deletedAt: new Date().toISOString() });
    else setNotice(texts.failed);
  }

  async function react(message: Message, name: MessageReaction) {
    const on = !hasReacted(message, name, me);
    const result = await social<{
      conversationId: string;
      seq: number;
      reactions: Message["reactions"] & {};
    }>(`conversations/${message.conversationId}/messages/${message.seq}/reactions/${name}`, {
      method: on ? "PUT" : "DELETE",
    });
    const data = result.body;
    if (result.ok && data)
      setThread((known) =>
        known ? { ...known, messages: known.messages.map((m) => withReactions(m, data)) } : known,
      );
    else setNotice(refusal(texts, result.status, (result.body as { code?: string } | null)?.code));
  }

  if (!id) return null;
  // The thread's names: the chat's members and anyone seen in the party here.
  const shown: Conversation = conversation
    ? {
        ...conversation,
        members: [
          ...conversation.members,
          ...[...seen.current.values()].filter(
            (p) => !conversation.members.some((m) => m.userId === p.userId),
          ),
        ],
        receipts: conversation.receipts,
      }
    : {
        id,
        kind: "group",
        title: null,
        createdBy: null,
        members: [...seen.current.values()],
        lastSeq: 0,
        readSeq: 0,
        unread: 0,
        lastMessage: null,
        updatedAt: party.createdAt,
        partyId: party.id,
      };
  const typists = party.members.filter((m) => m.userId !== me && typing[m.userId]);

  return (
    <div className="card party-chat">
      <ThreadView
        embedded={{
          title: texts.partyChat,
          placeholder: texts.partyChatPlaceholder,
          empty: texts.partyChatEmpty,
        }}
        texts={texts}
        locale={locale}
        me={me}
        now={now}
        conversation={shown}
        thread={thread}
        pending={pending}
        typists={typists}
        notice={notice}
        onTyping={() => {
          const at = Date.now();
          if (at - lastTyped.current < typingEveryMs) return;
          if (sendFrame({ op: "typing", conversation: id })) lastTyped.current = at;
        }}
        onBack={() => {}}
        onOlder={(before) => loadThread(before)}
        onSend={send}
        onReact={react}
        onSetting={async () => {}}
        media={noMedia}
        onSendMedia={() => {}}
        onNotice={setNotice}
        onExpired={() => loadThread()}
        onEdit={edit}
        onDelete={remove}
        onLeave={() => {}}
      />
    </div>
  );
}
