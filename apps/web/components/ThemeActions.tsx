"use client";

import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeShare } from "./ThemeShare";

/** The heart on a theme's page, with its count; signed out it leads to sign-in. */
export function ThemeLike({
  id,
  liked: initialLiked,
  likes: initialLikes,
  signedIn,
  texts,
}: {
  id: string;
  liked: boolean;
  likes: number;
  signedIn: boolean;
  texts: UiStrings;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [busy, setBusy] = useState(false);
  if (!signedIn)
    return (
      <a href={`/login?next=/themes/${id}`} className="pill like" title={texts.signInToLike}>
        <Heart />
        <span>{likes}</span>
      </a>
    );
  return (
    <button
      type="button"
      className={`pill like${liked ? " on" : ""}`}
      aria-pressed={liked}
      aria-label={`${liked ? texts.liked : texts.like}, ${fill(texts.likesCount, { n: likes })}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // Shown at once, put back if the server says no.
        const next = !liked;
        setLiked(next);
        setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
        const response = await fetch(`/me/themes/${id}/like`, { method: next ? "PUT" : "DELETE" }).catch(
          () => undefined,
        );
        const answer = response?.ok ? await response.json().catch(() => null) : null;
        if (answer) {
          setLiked(answer.liked);
          setLikes(answer.likes);
        } else {
          setLiked(!next);
          setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
        }
        setBusy(false);
      }}
    >
      <Heart />
      <span>{likes}</span>
    </button>
  );
}

function Heart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  );
}

/** The maker's tools: change the words, upload a new version, delete. */
export function ThemeOwner({
  theme,
  texts,
}: {
  theme: { id: string; name: string; description: string | null };
  texts: UiStrings;
}) {
  const router = useRouter();
  const [name, setName] = useState(theme.name);
  const [description, setDescription] = useState(theme.description ?? "");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const changed = name.trim() !== theme.name || description.trim() !== (theme.description ?? "");

  return (
    <article className="card owner in d4">
      <h3 className="sub">{texts.makerTools}</h3>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setState("busy");
          setError(null);
          const response = await fetch(`/me/themes/${theme.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name.trim(), description: description.trim() }),
          }).catch(() => undefined);
          if (response?.ok) {
            setState("saved");
            router.refresh();
            return;
          }
          const answer = await response?.json().catch(() => null);
          setState("idle");
          setError(answer?.title ?? texts.failed);
        }}
      >
        <div className="field-group">
          <label htmlFor="theme-name">{texts.name}</label>
          <input
            id="theme-name"
            value={name}
            maxLength={60}
            required
            onChange={(event) => {
              setName(event.target.value);
              setState("idle");
            }}
          />
        </div>
        <div className="field-group">
          <span className="label-row">
            <label htmlFor="theme-about">{texts.description}</label>
            <span className={`counter${description.length > 450 ? " near" : ""}`}>
              {description.length}/500
            </span>
          </span>
          <textarea
            id="theme-about"
            rows={3}
            maxLength={500}
            value={description}
            placeholder={texts.descriptionHint}
            onChange={(event) => {
              setDescription(event.target.value);
              setState("idle");
            }}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="save-row">
          <button type="submit" className="pill" disabled={!changed || state === "busy"}>
            {texts.save}
          </button>
          <span className={`saved${state === "saved" ? " on" : ""}`} aria-live="polite">
            {state === "saved" ? texts.saved : ""}
          </span>
        </div>
      </form>
      <hr />
      <h3 className="sub">{texts.newVersion}</h3>
      <p className="hint-line">{texts.newVersionHint}</p>
      <ThemeShare texts={texts} themeId={theme.id} />
      <hr />
      {confirming ? (
        <div className="confirm">
          <p>{fill(texts.deleteThemeConfirm, { name: theme.name })}</p>
          <div className="row">
            <button type="button" className="pill" onClick={() => setConfirming(false)}>
              {texts.cancel}
            </button>
            <button
              type="button"
              className="pill danger solid"
              onClick={async () => {
                const response = await fetch(`/me/themes/${theme.id}`, { method: "DELETE" }).catch(
                  () => undefined,
                );
                if (response?.ok) router.push("/themes/mine");
                else setError(texts.failed);
              }}
            >
              {texts.delete}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pill danger" onClick={() => setConfirming(true)}>
          {texts.deleteTheme}
        </button>
      )}
    </article>
  );
}
