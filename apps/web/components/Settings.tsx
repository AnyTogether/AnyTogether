"use client";

import { ago } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import {
  type Own,
  type Privacy,
  type PrivacySection,
  type SignedIn,
  type Visibility,
  fill,
  privacySections,
} from "@/lib/people";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState } from "react";

type Status = { kind: "idle" | "busy" | "saved" } | { kind: "error"; text: string };

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function send(path: string, init: RequestInit) {
  const response = await fetch(path, init).catch(() => undefined);
  const body = (await response?.json().catch(() => ({}))) as Record<string, unknown> & { code?: string };
  return { ok: response?.ok ?? false, status: response?.status ?? 0, body: body ?? {} };
}

/** "Saved" for a moment after a save, then quiet again. */
function useSaved(status: Status, setStatus: (status: Status) => void) {
  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = setTimeout(() => setStatus({ kind: "idle" }), 2200);
    return () => clearTimeout(timer);
  }, [status, setStatus]);
}

function StatusLine({ status, texts }: { status: Status; texts: UiStrings }) {
  if (status.kind === "error")
    return (
      <p className="error" role="alert">
        {status.text}
      </p>
    );
  return (
    <output className={`saved${status.kind === "saved" ? " on" : ""}`}>
      {status.kind === "saved" ? texts.saved : ""}
    </output>
  );
}

const errorText = (code: string | undefined, texts: UiStrings) =>
  code === "links_not_allowed"
    ? texts.noLinks
    : code === "rate_limited"
      ? texts.tooMany
      : code === "handle_taken"
        ? texts.handleTaken
        : code === "handle_reserved"
          ? texts.handleReserved
          : texts.failed;

/** Name, bio and country, saved together. The country names come from the server, so the list is
 *  the same in the page and in the browser. */
export function ProfileForm({
  own,
  texts,
  options,
}: {
  own: Own;
  texts: UiStrings;
  options: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(own.profile.displayName);
  const [bio, setBio] = useState(own.profile.bio ?? "");
  const [country, setCountry] = useState(own.profile.country ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useSaved(status, setStatus);
  const changed =
    name.trim() !== own.profile.displayName ||
    bio.trim() !== (own.profile.bio ?? "") ||
    country !== (own.profile.country ?? "");

  return (
    <form
      className="form fields"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus({ kind: "busy" });
        const saved = await send(
          "/me/profile",
          json("PATCH", { displayName: name, bio: bio.trim() || null, country: country || null }),
        );
        if (!saved.ok) return setStatus({ kind: "error", text: errorText(saved.body.code, texts) });
        setName(String(saved.body.displayName ?? name));
        setBio(String(saved.body.bio ?? ""));
        setStatus({ kind: "saved" });
        router.refresh();
      }}
    >
      <div className="field-group">
        <label htmlFor="name">{texts.displayName}</label>
        <input
          id="name"
          required
          maxLength={40}
          autoComplete="nickname"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field-group">
        <div className="label-row">
          <label htmlFor="bio">{texts.bio}</label>
          <span className={`counter${bio.length > 150 ? " near" : ""}`} aria-hidden="true">
            {bio.length}/160
          </span>
        </div>
        <textarea
          id="bio"
          rows={3}
          maxLength={160}
          placeholder={texts.bioPlaceholder}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
      </div>
      <div className="field-group">
        <label htmlFor="country">{texts.country}</label>
        <select id="country" value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">{texts.noCountry}</option>
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
      <div className="save-row">
        <StatusLine status={status} texts={texts} />
        <button type="submit" className="primary small" disabled={!changed || status.kind === "busy"}>
          {status.kind === "busy" ? texts.saving : texts.save}
        </button>
      </div>
    </form>
  );
}

const handlePattern = /^(?!\.)(?!.*\.\.)[a-z0-9_.]{3,20}(?<!\.)$/;

