"use client";

import { Avatar } from "@/components/Avatar";
import { CallButton } from "@/components/Calls";
import { useLive, useLiveEvents } from "@/components/Live";
import { AttachmentView, MediaViewer, VoiceRecorder } from "@/components/Media";
import { familyRefusal } from "@/lib/family";
import type { UiStrings } from "@/lib/i18n";
import { type Person, fill } from "@/lib/people";
import {
  type Conversation,
  type Message,
  conversationName,
  editWindowMs,
  json,
  maxGroupMembers,
  shortTime,
  social,
  typingEveryMs,
  typingShownMs,
} from "@/lib/social";
import Link from "next/link";
import {
  type MediaItem,
  type MediaKind,
  type StorageLimits,
  formatBytes,
  kindOfFile,
  posterOf,
  uploadMedia,
} from "@/lib/storage";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface Thread {
  messages: Message[];
  more: boolean;
}
interface Pending {
  clientId: string;
  text: string;
  failed: boolean;
  /** A photo, clip or voice note on its way: uploaded first, then sent. */
  media?: { kind: MediaKind; file: Blob; preview: string | null; progress: number; durationMs?: number };
}

/** What the page may send besides text: off when the server keeps no files. */
export interface MediaSetup {
  enabled: boolean;
  limits: StorageLimits["media"] | null;
}

/** A file picked, dropped or pasted, waiting in the composer for its caption. */
interface Staged {
  file: Blob;
  kind: "image" | "clip";
  preview: string;
  name: string;
}

/** The list's line for a message: its text, or what kind of media it is and its caption. */
const previewOf = (texts: UiStrings, m: Message) =>
  m.kind && m.kind !== "text"
    ? `${texts[`kind_${m.kind}`]}${m.caption ? ` · ${m.caption}` : ""}`
    : (m.text ?? "");

const byUpdated = (a: Conversation, b: Conversation) => b.updatedAt.localeCompare(a.updatedAt);
const firstName = (person: Person) => person.displayName.split(" ")[0] || person.handle;

/** "Ayşe is typing…", "Ayşe and Mert are typing…", "Several people are typing…". */
function typingLine(texts: UiStrings, people: Person[]) {
  const [a, b] = people;
  if (!a) return "";
  if (!b) return fill(texts.typingOne, { name: firstName(a) });
  if (people.length === 2) return fill(texts.typingTwo, { a: firstName(a), b: firstName(b) });
  return texts.typingMany;
}

/** Why an upload was refused, in the reader's words. */
function uploadRefusal(
  texts: UiStrings,
  status: number,
  code: string | undefined,
  limits: MediaSetup["limits"],
) {
  const sizes = {
    image: formatBytes(limits?.image ?? 10 * 1048576, texts.language),
    clip: formatBytes(limits?.clip ?? 25 * 1048576, texts.language),
  };
  if (code === "quota_exceeded") return texts.quotaFull;
  if (code === "payload_too_large" || status === 413) return fill(texts.tooBigFile, sizes);
  if (code === "unsupported_media_type" || status === 415) return texts.notMedia;
  if (code === "bad_media" || code === "bad_image") return texts.badMediaFile;
  if (code === "storage_disabled") return texts.notMedia;
  return texts.failed;
}

/** Why a message was refused, in the reader's words. */
const refusal = (texts: UiStrings, status: number, code: string | undefined, side?: string) =>
  familyRefusal({ code, side }, texts) ??
  (code === "link_blocked" ? texts.linkBlocked : status === 403 ? texts.cannotMessage : texts.failed);
/** A run: messages by the same person within five minutes stay together. */
const sameRun = (a: Message | undefined, b: Message) =>
  !!a &&
  a.authorId === b.authorId &&
  Date.parse(b.createdAt) - Date.parse(a.createdAt) < 5 * 60_000 &&
  new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();

/** The messages page: the conversation list, the open thread with its composer, and a new message
 *  picker; all of it kept live by gateway events. */
