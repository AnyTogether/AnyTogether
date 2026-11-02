"use client";

import type { UiStrings } from "@/lib/i18n";
import { rateLimitText } from "@/lib/rateLimit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Texts = Pick<
  UiStrings,
  | "editBio"
  | "editProfileMore"
  | "noBio"
  | "addBio"
  | "bio"
  | "bioPlaceholder"
  | "save"
  | "saving"
  | "cancel"
  | "failed"
  | "noLinks"
  | "language"
  | "tooMany"
  | "tooManyWait"
>;

/** The bio on one's own profile, changed right there: the pencil at the top of the card (or a
 *  press on the bio) turns it into a text box with Save and Cancel. Esc cancels, ⌘/Ctrl+Enter
 *  saves. Anyone else's bio is plain text. */
export function ProfileBio({
  bio: initial,
  self,
  texts,
}: { bio: string | null; self: boolean; texts: Texts }) {
  const router = useRouter();
  const [bio, setBio] = useState(initial ?? "");
  const [draft, setDraft] = useState(bio);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);

  useEffect(() => setBio(initial ?? ""), [initial]);
  useEffect(() => {
    if (!editing) return;
    const area = box.current;
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  }, [editing]);

  if (!self) return <p className={`bio in d3${bio ? "" : " none"}`}>{bio || texts.noBio}</p>;

  const start = () => {
    setDraft(bio);
    setError(null);
    setEditing(true);
  };
  const stop = () => {
    setEditing(false);
    setError(null);
    // Back to where editing started, for the keyboard.
    requestAnimationFrame(() => pencil.current?.focus());
  };
  async function save() {
    const value = draft.trim();
    if (value === bio) return stop();
    setBusy(true);
    setError(null);
    const response = await fetch("/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio: value || null }),
    }).catch(() => undefined);
    const body = (await response?.json().catch(() => ({}))) ?? {};
    setBusy(false);
    if (!response?.ok) {
      setError(
        body.code === "links_not_allowed"
          ? texts.noLinks
          : body.code === "rate_limited"
            ? rateLimitText(body.retryAfter, texts)
            : texts.failed,
      );
      return;
    }
    setBio(typeof body.bio === "string" ? body.bio : "");
    stop();
    router.refresh();
  }

  return (
    <>
      <button
        ref={pencil}
        type="button"
        className="pill icon profile-pencil"
        aria-label={texts.editBio}
        title={texts.editBio}
        aria-expanded={editing}
        onClick={() => (editing ? stop() : start())}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
      </button>
      {editing ? (
        <form
          className="bio-edit in-place"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="visually-hidden" htmlFor="profile-bio">
            {texts.bio}
          </label>
          <textarea
            ref={box}
            id="profile-bio"
            rows={3}
            maxLength={160}
            placeholder={texts.bioPlaceholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                stop();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
          />
          <div className="bio-edit-row">
            <span className={`counter${draft.length > 150 ? " near" : ""}`} aria-hidden="true">
              {draft.length}/160
            </span>
            <Link href="/settings#profile" className="bio-more">
              {texts.editProfileMore}
            </Link>
            <button type="button" className="pill" onClick={stop} disabled={busy}>
              {texts.cancel}
            </button>
            <button type="submit" className="primary small" disabled={busy}>
              {busy ? texts.saving : texts.save}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <button type="button" className={`bio bio-own in d3${bio ? "" : " none"}`} onClick={start}>
          {bio || texts.addBio}
        </button>
      )}
    </>
  );
}