/** The handle, on its own: it changes once per 30 days. */
export function HandleForm({ own, texts }: { own: Own; texts: UiStrings }) {
  const router = useRouter();
  const [handle, setHandle] = useState(own.profile.handle);
  const [locked, setLocked] = useState(own.profile.handleChangeAt);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useSaved(status, setStatus);
  const wanted = handle.trim().replace(/^@/, "").toLowerCase();
  const until = locked && Date.parse(locked) > Date.now() ? locked : null;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(texts.language, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(iso),
    );

  return (
    <form
      className="form fields"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!handlePattern.test(wanted)) return setStatus({ kind: "error", text: texts.handleInvalid });
        setStatus({ kind: "busy" });
        const saved = await send("/me/handle", json("PATCH", { handle: wanted }));
        if (!saved.ok)
          return setStatus({
            kind: "error",
            text: saved.body.code === "bad_request" ? texts.handleInvalid : errorText(saved.body.code, texts),
          });
        setHandle(String(saved.body.handle));
        setLocked((saved.body.handleChangeAt as string | null) ?? null);
        setStatus({ kind: "saved" });
        router.refresh();
      }}
    >
      <div className="field-group">
        <label htmlFor="handle">{texts.handle}</label>
        <div className="field">
          <span className="at" aria-hidden="true">
            @
          </span>
          <input
            id="handle"
            autoCapitalize="none"
            autoComplete="username"
            spellCheck={false}
            maxLength={21}
            disabled={Boolean(until)}
            value={handle}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
            aria-describedby="handle-hint"
          />
        </div>
        <p id="handle-hint" className="meta hint-line">
          {until ? fill(texts.handleNextChange, { date: date(until) }) : texts.handleHint}
        </p>
      </div>
      {!until && (
        <div className="save-row">
          <StatusLine status={status} texts={texts} />
          <button
            type="submit"
            className="pill"
            disabled={wanted === own.profile.handle || status.kind === "busy"}
          >
            {status.kind === "busy" ? texts.saving : texts.changeHandle}
          </button>
        </div>
      )}
      {until && status.kind === "saved" && <StatusLine status={status} texts={texts} />}
    </form>
  );
}

const choices: Visibility[] = ["everyone", "friends", "nobody"];

/** One row per part of the profile, each a three-way switch, saved as soon as it moves. */
export function PrivacyForm({
  privacy: initial,
  texts,
  sections = privacySections,
}: {
  privacy: Privacy;
  texts: UiStrings;
  sections?: PrivacySection[];
}) {
  const [privacy, setPrivacy] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useSaved(status, setStatus);

  async function change(section: PrivacySection, value: Visibility) {
    const before = privacy;
    setPrivacy({ ...privacy, [section]: value });
    setStatus({ kind: "busy" });
    const saved = await send("/me/privacy", json("PATCH", { [section]: value }));
    if (!saved.ok) {
      setPrivacy(before);
      return setStatus({ kind: "error", text: errorText(saved.body.code, texts) });
    }
    setPrivacy(saved.body as unknown as Privacy);
    setStatus({ kind: "saved" });
  }

  return (
    <div className="privacy">
      {sections.map((section) => {
        const label = texts[`privacy_${section}`];
        // Older API answers have no gallery setting: friends, as the API defaults it.
        const index = choices.indexOf(privacy[section] ?? "friends");
        return (
          <fieldset key={section} className="privacy-row">
            <legend>{label}</legend>
            <div className="segmented" style={{ "--i": index } as CSSProperties}>
              <span className="thumb" aria-hidden="true" />
              {choices.map((choice) => (
                <label key={choice}>
                  <input
                    type="radio"
                    name={section}
                    value={choice}
                    checked={privacy[section] === choice}
                    onChange={() => change(section, choice)}
                  />
                  <span>
                    {choice === "nobody" && section === "search"
                      ? texts.vis_nobody_search
                      : texts[`vis_${choice}`]}
                  </span>
                </label>
              ))}
            </div>
            {section === "search" && <p className="meta hint-line">{texts.searchHint}</p>}
          </fieldset>
        );
      })}
      <div className="save-row">
        <StatusLine status={status} texts={texts} />
      </div>
    </div>
  );
}

const clientName = (client: string, texts: UiStrings) => {
  const key = `client_${client.replace(/-/g, "_")}` as keyof UiStrings;
  return typeof texts[key] === "string" ? (texts[key] as string) : client;
};

function DeviceIcon({ client }: { client: string }) {
  if (client === "phone")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </svg>
    );
  if (client === "web")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2.5 19.5h19" />
    </svg>
  );
}

