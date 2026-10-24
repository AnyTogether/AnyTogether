"use client";

import type { UiStrings } from "@/lib/i18n";
import { type Friendship, type Profile, fill } from "@/lib/people";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

/** The one friendship step that fits on a profile: add, pending, accept, or friends with remove. */
export function FriendAction({ profile, texts }: { profile: Profile; texts: UiStrings }) {
  const router = useRouter();
  const [state, setState] = useState<Friendship>(profile.friendship);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, init: RequestInit, next: (body: { state?: string }) => Friendship) {
    setBusy(true);
    setError(null);
    const response = await fetch(path, init).catch(() => undefined);
    const body = (await response?.json().catch(() => ({}))) ?? {};
    setBusy(false);
    if (!response?.ok) {
      setError(response?.status === 404 ? texts.noOne : texts.failed);
      return;
    }
    setState(next(body));
    setConfirm(false);
    // The header's request badge comes from the server.
    router.refresh();
  }

  const id = profile.userId;
  const add = () =>
    call(
      "/me/friends/requests",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: profile.handle }),
      },
      (body) => (body.state === "accepted" ? "friends" : "pending_out"),
    );
  const answer = (verdict: "accept" | "decline") =>
    call(`/me/friends/requests/${id}/${verdict}`, { method: "POST" }, () =>
      verdict === "accept" ? "friends" : "none",
    );
  const drop = () => call(`/me/friends/${id}`, { method: "DELETE" }, () => "none");

  let body: ReactNode;
  if (state === "me") {
    body = (
      <>
        <span className="tag">{texts.thisIsYou}</span>
        <Link href="/friends" className="pill">
          {texts.friends}
        </Link>
      </>
    );
  } else if (state === "none") {
    body = (
      <button type="button" className="primary" disabled={busy} onClick={add}>
        {texts.addFriend}
      </button>
    );
  } else if (state === "pending_out") {
    body = (
      <>
        <span className="tag">
          <i className="dot" />
          {texts.requestPending}
        </span>
        <button type="button" className="pill" disabled={busy} onClick={drop}>
          {texts.cancelRequest}
        </button>
      </>
    );
  } else if (state === "pending_in") {
    body = (
      <>
        <p className="hint wide-row">{fill(texts.wantsToBeFriends, { name: profile.displayName })}</p>
        <button type="button" className="primary" disabled={busy} onClick={() => answer("accept")}>
          {texts.accept}
        </button>
        <button type="button" className="pill" disabled={busy} onClick={() => answer("decline")}>
          {texts.decline}
        </button>
      </>
    );
  } else if (confirm) {
    body = (
      <>
        <p className="hint wide-row">{fill(texts.confirmRemove, { name: profile.displayName })}</p>
        <button type="button" className="pill" disabled={busy} onClick={() => setConfirm(false)}>
          {texts.keep}
        </button>
        <button type="button" className="pill danger" disabled={busy} onClick={drop}>
          {texts.remove}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <span className="tag friends">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.2 4L19 7" />
          </svg>
          {texts.areFriends}
        </span>
        <button type="button" className="pill" onClick={() => setConfirm(true)}>
          {texts.remove}
        </button>
      </>
    );
  }

  return (
    <div className="action">
      {body}
      {error && (
        <p className="error wide-row" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
