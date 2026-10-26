"use client";

import { Avatar } from "@/components/Avatar";
import { CallButton } from "@/components/Calls";
import { LevelBadge } from "@/components/LevelBadge";
import { useLive, useLiveEvents } from "@/components/Live";
import { familyRefusal } from "@/lib/family";
import type { UiStrings } from "@/lib/i18n";
import {
  type Friend,
  type Person,
  type Requests,
  byPresence,
  fill,
  isUserId,
  playedFor,
  shownName,
  withPresence,
} from "@/lib/people";
import type { ShareInvite } from "@/lib/share";
import { social } from "@/lib/social";
import { playingTogether } from "@/lib/together";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

type Notice = { kind: "success" | "error"; text: string } | null;
type Relation = "friends" | "pending_out" | "pending_in" | null;

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** How often the list is read again: rarely while the gateway brings presence live, every 15 s while
 *  the socket is down. */
const slowPoll = 120_000;
const fastPoll = 15_000;

/** The friends page: add by handle, answer requests, and the list with presence, kept live by the
 *  gateway (presence.updated changes a row as it happens) with a slow poll behind it. */
export function FriendsBoard({
  texts,
  me,
  initialFriends,
  initialRequests,
  now: renderedAt,
}: {
  texts: UiStrings;
  me: string;
  initialFriends: Friend[];
  initialRequests: Requests;
  now: number;
}) {
  const router = useRouter();
  const [friends, setFriends] = useState(initialFriends);
  const [requests, setRequests] = useState(initialRequests);
  const [now, setNow] = useState(renderedAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const waiting = useRef(initialRequests.incoming.length);
  const [shareInvites, setShareInvites] = useState<ShareInvite[]>([]);

  const reload = useCallback(async () => {
    social<{ invites: ShareInvite[] }>("me/share-play").then((mine) => {
      if (mine.body) setShareInvites(mine.body.invites);
    });
    const [list, asks] = await Promise.all([fetch("/me/friends"), fetch("/me/friends/requests")]);
    if (list.ok) setFriends(((await list.json()) as { friends: Friend[] }).friends);
    if (asks.ok) {
      const next = (await asks.json()) as Requests;
      setRequests(next);
      // The header's badge is drawn on the server: redraw it when the count moves.
      if (next.incoming.length !== waiting.current) {
        waiting.current = next.incoming.length;
        router.refresh();
      }
    }
    setNow(Date.now());
  }, [router]);

  useEffect(() => {
    social<{ invites: ShareInvite[] }>("me/share-play").then((mine) => {
      if (mine.body) setShareInvites(mine.body.invites);
    });
  }, []);

  const { status } = useLive();
  useLiveEvents((event) => {
    if (event.type === "presence.updated") {
      setFriends((list) => withPresence(list, event.data));
      setNow(Date.now());
    } else if (
      // Someone new on the list or off it, or the socket back after a gap: read it all again.
      event.type === "friend.request" ||
      event.type === "friend.accepted" ||
      event.type === "friend.removed" ||
      event.type === "live.ready"
    ) {
      reload().catch(() => undefined);
    }
  });

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) reload().catch(() => undefined);
    };
    const timer = setInterval(tick, status === "ready" ? slowPoll : fastPoll);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload, status]);

  async function act(userId: string, path: string, init: RequestInit) {
    setBusy(userId);
    setNotice(null);
    const response = await fetch(path, init).catch(() => undefined);
    if (!response?.ok) setNotice({ kind: "error", text: texts.failed });
    await reload().catch(() => undefined);
    setBusy(null);
    return response?.ok ?? false;
  }

  async function add(handle: string) {
    const clean = handle.trim().replace(/^@/, "");
    if (!clean) return false;
    if (clean.toLowerCase() === me.toLowerCase()) {
      setNotice({ kind: "error", text: texts.thatIsYou });
      return false;
    }
    setBusy(clean);
    setNotice(null);
    const response = await fetch("/me/friends/requests", {
      method: "POST",
      ...json({ handle: clean }),
    }).catch(() => undefined);
    const result = (await response?.json().catch(() => ({}))) as {
      state?: string;
      title?: string;
      code?: string;
      side?: string;
    };
    if (response?.ok) {
      const template = result.state === "accepted" ? texts.nowFriends : texts.requestSent;
      setNotice({ kind: "success", text: fill(template, { handle: clean }) });
      await reload().catch(() => undefined);
    } else {
      const text =
        familyRefusal(result, texts) ??
        (response?.status === 404
          ? texts.noOne
          : response?.status === 400
            ? texts.thatIsYou
            : (result.title ?? texts.failed));
      setNotice({ kind: "error", text });
    }
    setBusy(null);
    return response?.ok ?? false;
  }

  const answer = (userId: string, verdict: "accept" | "decline") =>
    isUserId(userId) && act(userId, `/me/friends/requests/${userId}/${verdict}`, { method: "POST" });
  const drop = (userId: string) =>
    isUserId(userId) && act(userId, `/me/friends/${userId}`, { method: "DELETE" });
  const block = (userId: string) => act(userId, "/me/blocks", { method: "POST", ...json({ userId }) });

  const relation = (userId: string): Relation =>
    friends.some((f) => f.userId === userId)
      ? "friends"
      : requests.outgoing.some((r) => r.userId === userId)
        ? "pending_out"
        : requests.incoming.some((r) => r.userId === userId)
          ? "pending_in"
          : null;

  const sorted = [...friends].sort(byPresence);
  const online = friends.filter((f) => f.presence.state !== "offline").length;
  const playing = friends.filter((f) => f.presence.state === "in_game").length;

  return (
    <section className="page">
      <h2 className="in d1">{texts.friends}</h2>
      <p className="lead in d2">
        {friends.length > 0 ? (
          <>
            <span className="count">
              <i className="dot" />
              {fill(texts.countOnline, { n: online })}
            </span>
            {playing > 0 && <span className="count">{fill(texts.countPlaying, { n: playing })}</span>}
          </>
        ) : (
          texts.friendsLead
        )}
      </p>

      <div className="in d3">
        <Search
          texts={texts}
          busy={busy}
          relation={relation}
          onAdd={add}
          onAccept={(id) => answer(id, "accept")}
        />
        {notice && (
          <p className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        )}

        {shareInvites.length > 0 && (
          <div className="card">
            <h3 className="sub">
              {texts.shareInvitesTitle} <span className="n">{shareInvites.length}</span>
            </h3>
            <ul className="people">
              {shareInvites.map((invite) => (
                <li key={invite.sharePlayId} className="person share-row">
                  {invite.from ? (
                    <Who person={invite.from}>
                      <span className="status sharing">
                        <span className="live-dot" aria-hidden="true" />
                        {fill(texts.shareSharing, { game: invite.title ?? invite.titleId })}
                      </span>
                    </Who>
                  ) : (
                    <span className="who" />
                  )}
                  <div className="acts">
                    <button
                      type="button"
                      className="pill"
                      onClick={() => {
                        setShareInvites((list) => list.filter((i) => i.sharePlayId !== invite.sharePlayId));
                        social(`share-plays/${invite.sharePlayId}/decline`, { method: "POST" });
                      }}
                    >
                      {texts.decline}
                    </button>
                    <Link href={`/watch/${invite.sharePlayId}`} className="pill watch-btn">
                      <EyeIcon />
                      {texts.shareWatch}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {requests.incoming.length > 0 && (
          <div className="card">
            <h3 className="sub">
              {texts.requests} <span className="n">{requests.incoming.length}</span>
            </h3>
            <ul className="people">
              {requests.incoming.map((person) => (
                <li key={person.userId} className="person">
                  <Who person={person} />
                  <div className="acts">
                    <button
                      type="button"
                      className="primary small"
                      disabled={busy === person.userId}
                      onClick={() => answer(person.userId, "accept")}
                    >
                      {texts.accept}
                    </button>
                    <button
                      type="button"
                      className="pill"
                      disabled={busy === person.userId}
                      onClick={() => answer(person.userId, "decline")}
                    >
                      {texts.decline}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card raise">
          <div className="card-head">
            <h3 className="sub">
              {texts.friends} <span className="n">{friends.length}</span>
            </h3>
            <Link href="/players" className="quiet-link">
              {texts.playersMet}
            </Link>
          </div>
          {sorted.length === 0 ? (
            <p className="hint empty">{texts.noFriends}</p>
          ) : (
            <ul className="people">
              {sorted.map((friend) => (
                <li key={friend.userId} className={`person ${friend.presence.state}`}>
                  <Who
                    person={friend}
                    presence={friend}
                    badge={<LevelBadge level={friend.level} texts={texts} />}
                  >
                    <Status friend={friend} now={now} texts={texts} />
                  </Who>
                  <div className="acts">
                    {friend.presence.share && (
                      <Link
                        href={`/watch/${friend.presence.share.sharePlayId}`}
                        className="pill watch-btn"
                        aria-label={fill(texts.shareWatchFriend, { name: friend.displayName })}
                        title={fill(texts.shareWatchFriend, { name: friend.displayName })}
                      >
                        <EyeIcon />
                        <span className="wide">{texts.shareWatch}</span>
                      </Link>
                    )}
                    <CallButton
                      person={friend}
                      label={fill(texts.callFriend, { name: friend.displayName })}
                    />
                    <FriendMenu
                      friend={friend}
                      texts={texts}
                      busy={busy === friend.userId}
                      onRemove={() => drop(friend.userId)}
                      onBlock={() => block(friend.userId)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {requests.outgoing.length > 0 && (
          <div className="card">
            <h3 className="sub">
              {texts.sent} <span className="n">{requests.outgoing.length}</span>
            </h3>
            <ul className="people">
              {requests.outgoing.map((person) => (
                <li key={person.userId} className="person">
                  <Who person={person} />
                  <div className="acts">
                    <button
                      type="button"
                      className="pill"
                      disabled={busy === person.userId}
                      onClick={() => drop(person.userId)}
                    >
                      {texts.cancelRequest}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Avatar, name and @handle, linking to the profile; a status line under it when given. */
function Who({
  person,
  presence,
  badge,
  children,
}: {
  person: Person;
  presence?: Friend;
  /** Beside the name: the trophy level. */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Link href={`/u/${person.handle}`} className="who">
      <Avatar person={person} presence={presence?.presence.state} />
      <span className="lines">
        <span className="name">
          {shownName(person)}
          {badge}
          {children && <span className="handle"> @{person.handle}</span>}
        </span>
        <span className="meta">{children ?? <span className="handle">@{person.handle}</span>}</span>
      </span>
    </Link>
  );
}

function Status({ friend, now, texts }: { friend: Friend; now: number; texts: UiStrings }) {
  const { state, titleId, since, share } = friend.presence;
  if (share) {
    const [before, after] = texts.shareSharing.split("{game}");
    return (
      <span className="status sharing">
        <span className="what">
          {before}
          <b>{share.title ?? share.titleId}</b>
          {after}
        </span>{" "}
        <span className="time">· {fill(texts.shareSeats, { n: share.viewers, max: share.maxViewers })}</span>
      </span>
    );
  }
  // In a Play Together game: "Playing PPSA17221 together (2/4)".
  const together = playingTogether(friend.presence, texts, new Map());
  if (together) {
    const time = playedFor(since, now, texts);
    return (
      <span className="status playing together">
        <span className="what">{together}</span>
        {time && (
          <>
            {" "}
            <span className="time">· {time}</span>
          </>
        )}
      </span>
    );
  }
  if (state === "in_game") {
    const time = playedFor(since, now, texts);
    const [before, after] = texts.inGame.split("{title}");
    return (
      <span className="status playing">
        <span className="what">
          {before}
          <b>{titleId ?? "?"}</b>
          {after}
        </span>
        {time && (
          <>
            {" "}
            <span className="time">· {time}</span>
          </>
        )}
      </span>
    );
  }
  const label =
    state === "online" ? texts.stateOnline : state === "away" ? texts.stateAway : texts.stateOffline;
  return <span className={`status ${state}`}>{label}</span>;
}

/** The ⋯ menu on a friend: their profile, remove, block (the last two ask first). */
function FriendMenu({
  friend,
  texts,
  busy,
  onRemove,
  onBlock,
}: {
  friend: Friend;
  texts: UiStrings;
  busy: boolean;
  onRemove: () => void;
  onBlock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"remove" | "block" | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setConfirm(null);
  }, [open]);

  return (
    <div className="menu" ref={box}>
      <button
        type="button"
        className="pill icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={fill(texts.more, { name: friend.displayName })}
        disabled={busy}
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
          {confirm ? (
            <div className="confirm">
              <p>
                {fill(confirm === "remove" ? texts.confirmRemove : texts.confirmBlock, {
                  name: friend.displayName,
                })}
              </p>
              <div className="row">
                <button type="button" className="pill" onClick={() => setConfirm(null)}>
                  {texts.keep}
                </button>
                <button
                  type="button"
                  className="pill danger"
                  onClick={() => {
                    setOpen(false);
                    (confirm === "remove" ? onRemove : onBlock)();
                  }}
                >
                  {confirm === "remove" ? texts.remove : texts.block}
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link role="menuitem" href={`/u/${friend.handle}`}>
                {texts.viewProfile}
              </Link>
              <button type="button" role="menuitem" onClick={() => setConfirm("remove")}>
                {texts.remove}
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => setConfirm("block")}>
                {texts.block}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Add by handle: live results as you type, Enter sends to the exact handle. */
function Search({
  texts,
  busy,
  relation,
  onAdd,
  onAccept,
}: {
  texts: UiStrings;
  busy: string | null;
  relation: (userId: string) => Relation;
  onAdd: (handle: string) => Promise<boolean>;
  onAccept: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);

  useEffect(() => {
    const term = query.trim().replace(/^@/, "");
    if (term.length < 2) {
      setFound(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/me/users/search?q=${encodeURIComponent(term)}`, {
        signal: abort.signal,
      }).catch(() => undefined);
      if (!response?.ok) return;
      setFound(((await response.json()) as { users: Person[] }).users);
    }, 220);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  return (
    <form
      className="card search"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onAdd(query)) setQuery("");
      }}
    >
      <label htmlFor="find">{texts.addFriend}</label>
      <div className="field">
        <span className="at" aria-hidden="true">
          @
        </span>
        <input
          id="find"
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          aria-label={texts.searchLabel}
          placeholder={texts.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="primary small" disabled={!query.trim() || busy !== null}>
          {texts.add}
        </button>
      </div>
      {found && (
        <ul className="people results">
          {found.length === 0 && <li className="hint empty">{texts.noResults}</li>}
          {found.map((person) => {
            const known = relation(person.userId);
            return (
              <li key={person.userId} className="person">
                <Who person={person} />
                <div className="acts">
                  {known === "friends" ? (
                    <span className="tag">{texts.areFriends}</span>
                  ) : known === "pending_out" ? (
                    <span className="tag">{texts.requested}</span>
                  ) : known === "pending_in" ? (
                    <button type="button" className="primary small" onClick={() => onAccept(person.userId)}>
                      {texts.accept}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pill"
                      disabled={busy !== null}
                      onClick={() => onAdd(person.handle)}
                    >
                      {texts.add}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
