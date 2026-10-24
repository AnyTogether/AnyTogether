"use client";

import { Avatar } from "@/components/Avatar";
import { useLive, useLiveEvents } from "@/components/Live";
import type { UiStrings } from "@/lib/i18n";
import { type Person, fill } from "@/lib/people";
import {
  type Conversation,
  type Message,
  conversationName,
  editWindowMs,
  json,
  shortTime,
  social,
} from "@/lib/social";
import {
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
}

const byUpdated = (a: Conversation, b: Conversation) => b.updatedAt.localeCompare(a.updatedAt);
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
}: {
  texts: UiStrings;
  locale: string;
  initialConversations: Conversation[];
  initialSelected: string | null;
  friends: Person[];
}) {
  const { me, status } = useLive();
  const [conversations, setConversations] = useState(initialConversations);
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
        return take(event.data as Message, true);
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
    const result = await social<Message & { title?: string }>(`conversations/${conversationId}/messages`, {
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
    if (result.status === 403) setNotice(texts.cannotMessage);
  }

  async function edit(message: Message, text: string) {
    const result = await social<Message>(`conversations/${message.conversationId}/messages/${message.seq}`, {
      method: "PATCH",
      ...json({ text }),
    });
    if (result.body) take(result.body, false);
    else setNotice(texts.failed);
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
    const result = await social<Conversation>("conversations", {
      method: "POST",
      ...json({
        members,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(members.length > 1 ? { group: true } : {}),
      }),
    });
    if (!result.body || !result.ok)
      return setNotice(result.status === 403 ? texts.cannotMessage : texts.failed);
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
                      <span className="meta preview">
                        {c.lastMessage
                          ? `${c.lastMessage.authorId === me ? `${texts.you}: ` : ""}${
                              c.lastMessage.deletedAt ? texts.deletedMessage : c.lastMessage.text
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
              notice={notice}
              onBack={() => setSelected(null)}
              onOlder={(before) => loadThread(current.id, before)}
              onSend={(text, clientId) => send(current.id, text, clientId)}
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
  notice,
  onBack,
  onOlder,
  onSend,
  onEdit,
  onDelete,
  onLeave,
}: {
  texts: UiStrings;
  locale: string;
  me: string;
  now: number;
  conversation: Conversation;
  thread: Thread | undefined;
  pending: Pending[];
  notice: string | null;
  onBack: () => void;
  onOlder: (before: number) => Promise<void>;
  onSend: (text: string, clientId?: string) => void;
  onEdit: (message: Message, text: string) => Promise<void>;
  onDelete: (message: Message) => Promise<void>;
  onLeave: () => void;
}) {
  const [editing, setEditing] = useState<Message | null>(null);
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
  }, [messages.length, pending.length, thread]);

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
        {group && (
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
        className="messages"
        ref={scroller}
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
                  <div className={`bubble${message.deletedAt ? " gone" : ""}`}>
                    {message.deletedAt ? texts.deletedMessage : message.text}
                  </div>
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
                        canEdit={now - Date.parse(message.createdAt) < editWindowMs}
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
              <div className={`bubble pending${p.failed ? " failed" : ""}`}>{p.text}</div>
              {p.failed && (
                <span className="msg-meta failed">
                  {texts.notSent} ·{" "}
                  <button type="button" className="link" onClick={() => onSend(p.text, p.clientId)}>
                    {texts.retry}
                  </button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {notice && (
        <p className="notice error thread-notice" role="alert">
          {notice}
        </p>
      )}
      <Composer
        key={editing?.seq ?? "new"}
        texts={texts}
        placeholder={fill(texts.composerPlaceholder, { name })}
        editing={editing}
        onCancel={() => setEditing(null)}
        onSubmit={async (text) => {
          stick.current = true;
          if (editing) {
            await onEdit(editing, text);
            setEditing(null);
          } else onSend(text);
        }}
      />
    </>
  );
}

function Composer({
  texts,
  placeholder,
  editing,
  onCancel,
  onSubmit,
}: {
  texts: UiStrings;
  placeholder: string;
  editing: Message | null;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void> | void;
}) {
  const [text, setText] = useState(editing?.text ?? "");
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
    if (!clean || clean.length > 4000) return;
    setText("");
    onSubmit(clean);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && editing) onCancel();
  };

  return (
    <form
      className={`composer${editing ? " editing" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {editing && (
        <div className="editing-bar">
          <span>{texts.editing}</span>
          <button type="button" className="link" onClick={onCancel}>
            {texts.cancel}
          </button>
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={box}
          rows={1}
          maxLength={4000}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="submit"
          className="primary send"
          disabled={!text.trim()}
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
  friends,
  onBack,
  onStart,
}: {
  texts: UiStrings;
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
  const toggle = (id: string) =>
    setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  return (
    <div className="new-chat">
      <div className="thread-head">
        <button type="button" className="pill icon back" aria-label={texts.back} onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="lines">
          <span className="name">{texts.newMessage}</span>
          <span className="meta">{texts.pickFriends}</span>
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