export function MessagesBoard({
  texts,
  locale,
  initialConversations,
  initialSelected,
  friends,
  media = { enabled: false, limits: null },
}: {
  texts: UiStrings;
  locale: string;
  initialConversations: Conversation[];
  initialSelected: string | null;
  friends: Person[];
  media?: MediaSetup;
}) {
  const { me, status, send: sendFrame } = useLive();
  const [conversations, setConversations] = useState(initialConversations);
  /** Who is typing where, and until when it shows. */
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const lastTyped = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [composing, setComposing] = useState(false);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const current = conversations.find((c) => c.id === selected) ?? null;

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
      setTyping((all) => {
        const next: typeof all = {};
        for (const [id, who] of Object.entries(all)) {
          const left = Object.fromEntries(Object.entries(who).filter(([, until]) => until > at));
          if (Object.keys(left).length) next[id] = left;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [someoneTyping]);

  const stopTyping = useCallback((conversationId: string, userId: string) => {
    setTyping((all) => {
      if (!all[conversationId]?.[userId]) return all;
      const { [userId]: _, ...rest } = all[conversationId];
      const next = { ...all, [conversationId]: rest };
      if (!Object.keys(rest).length) delete next[conversationId];
      return next;
    });
  }, []);

  /** Tells the others we are typing, at most every few seconds. */
  const typed = useCallback(
    (conversationId: string) => {
      const at = Date.now();
      if (at - (lastTyped.current[conversationId] ?? 0) < typingEveryMs) return;
      if (sendFrame({ op: "typing", conversation: conversationId })) lastTyped.current[conversationId] = at;
    },
    [sendFrame],
  );

  const typistsOf = (conversation: Conversation) => {
    const who = typing[conversation.id] ?? {};
    return conversation.members.filter((m) => m.userId !== me && who[m.userId]);
  };

  // The address follows the open conversation, so a reload or a shared link opens it again.
  useEffect(() => {
    const target = selected ? `/messages?c=${selected}` : "/messages";
    if (location.pathname + location.search !== target) history.replaceState(null, "", target);
  }, [selected]);

  const reloadList = useCallback(async () => {
    const { body } = await social<{ conversations: Conversation[] }>("me/conversations");
    if (body) setConversations(body.conversations.sort(byUpdated));
  }, []);

  const loadThread = useCallback(async (id: string, before?: number) => {
    const query = before ? `?before=${before}&limit=40` : "?limit=40";
    const { body } = await social<{ messages: Message[]; more: boolean }>(
      `conversations/${id}/messages${query}`,
    );
    if (!body) return;
    setThreads((all) => {
      const known = all[id];
      const merged = before && known ? [...body.messages, ...known.messages] : body.messages;
      return { ...all, [id]: { messages: merged, more: body.more } };
    });
  }, []);

  /** After a reconnect: what came in while the socket was away. */
  const catchUp = useCallback(
    async (id: string) => {
      const known = threadsRef.current[id];
      const last = known?.messages.at(-1)?.seq;
      if (!known || last === undefined) return loadThread(id);
      const { body } = await social<{ messages: Message[] }>(
        `conversations/${id}/messages?after=${last}&limit=100`,
      );
      if (body?.messages.length)
        setThreads((all) => {
          const thread = all[id] ?? { messages: [], more: false };
          const seen = new Set(thread.messages.map((m) => m.seq));
          return {
            ...all,
            [id]: {
              ...thread,
              messages: [...thread.messages, ...body.messages.filter((m) => !seen.has(m.seq))],
            },
          };
        });
    },
    [loadThread],
  );

  useEffect(() => {
    if (selected && !threads[selected]) loadThread(selected);
  }, [selected, threads, loadThread]);

  /** Marks the open conversation read up to its newest message while the page is in view. */
  const markRead = useCallback(async () => {
    if (!current || document.hidden || current.lastSeq <= current.readSeq) return;
    const upToSeq = current.lastSeq;
    setConversations((all) =>
      all.map((c) => (c.id === current.id ? { ...c, readSeq: upToSeq, unread: 0 } : c)),
    );
    await social(`conversations/${current.id}/read`, { method: "POST", ...json({ upToSeq }) });
  }, [current]);

  useEffect(() => {
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [markRead]);

  /** A message, new or changed, into its thread and the list. */
  const take = useCallback(
    (message: Message, created: boolean) => {
      setThreads((all) => {
        const thread = all[message.conversationId];
        if (!thread) return all;
        const at = thread.messages.findIndex((m) => m.seq === message.seq);
        const messages =
          at >= 0
            ? thread.messages.map((m) => (m.seq === message.seq ? message : m))
            : [...thread.messages, message].sort((a, b) => a.seq - b.seq);
        return { ...all, [message.conversationId]: { ...thread, messages } };
      });
      if (message.authorId === me)
        setPending((all) => ({
          ...all,
          [message.conversationId]: (all[message.conversationId] ?? []).filter(
            (p) => p.clientId !== message.id,
          ),
        }));
      let known = false;
      setConversations((all) => {
        const next = all.map((c) => {
          if (c.id !== message.conversationId) return c;
          known = true;
          const lastSeq = Math.max(c.lastSeq, message.seq);
          const readSeq = message.authorId === me ? Math.max(c.readSeq, message.seq) : c.readSeq;
          const newest = !c.lastMessage || message.seq >= c.lastMessage.seq;
          return {
            ...c,
            lastSeq,
            readSeq,
            unread: Math.max(0, lastSeq - readSeq),
            lastMessage: newest ? message : c.lastMessage,
            updatedAt: created ? message.createdAt : c.updatedAt,
          };
        });
        return next.sort(byUpdated);
      });
      if (created && !known) reloadList();
    },
    [me, reloadList],
  );

  useLiveEvents((event) => {
    switch (event.type) {
      case "message.created":
        if (event.data.authorId) stopTyping(event.data.conversationId, event.data.authorId);
        return take(event.data as Message, true);
      case "typing":
        if (event.data.userId === me) return;
        setTyping((all) => ({
          ...all,
          [event.data.conversationId]: {
            ...all[event.data.conversationId],
            [event.data.userId]: Date.now() + typingShownMs,
          },
        }));
        return;
      case "message.updated":
      case "message.deleted":
        return take(event.data as Message, false);
      case "conversation.read":
        if (event.data.userId === me)
          setConversations((all) =>
            all.map((c) =>
              c.id === event.data.conversationId
                ? { ...c, readSeq: event.data.upToSeq, unread: Math.max(0, c.lastSeq - event.data.upToSeq) }
                : c,
            ),
          );
        return;
      case "conversation.updated":
        if (event.data.removed && event.data.conversationId === selected) setSelected(null);
        return reloadList();
      case "live.ready":
        reloadList();
        if (selected) catchUp(selected);
        return;
    }
  });

  // A new message in the open thread is read at once.
  useEffect(() => {
    if (current && current.unread > 0) markRead();
  }, [current, markRead]);

  async function send(conversationId: string, text: string, clientId = crypto.randomUUID()) {
    setPending((all) => ({
      ...all,
      [conversationId]: [
        ...(all[conversationId] ?? []).filter((p) => p.clientId !== clientId),
        { clientId, text, failed: false },
      ],
    }));
    lastTyped.current[conversationId] = 0;
    const result = await social<Message & { code?: string }>(`conversations/${conversationId}/messages`, {
      method: "POST",
      ...json({ clientId, text }),
    });
    if (result.ok && result.body) return take(result.body, true);
    setPending((all) => ({
      ...all,
      [conversationId]: (all[conversationId] ?? []).map((p) =>
        p.clientId === clientId ? { ...p, failed: true } : p,
      ),
    }));
    if (result.status === 403 || result.body?.code === "link_blocked")
      setNotice(
        refusal(texts, result.status, result.body?.code, (result.body as { side?: string } | null)?.side),
      );
  }

  const setPendingMedia = (conversationId: string, clientId: string, change: Partial<Pending>) =>
    setPending((all) => ({
      ...all,
      [conversationId]: (all[conversationId] ?? []).map((p) =>
        p.clientId === clientId ? { ...p, ...change } : p,
      ),
    }));

  /** A photo, clip or voice note: uploaded (its progress shown in the thread), a clip's poster made
   *  from it, then sent with the caption. */
  async function sendMedia(
    conversationId: string,
    item: { file: Blob; kind: MediaKind; preview: string | null; durationMs?: number },
    caption: string,
    clientId = crypto.randomUUID(),
  ) {
    setPending((all) => ({
      ...all,
      [conversationId]: [
        ...(all[conversationId] ?? []).filter((p) => p.clientId !== clientId),
        { clientId, text: caption, failed: false, media: { ...item, progress: 0 } },
      ],
    }));
    const fail = (message: string) => {
      setPendingMedia(conversationId, clientId, { failed: true });
      setNotice(message);
    };
    const uploaded = await uploadMedia(item.file, item.kind, (progress) =>
      setPending((all) => ({
        ...all,
        [conversationId]: (all[conversationId] ?? []).map((p) =>
          p.clientId === clientId && p.media ? { ...p, media: { ...p.media, progress } } : p,
        ),
      })),
    );
    const made = uploaded.body.media;
    if (!uploaded.ok || !made)
      return fail(uploadRefusal(texts, uploaded.status, uploaded.body.code, media.limits));
    if (item.kind === "clip") {
      const poster = await posterOf(item.file);
      if (poster)
        await fetch(`/me/upload/${made.id}/poster`, {
          method: "PUT",
          body: poster,
          headers: { "content-type": "image/jpeg" },
        }).catch(() => undefined);
    }
    const result = await social<Message & { code?: string }>(`conversations/${conversationId}/messages`, {
      method: "POST",
      ...json({ clientId, ...(caption ? { text: caption } : {}), attachments: [{ mediaId: made.id }] }),
    });
    if (result.ok && result.body) {
      if (item.preview) URL.revokeObjectURL(item.preview);
      return take(result.body, true);
    }
    fail(refusal(texts, result.status, result.body?.code));
  }

  async function edit(message: Message, text: string) {
    const result = await social<Message & { code?: string }>(
      `conversations/${message.conversationId}/messages/${message.seq}`,
      { method: "PATCH", ...json({ text }) },
    );
    if (result.ok && result.body) take(result.body, false);
    else
      setNotice(
        refusal(texts, result.status, result.body?.code, (result.body as { side?: string } | null)?.side),
      );
  }

  async function remove(message: Message) {
    const result = await social(`conversations/${message.conversationId}/messages/${message.seq}`, {
      method: "DELETE",
    });
    if (result.ok) take({ ...message, text: null, deletedAt: new Date().toISOString() }, false);
    else setNotice(texts.failed);
  }

  async function leave(conversation: Conversation) {
    const result = await social(`conversations/${conversation.id}/members/${me}`, { method: "DELETE" });
    if (!result.ok) return setNotice(texts.failed);
    setSelected(null);
    setConversations((all) => all.filter((c) => c.id !== conversation.id));
  }

  async function start(members: string[], title: string) {
    const result = await social<Conversation & { code?: string }>("conversations", {
      method: "POST",
      ...json({
        members,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(members.length > 1 ? { group: true } : {}),
      }),
    });
    if (!result.body || !result.ok)
      return setNotice(
        result.body?.code === "full"
          ? fill(texts.groupFull, { max: maxGroupMembers })
          : refusal(texts, result.status, result.body?.code, (result.body as { side?: string } | null)?.side),
      );
    const made = result.body;
    setConversations((all) => [made, ...all.filter((c) => c.id !== made.id)].sort(byUpdated));
    setComposing(false);
    setSelected(made.id);
  }

  const open = (id: string) => {
    setComposing(false);
    setNotice(null);
    setSelected(id);
  };

  const showThread = composing || !!current;
  return (
    <section className={`page chat-page${showThread ? " has-thread" : ""}`}>
      <div className="chat in d1">
        <aside className="card chats">
          <div className="chats-head">
            <h2>{texts.messages}</h2>
            {status !== "ready" && <span className="tag live-state">{texts.reconnecting}</span>}
            <button
              type="button"
              className="pill icon"
              aria-label={texts.newMessage}
              title={texts.newMessage}
              onClick={() => {
                setComposing(true);
                setNotice(null);
                setSelected(null);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="hint empty">{texts.noConversations}</p>
          ) : (
            <ul className="chat-list">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`chat-item${c.id === selected ? " on" : ""}${c.unread ? " unread" : ""}`}
                    aria-current={c.id === selected ? "true" : undefined}
                    onClick={() => open(c.id)}
                  >
                    <Faces conversation={c} me={me} />
                    <span className="lines">
                      <span className="name">{conversationName(c, me)}</span>
                      <span className={`meta preview${typistsOf(c).length ? " is-typing" : ""}`}>
                        {typistsOf(c).length
                          ? typingLine(texts, typistsOf(c))
                          : c.lastMessage
                            ? `${c.lastMessage.authorId === me ? `${texts.you}: ` : ""}${
                                c.lastMessage.deletedAt
                                  ? texts.deletedMessage
                                  : previewOf(texts, c.lastMessage)
                              }`
                            : fill(texts.membersCount, { n: c.members.length })}
                      </span>
                    </span>
                    <span className="when">
                      {c.lastMessage && <time>{shortTime(c.lastMessage.createdAt, now, locale)}</time>}
                      {c.unread > 0 && <b className="badge">{c.unread > 99 ? "99+" : c.unread}</b>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="card thread">
          {composing ? (
            <NewConversation
              texts={texts}
              notice={notice}
              friends={friends}
              onBack={() => setComposing(false)}
              onStart={start}
            />
          ) : current ? (
            <ThreadView
              key={current.id}
              texts={texts}
              locale={locale}
              me={me}
              now={now}
              conversation={current}
              thread={threads[current.id]}
              pending={pending[current.id] ?? []}
              typists={typistsOf(current)}
              notice={notice}
              onTyping={() => typed(current.id)}
              onBack={() => setSelected(null)}
              onOlder={(before) => loadThread(current.id, before)}
              onSend={(text, clientId) => send(current.id, text, clientId)}
              media={media}
              onSendMedia={(item, caption, clientId) => sendMedia(current.id, item, caption, clientId)}
              onNotice={setNotice}
              onExpired={() => loadThread(current.id)}
              onEdit={edit}
              onDelete={remove}
              onLeave={() => leave(current)}
            />
          ) : (
            <div className="thread-empty">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke big">
                <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5z" />
              </svg>
              <p className="hint">{texts.pickConversation}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One face for a direct chat; two overlapping for a group. */
function Faces({ conversation, me }: { conversation: Conversation; me: string }) {
  const others = conversation.members.filter((m) => m.userId !== me);
  if (conversation.kind === "direct" || others.length < 2)
    return others[0] ? <Avatar person={others[0]} size={40} /> : <span className="faces" />;
  return (
    <span className="faces">
      <Avatar person={others[0] as Person} size={28} />
      <Avatar person={others[1] as Person} size={28} />
    </span>
  );
}

function dayLabel(iso: string, now: number, texts: UiStrings, locale: string) {
  const day = new Date(iso);
  const today = new Date(now);
  if (day.toDateString() === today.toDateString()) return texts.today;
  if (day.toDateString() === new Date(now - 86_400_000).toDateString()) return texts.yesterday;
  return day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

function ThreadView({
  texts,
  locale,
  me,
  now,
  conversation,
  thread,
  pending,
  typists,
  notice,
  onTyping,
  onBack,
  onOlder,
  onSend,
  onEdit,
  onDelete,
  onLeave,
  media,
  onSendMedia,
  onNotice,
  onExpired,
}: {
  media: MediaSetup;
  onSendMedia: (
    item: { file: Blob; kind: MediaKind; preview: string | null; durationMs?: number },
    caption: string,
    clientId?: string,
  ) => void;
  onNotice: (notice: string | null) => void;
  onExpired: () => void;
  texts: UiStrings;
  locale: string;
  me: string;
  now: number;
  conversation: Conversation;
  thread: Thread | undefined;
  pending: Pending[];
  typists: Person[];
  notice: string | null;
  onTyping: () => void;
  onBack: () => void;
  onOlder: (before: number) => Promise<void>;
  onSend: (text: string, clientId?: string) => void;
  onEdit: (message: Message, text: string) => Promise<void>;
  onDelete: (message: Message) => Promise<void>;
  onLeave: () => void;
}) {
  const [editing, setEditing] = useState<Message | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<{ item: MediaItem; mine: boolean } | null>(null);
  const expiredOnce = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const olderFrom = useRef<number | null>(null);
  const name = conversationName(conversation, me);
  const people = useMemo(
    () => new Map(conversation.members.map((m) => [m.userId, m])),
    [conversation.members],
  );
  const messages = thread?.messages ?? [];
  const group = conversation.kind === "group";
  const others = conversation.members.filter((m) => m.userId !== me);
  const sizes = {
    image: formatBytes(media.limits?.image ?? 10 * 1048576, texts.language),
    clip: formatBytes(media.limits?.clip ?? 25 * 1048576, texts.language),
  };

  /** A picked, dropped or pasted file into the composer, if it is a photo or clip we can send. */
  const stage = (file: File | undefined | null) => {
    if (!file || !media.enabled) return;
    const kind = kindOfFile(file);
    if (!kind) return onNotice(texts.notMedia);
    const cap = media.limits?.[kind] ?? (kind === "image" ? 10 : 25) * 1048576;
    if (file.size > cap) return onNotice(fill(texts.tooBigFile, sizes));
    onNotice(null);
    setStaged((old) => {
      if (old) URL.revokeObjectURL(old.preview);
      return { file, kind, preview: URL.createObjectURL(file), name: file.name };
    });
  };
  /** A link that ran out (the page stayed open past its window): the thread is fetched again, once. */
  const expired = () => {
    if (expiredOnce.current) return;
    expiredOnce.current = true;
    onExpired();
  };

  // Stay at the bottom as messages arrive, unless the reader scrolled up; keep the place when
  // older messages come in above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the list of messages changes
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (olderFrom.current !== null) {
      box.scrollTop = box.scrollHeight - olderFrom.current;
      olderFrom.current = null;
    } else if (stick.current) box.scrollTop = box.scrollHeight;
  }, [messages.length, pending.length, thread, typists.length]);

  return (
    <>
      <div className="thread-head">
        <button type="button" className="pill icon back" aria-label={texts.back} onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <Faces conversation={conversation} me={me} />
        <span className="lines">
          <span className="name">{name}</span>
          <span className="meta">
            {group
              ? fill(texts.membersCount, { n: conversation.members.length })
              : others[0]
                ? `@${others[0].handle}`
                : ""}
          </span>
        </span>
        {!group && others[0] && (
          <CallButton person={others[0]} label={fill(texts.callFriend, { name: others[0].displayName })} />
        )}
        {group && conversation.communityId && (
          <Link href={`/communities/${conversation.communityId}`} className="pill">
            {texts.communities}
          </Link>
        )}
        {group && !conversation.communityId && (
          <Menu label={texts.conversationOptions}>
            {(close) => (
              <Confirm
                texts={texts}
                question={fill(texts.confirmLeaveGroup, { name })}
                action={texts.leaveGroup}
                onConfirm={() => {
                  close();
                  onLeave();
                }}
              />
            )}
          </Menu>
        )}
      </div>

      <div
        className={`messages${dragging ? " dragging" : ""}`}
        ref={scroller}
        onDragEnter={(event) => {
          if (media.enabled && event.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(event) => {
          if (media.enabled && event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!media.enabled) return;
          event.preventDefault();
          setDragging(false);
          stage(event.dataTransfer.files[0]);
        }}
        onScroll={(event) => {
          const box = event.currentTarget;
          stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
      >
        {thread?.more && (
          <button
            type="button"
            className="pill older"
            onClick={() => {
              olderFrom.current = (scroller.current?.scrollHeight ?? 0) - (scroller.current?.scrollTop ?? 0);
              const first = messages[0];
              if (first) onOlder(first.seq);
            }}
          >
            {texts.loadOlder}
          </button>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay =
            !previous ||
            new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          const runStart = newDay || !sameRun(previous, message);
          const next = messages[index + 1];
          const runEnd = !next || !sameRun(message, next);
          const mine = message.authorId === me;
          const author = message.authorId ? people.get(message.authorId) : undefined;
          return (
            <div key={message.seq} className="msg-wrap">
              {newDay && <p className="day">{dayLabel(message.createdAt, now, texts, locale)}</p>}
              <div className={`msg${mine ? " mine" : ""}${runStart ? " first" : ""}`}>
                {group && !mine && (
                  <span className="msg-face">
                    {runStart && author && <Avatar person={author} size={28} />}
                  </span>
                )}
                <div className="msg-body">
                  {group && !mine && runStart && (
                    <span className="msg-author">{author?.displayName ?? "?"}</span>
                  )}
                  {!message.deletedAt &&
                  message.kind &&
                  message.kind !== "text" &&
                  message.attachments?.[0] ? (
                    <div
                      className={`bubble media-bubble ${message.kind}${message.caption ? " captioned" : ""}`}
                    >
                      <AttachmentView
                        attachment={message.attachments[0]}
                        texts={texts}
                        mine={mine}
                        onOpen={(item) => setViewing({ item, mine })}
                        onExpired={expired}
                      />
                      {message.caption && <p className="caption">{message.caption}</p>}
                    </div>
                  ) : (
                    <div className={`bubble${message.deletedAt ? " gone" : ""}`}>
                      {message.deletedAt ? texts.deletedMessage : message.text}
                    </div>
                  )}
                  {runEnd || message.editedAt ? (
                    <span className="msg-meta">
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleTimeString(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {message.editedAt && !message.deletedAt && <> · {texts.edited}</>}
                    </span>
                  ) : null}
                </div>
                {mine && !message.deletedAt && (
                  <Menu label={texts.messageOptions} small>
                    {(close) => (
                      <MessageActions
                        texts={texts}
                        canEdit={
                          now - Date.parse(message.createdAt) < editWindowMs &&
                          (!message.kind || message.kind === "text" || Boolean(message.caption))
                        }
                        onEdit={() => {
                          close();
                          setEditing(message);
                        }}
                        onDelete={() => {
                          close();
                          onDelete(message);
                        }}
                      />
                    )}
                  </Menu>
                )}
              </div>
            </div>
          );
        })}
        {pending.map((p) => (
          <div key={p.clientId} className="msg mine first">
            <div className="msg-body">
              {p.media ? (
                <div className={`bubble media-bubble pending ${p.media.kind}${p.failed ? " failed" : ""}`}>
                  <PendingMedia media={p.media} texts={texts} failed={p.failed} />
                  {p.text && <p className="caption">{p.text}</p>}
                </div>
              ) : (
                <div className={`bubble pending${p.failed ? " failed" : ""}`}>{p.text}</div>
              )}
              {p.failed && (
                <span className="msg-meta failed">
                  {texts.notSent} ·{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      p.media ? onSendMedia(p.media, p.text, p.clientId) : onSend(p.text, p.clientId)
                    }
                  >
                    {texts.retry}
                  </button>
                </span>
              )}
            </div>
          </div>
        ))}
        {typists.length > 0 && (
          <p className="typing" aria-live="polite">
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typingLine(texts, typists)}
          </p>
        )}
      </div>

      {dragging && (
        <div className="drop-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="stroke" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
          <strong>{texts.dropToAdd}</strong>
          <span>{fill(texts.dropHint, sizes)}</span>
        </div>
      )}
      {notice && (
        <p className="notice error thread-notice" role="alert">
          {notice}
        </p>
      )}
      <Composer
        key={editing?.seq ?? "new"}
        texts={texts}
        placeholder={staged ? texts.captionPlaceholder : fill(texts.composerPlaceholder, { name })}
        editing={editing}
        media={media}
        staged={staged}
        onStage={stage}
        onUnstage={() =>
          setStaged((old) => {
            if (old) URL.revokeObjectURL(old.preview);
            return null;
          })
        }
        onVoice={(recording) => {
          stick.current = true;
          onSendMedia(
            { file: recording.blob, kind: "voice", preview: null, durationMs: recording.durationMs },
            "",
          );
        }}
        onNotice={onNotice}
        onTyping={onTyping}
        onCancel={() => setEditing(null)}
        onSubmit={async (text) => {
          stick.current = true;
          if (editing) {
            await onEdit(editing, text);
            setEditing(null);
          } else if (staged) {
            onSendMedia({ file: staged.file, kind: staged.kind, preview: staged.preview }, text);
            setStaged(null);
          } else onSend(text);
        }}
      />
      <MediaViewer
        item={viewing?.item ?? null}
        texts={texts}
        locale={locale}
        canReport={Boolean(viewing && !viewing.mine)}
        onClose={() => setViewing(null)}
      />
    </>
  );
}

/** A media message on its way: its picture (or kind) and how far the upload got. */
function PendingMedia({
  media,
  texts,
  failed,
}: {
  media: NonNullable<Pending["media"]>;
  texts: UiStrings;
  failed: boolean;
}) {
  const percent = Math.round(media.progress * 100);
  return (
    <div className={`pending-media ${media.kind}`}>
      {media.preview && media.kind === "image" ? (
        <img src={media.preview} alt="" />
      ) : media.preview && media.kind === "clip" ? (
        <video src={media.preview} muted playsInline preload="metadata" />
      ) : (
        <span className="pending-kind">{texts[`kind_${media.kind}`]}</span>
      )}
      {!failed && (
        <span
          className="progress-ring"
          style={{ "--p": percent } as CSSProperties}
          title={fill(texts.uploading, { p: percent })}
        >
          <span>{percent}%</span>
        </span>
      )}
    </div>
  );
}

function Composer({
  texts,
  placeholder,
  editing,
  media,
  staged,
  onStage,
  onUnstage,
  onVoice,
  onNotice,
  onTyping,
  onCancel,
  onSubmit,
}: {
  texts: UiStrings;
  placeholder: string;
  editing: Message | null;
  media: MediaSetup;
  staged: Staged | null;
  onStage: (file: File | null | undefined) => void;
  onUnstage: () => void;
  onVoice: (recording: { blob: Blob; durationMs: number }) => void;
  onNotice: (notice: string | null) => void;
  onTyping: () => void;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void> | void;
}) {
  // A media message's text is its caption (its `text` may be a stand-in like "[photo]").
  const [text, setText] = useState(
    editing ? (editing.kind && editing.kind !== "text" ? (editing.caption ?? "") : (editing.text ?? "")) : "",
  );
  const [recording, setRecording] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Grows with what is typed, up to a few lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the text changes
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);

  const submit = () => {
    const clean = text.trim();
    if ((!clean && !staged) || clean.length > 4000) return;
    setText("");
    onSubmit(clean);
  };
  const canAttach = media.enabled && !editing;
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && editing) onCancel();
  };

  if (recording)
    return (
      <div className="composer">
        <VoiceRecorder
          texts={texts}
          maxMs={media.limits?.voiceMs ?? 60_000}
          onSend={(made) => {
            setRecording(false);
            onVoice(made);
          }}
          onCancel={() => setRecording(false)}
          onError={(message) => {
            setRecording(false);
            onNotice(message);
          }}
        />
      </div>
    );

  return (
    <form
      className={`composer${editing ? " editing" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {staged && (
        <div className="staged">
          {staged.kind === "image" ? (
            <img src={staged.preview} alt="" />
          ) : (
            <video src={staged.preview} muted playsInline preload="metadata" />
          )}
          <span className="lines">
            <span className="name">{staged.name || texts[`kind_${staged.kind}`]}</span>
            <span className="meta">
              {texts[`kind_${staged.kind}`]} · {formatBytes(staged.file.size, texts.language)}
            </span>
          </span>
          <button type="button" className="pill icon" aria-label={texts.removeAttachment} onClick={onUnstage}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      {editing && (
        <div className="editing-bar">
          <span>{texts.editing}</span>
          <button type="button" className="link" onClick={onCancel}>
            {texts.cancel}
          </button>
        </div>
      )}
      <div className="composer-row">
        {canAttach && (
          <>
            <button
              type="button"
              className="pill icon attach"
              aria-label={texts.attach}
              title={texts.attach}
              onClick={() => picker.current?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                <path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8.3-8.3a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
              </svg>
            </button>
            <input
              ref={picker}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,video/mp4"
              onChange={(event) => {
                onStage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </>
        )}
        <textarea
          ref={box}
          rows={1}
          maxLength={4000}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            if (!editing && event.target.value.trim()) onTyping();
          }}
          onKeyDown={onKey}
          onPaste={(event) => {
            if (!canAttach) return;
            const file = [...event.clipboardData.files].find((f) => kindOfFile(f));
            if (file) {
              event.preventDefault();
              onStage(file);
            }
          }}
        />
        {canAttach && !text.trim() && !staged ? (
          <button
            type="button"
            className="pill icon voice-btn"
            aria-label={texts.recordVoice}
            title={texts.recordVoice}
            onClick={() => {
              onNotice(null);
              setRecording(true);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
              <rect x="9" y="3.5" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
            </svg>
          </button>
        ) : null}
        <button
          type="submit"
          className="primary send"
          disabled={!text.trim() && !staged}
          aria-label={editing ? texts.save : texts.send}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            {editing ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M5 12h13M13 6l6 6-6 6" />}
          </svg>
        </button>
      </div>
    </form>
  );
}

function MessageActions({
  texts,
  canEdit,
  onEdit,
  onDelete,
}: {
  texts: UiStrings;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking)
    return (
      <Confirm
        texts={texts}
        question={texts.confirmDeleteMessage}
        action={texts.deleteMessage}
        onConfirm={onDelete}
      />
    );
  return (
    <>
      {canEdit && (
        <button type="button" role="menuitem" onClick={onEdit}>
          {texts.editMessage}
        </button>
      )}
      <button type="button" role="menuitem" className="danger" onClick={() => setAsking(true)}>
        {texts.deleteMessage}
      </button>
    </>
  );
}

/** A question with a dangerous answer, inside a menu. */
function Confirm({
  texts,
  question,
  action,
  onConfirm,
}: {
  texts: UiStrings;
  question: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm">
      <p>{question}</p>
      <div className="row">
        <button type="button" className="pill danger" onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  );
}

/** The ⋯ button and its pop-over, closed by a click outside or Escape. */
export function Menu({
  label,
  small,
  children,
}: {
  label: string;
  small?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`menu${small ? " msg-menu" : ""}${open ? " open" : ""}`} ref={box}>
      <button
        type="button"
        className="pill icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="pop" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function NewConversation({
  texts,
  notice,
  friends,
  onBack,
  onStart,
}: {
  texts: UiStrings;
  notice: string | null;
  friends: Person[];
  onBack: () => void;
  onStart: (members: string[], title: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const term = query.trim().replace(/^@/, "").toLowerCase();
  const shown = friends.filter(
    (f) => !term || f.handle.toLowerCase().includes(term) || f.displayName.toLowerCase().includes(term),
  );
  // Everyone picked and you: a group holds at most 32.
  const full = picked.length >= maxGroupMembers - 1;
  const toggle = (id: string) =>
    setPicked((all) =>
      all.includes(id) ? all.filter((x) => x !== id) : all.length >= maxGroupMembers - 1 ? all : [...all, id],
    );

  return (
    <div className="new-chat">
      <div className="thread-head">
        <button type="button" className="pill icon back" aria-label={texts.back} onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="lines">
          <span className="name">{picked.length > 1 ? texts.newGroup : texts.newMessage}</span>
          <span className="meta">
            {picked.length > 1
              ? fill(texts.groupPicked, { n: picked.length + 1, max: maxGroupMembers })
              : texts.pickFriends}
          </span>
        </span>
      </div>
      {friends.length === 0 ? (
        <p className="hint empty pad">{texts.noFriendsToMessage}</p>
      ) : (
        <>
          <div className="pick">
            <label htmlFor="to">{texts.to}</label>
            <div className="chips">
              {picked.map((id) => {
                const friend = friends.find((f) => f.userId === id);
                return (
                  friend && (
                    <button key={id} type="button" className="chip" onClick={() => toggle(id)}>
                      {friend.displayName}
                      <span aria-hidden="true">×</span>
                    </button>
                  )
                );
              })}
              <input
                id="to"
                type="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={texts.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <ul className="people pick-list">
            {shown.map((friend) => {
              const on = picked.includes(friend.userId);
              return (
                <li key={friend.userId}>
                  <button
                    type="button"
                    className={`pick-item${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => toggle(friend.userId)}
                  >
                    <Avatar person={friend} size={36} />
                    <span className="lines">
                      <span className="name">{friend.displayName}</span>
                      <span className="meta">@{friend.handle}</span>
                    </span>
                    <span className="tick" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="stroke" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {full && <p className="hint pad group-full">{fill(texts.groupFull, { max: maxGroupMembers })}</p>}
          {notice && (
            <p className="notice error thread-notice" role="alert">
              {notice}
            </p>
          )}
          <div className="new-foot">
            {picked.length > 1 && (
              <input
                type="text"
                maxLength={80}
                value={title}
                placeholder={texts.groupName}
                aria-label={texts.groupName}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            <button
              type="button"
              className="primary"
              disabled={!picked.length || busy}
              onClick={async () => {
                setBusy(true);
                await onStart(picked, picked.length > 1 ? title : "");
                setBusy(false);
              }}
            >
              {texts.start}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