/** Where the account is signed in: sign one out, or every other. */
export function SessionList({ sessions: initial, texts }: { sessions: SignedIn[]; texts: UiStrings }) {
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const others = sessions.filter((s) => !s.current);

  async function signOut(id: string) {
    setBusy(id);
    const done = await send(`/me/sessions/${id}`, { method: "DELETE" });
    setBusy(null);
    if (done.ok || done.status === 204) setSessions((list) => list.filter((s) => s.id !== id));
    else setNotice(texts.failed);
  }
  async function signOutOthers() {
    setBusy("others");
    const done = await send("/me/sessions", { method: "DELETE" });
    setBusy(null);
    if (!done.ok) return setNotice(texts.failed);
    setSessions((list) => list.filter((s) => s.current));
    setNotice(fill(texts.signedOutOthers, { n: Number(done.body.signedOut ?? others.length) }));
  }

  return (
    <>
      <ul className="people devices">
        {sessions.map((session) => (
          <li key={session.id} className="person">
            <span className="device-icon">
              <DeviceIcon client={session.client} />
            </span>
            <span className="lines">
              <span className="name">
                {session.deviceName || clientName(session.client, texts)}
                {session.current && <span className="tag here">{texts.thisDevice}</span>}
              </span>
              <span className="meta">
                {session.deviceName ? `${clientName(session.client, texts)} · ` : ""}
                {fill(texts.lastActive, {
                  when: ago(session.lastSeenAt ?? session.createdAt, texts.language),
                })}
              </span>
            </span>
            {!session.current && (
              <div className="acts">
                <button
                  type="button"
                  className="pill"
                  disabled={busy !== null}
                  onClick={() => signOut(session.id)}
                >
                  {texts.signOutDevice}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <div className="save-row">
          <span />
          <button type="button" className="pill danger" disabled={busy !== null} onClick={signOutOthers}>
            {texts.signOutOthers}
          </button>
        </div>
      ) : (
        <p className="hint empty">{notice ?? texts.onlyThisDevice}</p>
      )}
      {notice && others.length > 0 && <output className="notice">{notice}</output>}
    </>
  );
}

/** Asks for the mailed code (or the handle, for an account without email), then deletes. */
export function DeleteAccount({ own, texts }: { own: Own; texts: UiStrings }) {
  const [step, setStep] = useState<"idle" | "code" | "handle" | "done">("idle");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code" || step === "handle") field.current?.focus();
  }, [step]);

  async function start() {
    setBusy(true);
    setError(null);
    const asked = await send("/me/deletion", { method: "POST" });
    setBusy(false);
    if (!asked.ok) return setError(asked.body.code === "rate_limited" ? texts.tooMany : texts.failed);
    setValue("");
    setStep(asked.body.confirmWith === "handle" ? "handle" : "code");
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const done = await send("/me", json("DELETE", step === "code" ? { code: value } : { handle: value }));
    setBusy(false);
    if (!done.ok)
      return setError(
        done.body.code === "code_expired"
          ? texts.codeExpired
          : done.body.code === "code_invalid"
            ? texts.codeWrong
            : texts.failed,
      );
    setUntil(String(done.body.deleteAfter));
    setStep("done");
  }

  if (step === "done" && until)
    return (
      <div className="form">
        <output className="notice">
          {fill(texts.deleteScheduled, {
            date: new Intl.DateTimeFormat(texts.language, {
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date(until)),
          })}
        </output>
        <a className="pill" href="/">
          {texts.home}
        </a>
      </div>
    );

  if (step === "idle")
    return (
      <div className="form">
        <p className="hint">{texts.deleteLead}</p>
        <div className="save-row">
          <span />
          <button type="button" className="pill danger" disabled={busy} onClick={start}>
            {texts.deleteStart}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        confirm();
      }}
    >
      <p className="hint">
        {step === "code"
          ? fill(texts.deleteCodeSent, { email: own.account.email ?? "" })
          : fill(texts.deleteWithHandle, { handle: own.profile.handle })}
      </p>
      <input
        ref={field}
        className={step === "code" ? "code" : undefined}
        inputMode={step === "code" ? "numeric" : "text"}
        autoComplete="off"
        maxLength={step === "code" ? 6 : 21}
        placeholder={step === "code" ? "000000" : `@${own.profile.handle}`}
        value={value}
        onChange={(event) =>
          setValue(step === "code" ? event.target.value.replace(/\D/g, "") : event.target.value)
        }
        aria-label={texts.code}
      />
      <div className="save-row">
        <button type="button" className="quiet" disabled={busy} onClick={() => setStep("idle")}>
          {texts.cancel}
        </button>
        <button
          type="submit"
          className="pill danger solid"
          disabled={busy || (step === "code" ? value.length !== 6 : !value.trim())}
        >
          {texts.deleteConfirm}
        </button>
      </div>
      {step === "code" && (
        <button type="button" className="quiet left" disabled={busy} onClick={start}>
          {texts.sendAgain}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
