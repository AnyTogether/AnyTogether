"use client";

import { When } from "@/components/When";

import { Avatar } from "@/components/Avatar";
import { useLiveEvents } from "@/components/Live";
import { duration } from "@/lib/family";
import { since } from "@/lib/feed";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { type Notice, type NoticePage, noticeHref } from "@/lib/notify";
import { fill } from "@/lib/people";
import { social } from "@/lib/social";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useState } from "react";

/** "{name} sent…" with each blank filled by a node. */
function rich(template: string, parts: Record<string, ReactNode>) {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed template
    return key && key in parts ? <Fragment key={index}>{parts[key]}</Fragment> : piece;
  });
}

/** The small mark on the avatar that says what kind of notification it is. */
function Mark({ kind }: { kind: Notice["kind"] }) {
  return (
    <span className={`kind-mark n-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {kind === "friend_request" || kind === "friend_accepted" ? (
          <>
            <circle cx="9" cy="8.5" r="3" />
            <path
              d={
                kind === "friend_request"
                  ? "M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5M16 7v6M13 10h6"
                  : "M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5M14.5 10l2 2 4-4"
              }
            />
          </>
        ) : kind === "message" ? (
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5z" />
        ) : kind === "party_invite" ? (
          <>
            <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
            <rect x="3" y="13.5" width="4.5" height="6.5" rx="1.6" />
            <rect x="16.5" y="13.5" width="4.5" height="6.5" rx="1.6" />
          </>
        ) : kind === "game_invite" ? (
          <>
            <rect x="2.5" y="7" width="19" height="11" rx="4" />
            <path d="M7.5 10.5v4M5.5 12.5h4" />
          </>
        ) : kind === "lfg_request" || kind === "lfg_accepted" ? (
          <>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M19.5 19.5l-4.4-4.4" />
            {kind === "lfg_accepted" ? (
              <path d="M7.8 10.6l2 2 3.6-3.8" />
            ) : (
              <path d="M10.5 7.8v5.4M7.8 10.5h5.4" />
            )}
          </>
        ) : kind === "level_up" ? (
          <path d="M12 3 19.8 7.5v9L12 21l-7.8-4.5v-9zM9 13l3-3 3 3" />
        ) : kind === "community_invite" ? (
          <>
            <circle cx="8" cy="9" r="2.6" />
            <circle cx="16" cy="9" r="2.6" />
            <path d="M3 18.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4M12.5 15.2c.9-.5 2.1-.7 3.5-.7 2.4 0 4.4 1.4 5 4" />
          </>
        ) : kind === "event_reminder" || kind === "event_started" ? (
          <>
            <rect x="3.5" y="5" width="17" height="15" rx="3" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
            {kind === "event_started" && <path d="M10.5 13l3.5 2-3.5 2z" />}
          </>
        ) : kind.startsWith("family_") ? (
          <>
            <path d="M4 11.5L12 5l8 6.5V20h-5.5v-5h-5v5H4z" />
          </>
        ) : kind === "missed_call" ? (
          <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2zM15 3l6 6M21 3l-6 6" />
        ) : (
          <path d="M12 3l9.5 16.5h-19zM12 10v4M12 17v.5" />
        )}
      </svg>
    </span>
  );
}

function Item({
  notice,
  texts,
  now,
  onOpen,
  onAnswer,
  busy,
  error,
}: {
  notice: Notice;
  texts: UiStrings;
  now: number;
  onOpen: (notice: Notice) => void;
  onAnswer: (notice: Notice, answer: "accept" | "decline") => void;
  busy: boolean;
  /** Why the last answer did not go through. */
  error?: string | null;
}) {
  const { language } = texts;
  const name = <b>{notice.actor?.displayName ?? texts.n_someone}</b>;
  const count = notice.data.count ?? 1;
  const title = <b>{notice.data.title ?? ""}</b>;
  let line: ReactNode;
  let detail: string | null = null;
  switch (notice.kind) {
    case "message": {
      const group = notice.data.group && notice.data.title;
      line = rich(
        group
          ? count > 1
            ? texts.n_messages_group
            : texts.n_message_group
          : count > 1
            ? texts.n_messages
            : texts.n_message,
        { name, title, n: count },
      );
      detail = notice.data.text ?? null;
      break;
    }
    case "game_invite":
      line = rich(texts.n_game_invite, {
        name,
        game: <b>{localName(notice.data.gameNames ?? {}, language) || notice.data.titleId}</b>,
      });
      detail = texts.n_game_invite_hint;
      break;
    case "lfg_request":
    case "lfg_accepted": {
      const game = <b>{localName(notice.data.gameNames ?? {}, language) || notice.data.titleId}</b>;
      line = rich(
        notice.kind === "lfg_accepted"
          ? texts.n_lfg_accepted
          : count > 1
            ? texts.n_lfg_requests
            : texts.n_lfg_request,
        { name, game, others: count - 1 },
      );
      if (notice.kind === "lfg_accepted")
        detail =
          notice.data.invite?.kind === "share_play" ? texts.n_lfg_accepted_share : texts.n_lfg_accepted_party;
      break;
    }
    case "family_invite":
      line = rich(texts.n_family_invite, { name });
      detail = notice.data.familyName ?? null;
      break;
    case "family_request":
    case "family_answer":
    case "family_alert": {
      const key = (
        notice.kind === "family_request"
          ? `n_family_request_${notice.data.kind}`
          : notice.kind === "family_answer"
            ? `n_family_answer_${notice.data.approved ? "yes" : "no"}`
            : `n_family_alert_${notice.data.event}`
      ) as keyof UiStrings;
      const template = typeof texts[key] === "string" ? (texts[key] as string) : texts.n_family_invite;
      line = rich(template, {
        name,
        minutes: notice.data.minutes ?? 0,
        person: <b>{notice.data.person?.displayName ?? ""}</b>,
        game: <b>{notice.data.gameName ?? notice.data.titleId ?? ""}</b>,
      });
      break;
    }
    case "family_summary": {
      const seconds = (notice.data.children ?? []).reduce((sum, child) => sum + child.seconds, 0);
      line = fill(texts.n_family_summary, { time: duration(seconds, language) });
      detail = (notice.data.children ?? [])
        .map((child) => `${child.displayName}: ${duration(child.seconds, language)}`)
        .join(" · ");
      break;
    }
    case "level_up":
      line = rich(texts.n_level_up, { level: <b>{notice.data.level ?? "?"}</b> });
      break;
    case "community_invite":
      line = rich(texts.n_community_invite, { name, community: <b>{notice.data.name ?? ""}</b> });
      break;
    case "event_reminder":
    case "event_started":
      line = rich(notice.kind === "event_started" ? texts.n_event_started : texts.n_event_reminder, {
        name,
        event: <b>{notice.data.title ?? ""}</b>,
      });
      detail = notice.data.community ?? null;
      break;
    case "warning":
      line = texts.n_warning;
      detail = notice.data.reason ? fill(texts.n_warning_reason, { reason: notice.data.reason }) : null;
      break;
    case "appeal":
      line = notice.data.decision === "accepted" ? texts.n_appeal_accepted : texts.n_appeal_declined;
      detail = notice.data.reply ? fill(texts.n_appeal_reply, { reply: notice.data.reply }) : null;
      break;
    default:
      line = rich(texts[`n_${notice.kind}`], { name });
  }
  const href = noticeHref(notice);
  const body = (
    <>
      <p className="activity-line">{line}</p>
      {detail && <p className="notice-detail">{detail}</p>}
      <p className="activity-meta">
        <When iso={notice.updatedAt} language={language} now={now} />
      </p>
    </>
  );
  return (
    <li className={`activity notice-item${notice.read ? "" : " unread"}`}>
      <span className="activity-avatar">
        {notice.actor ? (
          <Avatar person={notice.actor} size={40} />
        ) : (
          <span className="avatar system" style={{ "--size": "40px" } as React.CSSProperties} />
        )}
        <Mark kind={notice.kind} />
      </span>
      <div className="activity-body">
        {href ? (
          <Link
            href={href}
            className="notice-link"
            onClick={(event) => {
              event.preventDefault();
              onOpen(notice);
            }}
          >
            {body}
          </Link>
        ) : (
          <button type="button" className="notice-link" onClick={() => onOpen(notice)}>
            {body}
          </button>
        )}
        {(notice.kind === "friend_request" ||
          (notice.kind === "lfg_request" && count === 1 && notice.data.postId)) &&
          !notice.read && (
            <div className="acts notice-acts">
              <button
                type="button"
                className="primary small"
                disabled={busy}
                onClick={() => onAnswer(notice, "accept")}
              >
                {notice.kind === "lfg_request" ? texts.letIn : texts.accept}
              </button>
              <button
                type="button"
                className="pill"
                disabled={busy}
                onClick={() => onAnswer(notice, "decline")}
              >
                {texts.decline}
              </button>
            </div>
          )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!notice.read && <span className="unread-dot" />}
    </li>
  );
}

/** The notifications page: newest first, live, older pages, read one by opening it or all at once. */
export function NotificationList({
  texts,
  initial,
  now: renderedAt,
}: {
  texts: UiStrings;
  initial: NoticePage;
  now: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.notifications);
  const [unread, setUnread] = useState(initial.unread);
  const [more, setMore] = useState(initial.more);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useLiveEvents((event) => {
    if (event.type === "notification") {
      const notice = event.data.notification as Notice;
      setItems((list) => [notice, ...list.filter((n) => n.id !== notice.id)]);
      setUnread(Number(event.data.unread ?? 0));
      setNow(Date.now());
    } else if (event.type === "notification.read") {
      const ids = event.data.ids as string[] | null;
      setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
      setUnread(Number(event.data.unread ?? 0));
    }
  });

  const markRead = async (ids: string[] | null) => {
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    const { body } = await social<{ unread: number }>(
      ids ? `me/notifications/${ids[0]}/read` : "me/notifications/read-all",
      { method: "POST" },
    );
    if (body) setUnread(body.unread);
  };

  async function open(notice: Notice) {
    if (!notice.read) await markRead([notice.id]);
    const href = noticeHref(notice);
    if (href) router.push(href);
  }

  async function answer(notice: Notice, verdict: "accept" | "decline") {
    if (!notice.actor) return;
    setBusy(notice.id);
    const path =
      notice.kind === "lfg_request"
        ? `/me/social/lfg/${notice.data.postId}/requests/${notice.actor.userId}/${verdict}`
        : `/me/friends/requests/${notice.actor.userId}/${verdict}`;
    setFailed(null);
    const response = await fetch(path, { method: "POST" }).catch(() => undefined);
    setBusy(null);
    // Answered (here or elsewhere): the API settles the notification and says so.
    if (response?.ok || response?.status === 404) await markRead([notice.id]);
    else {
      const code = ((await response?.json().catch(() => null)) as { code?: string } | null)?.code;
      setFailed({
        id: notice.id,
        text:
          code === "not_party_leader"
            ? texts.notPartyLeader
            : code === "full"
              ? texts.partyFull
              : code === "conflict"
                ? texts.postClosed
                : texts.failed,
      });
    }
    router.refresh();
  }

  async function older() {
    const last = items.at(-1);
    if (!last || loading) return;
    setLoading(true);
    const { body } = await social<NoticePage>(`me/notifications?before=${last.id}`);
    if (body) {
      setItems((list) => [...list, ...body.notifications.filter((n) => !list.some((k) => k.id === n.id))]);
      setMore(body.more);
    }
    setLoading(false);
  }

  return (
    <>
      <div className="notice-head">
        <span className="count">{unread > 0 ? fill(texts.unreadNotifications, { n: unread }) : null}</span>
        {unread > 0 && (
          <button type="button" className="pill" onClick={() => markRead(null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M3 12.5l4 4 8-9M11 16.5l1 1 8-9" />
            </svg>
            {texts.markAllRead}
          </button>
        )}
      </div>
      {items.length ? (
        <ul className="activities notices">
          {items.map((notice) => (
            <Item
              key={notice.id}
              notice={notice}
              texts={texts}
              now={now}
              onOpen={open}
              onAnswer={answer}
              busy={busy === notice.id}
              error={failed?.id === notice.id ? failed.text : null}
            />
          ))}
        </ul>
      ) : (
        <p className="hint empty">{texts.noNotifications}</p>
      )}
      {more && (
        <div className="more-row">
          <button type="button" className="pill" onClick={older} disabled={loading}>
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}
