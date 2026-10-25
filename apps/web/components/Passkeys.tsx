"use client";

import { ago } from "@/lib/games";
import type { Strings, UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface PasskeyRow {
  id: string;
  name: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

type SignInTexts = Pick<
  Strings,
  "passkeySignIn" | "passkeyHint" | "passkeyUnknown" | "passkeyExpired" | "passkeyBanned" | "failed"
>;

/** The user closed the browser's sheet, or a newer request replaced this one: nothing to say. */
const quietError = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="key-icon">
      <circle cx="8" cy="8.5" r="4.5" />
      <path d="M11.3 11.6 20 20.3M16.6 16.9l2.2-2.2M14.2 14.5l1.8-1.8" />
      <circle cx="7.4" cy="7.9" r="1.1" />
    </svg>
  );
}

/** "Sign in with a passkey": a button, and where the browser can, the passkeys offered right in the
 *  email field's autofill (conditional UI), so a returning user taps once and types nothing. */
export function PasskeySignIn({
  texts,
  next,
  autofill = false,
}: { texts: SignInTexts; next?: string; autofill?: boolean }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autofilling = useRef(false);
  /** Each request gets a number; one replaced by a newer request ends without a word. */
  const generation = useRef(0);

  /** One ceremony: true once signed in, false when the server refused, null when it never asked. */
  async function signIn(conditional: boolean): Promise<boolean | null> {
    const started = await fetch("/auth/passkey/start", { method: "POST" }).catch(() => undefined);
    if (!started?.ok) {
      if (!conditional) setError(texts.failed);
      return null;
    }
    const { challengeId, options } = await started.json();
    const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: conditional });
    setBusy(true);
    setError(null);
    const finished = await fetch("/auth/passkey/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, response }),
    }).catch(() => undefined);
    if (finished?.ok) {
      if (next) router.push(next);
      router.refresh();
      return true;
    }
    setBusy(false);
    const problem = (await finished?.json().catch(() => ({}))) ?? {};
    // Banned: why, and the appeal, are on /restricted (the appeal token is in its cookie now).
    if (problem.code === "account_banned" && problem.restriction) {
      router.push("/restricted");
      return false;
    }
    setError(
      problem.code === "passkey_invalid"
        ? texts.passkeyUnknown
        : problem.code === "challenge_expired"
          ? texts.passkeyExpired
          : problem.code === "account_banned"
            ? texts.passkeyBanned
            : (problem.title ?? texts.failed),
    );
    return false;
  }

  /** A quiet request the email field's autofill answers. It is renewed before its challenge's five
   *  minutes end, and after the server refused one (an unknown key, say) the field keeps offering
   *  passkeys. */
  function listen() {
    if (!autofilling.current) return;
    const mine = ++generation.current;
    signIn(true)
      .catch((caught) => {
        // Replaced or closed: quiet. Either way the next renewal asks again.
        if (!quietError(caught)) console.warn("passkey autofill", caught);
        return null;
      })
      .then((done) => {
        if (done === false && mine === generation.current) setTimeout(listen, 1000);
      });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: started once, on the first render.
  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    setSupported(true);
    let renew: ReturnType<typeof setInterval> | undefined;
    if (autofill)
      browserSupportsWebAuthnAutofill().then((can) => {
        if (!can) return;
        autofilling.current = true;
        listen();
        renew = setInterval(listen, 240_000);
      });
    return () => {
      autofilling.current = false;
      generation.current++;
      if (renew) clearInterval(renew);
    };
  }, []);

  async function tapped() {
    // The button's request replaces the quiet one; that one comes back if this one is closed.
    generation.current++;
    setError(null);
    const done = await signIn(false).catch((caught) => {
      setBusy(false);
      if (!quietError(caught)) setError(texts.failed);
      return null;
    });
    if (!done) listen();
  }

  if (!supported) return null;
  return (
    <div className="passkey-sign-in">
      <button type="button" className="passkey-button" disabled={busy} onClick={tapped}>
        <KeyIcon />
        {texts.passkeySignIn}
      </button>
      <p className="meta passkey-hint">{texts.passkeyHint}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A name for a new passkey from the device it is made on; the user can change it. */
function guessName() {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return "iPhone";
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(agent)) return "Mac";
  if (/Android/.test(agent)) return "Android";
  if (/Windows/.test(agent)) return "Windows";
  if (/CrOS/.test(agent)) return "Chromebook";
  if (/Linux/.test(agent)) return "Linux";
  return "Passkey";
}

const date = (iso: string, language: string) =>
  new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

/** Settings: the account's passkeys, a new one named and added, an old one removed. */
export function PasskeyList({
  passkeys: initial,
  max,
  texts,
}: { passkeys: PasskeyRow[]; max: number; texts: UiStrings }) {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState(initial);
  const [name, setName] = useState("");
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const full = passkeys.length >= max;

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    setName(guessName());
  }, []);

  async function add() {
    setBusy("add");
    setNotice(null);
    try {
      const started = await fetch("/me/passkeys/start", { method: "POST" });
      const options = await started.json();
      if (!started.ok)
        return setNotice({
          kind: "error",
          text:
            options.code === "full"
              ? texts.passkeysFull
              : options.code === "rate_limited"
                ? texts.tooMany
                : texts.failed,
        });
      const response = await startRegistration({ optionsJSON: options });
      const saved = await fetch("/me/passkeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || guessName(), response }),
      });
      const body = await saved.json().catch(() => ({}));
      if (!saved.ok)
        return setNotice({
          kind: "error",
          text:
            body.code === "conflict"
              ? texts.passkeyExists
              : body.code === "full"
                ? texts.passkeysFull
                : texts.failed,
        });
      setPasskeys((list) => [...list, body as PasskeyRow]);
      setName(guessName());
      setNotice({ kind: "success", text: fill(texts.passkeyAddedNotice, { name: body.name }) });
      router.refresh();
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
        setNotice({ kind: "error", text: texts.passkeyExists });
      else if (!quietError(caught)) setNotice({ kind: "error", text: texts.failed });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    const done = await fetch(`/me/passkeys/${id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(null);
    setAsking(null);
    if (!done || (!done.ok && done.status !== 404)) return setNotice({ kind: "error", text: texts.failed });
    setPasskeys((list) => list.filter((p) => p.id !== id));
    setNotice(null);
    router.refresh();
  }

  return (
    <>
      {passkeys.length > 0 ? (
        <ul className="people devices passkeys">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="person">
              <span className="device-icon">
                <KeyIcon />
              </span>
              <span className="lines">
                <span className="name">
                  <span className="label">{passkey.name}</span>
                  {passkey.backedUp && <span className="tag synced">{texts.passkeySynced}</span>}
                </span>
                <span className="meta">
                  {fill(texts.passkeyAdded, { date: date(passkey.createdAt, texts.language) })} ·{" "}
                  {passkey.lastUsedAt
                    ? fill(texts.passkeyUsed, { when: ago(passkey.lastUsedAt, texts.language) })
                    : texts.passkeyNeverUsed}
                </span>
              </span>
              <div className="acts">
                {asking === passkey.id ? (
                  <>
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy !== null}
                      onClick={() => setAsking(null)}
                    >
                      {texts.keep}
                    </button>
                    <button
                      type="button"
                      className="pill danger"
                      disabled={busy !== null}
                      onClick={() => remove(passkey.id)}
                      aria-label={fill(texts.removePasskey, { name: passkey.name })}
                    >
                      {texts.passkeyRemove}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="pill"
                    disabled={busy !== null}
                    onClick={() => setAsking(passkey.id)}
                    aria-label={fill(texts.removePasskey, { name: passkey.name })}
                  >
                    {texts.passkeyRemove}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint empty">{texts.noPasskeys}</p>
      )}
      {asking && <p className="meta hint-line passkey-warning">{texts.removePasskeyHint}</p>}

      {!supported ? (
        <p className="hint passkey-add">{texts.passkeyUnsupported}</p>
      ) : full ? (
        <p className="hint passkey-add">{texts.passkeysFull}</p>
      ) : (
        <form
          className="passkey-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="field-group">
            <label htmlFor="passkey-name">{texts.passkeyName}</label>
            <div className="add-row">
              <input
                id="passkey-name"
                maxLength={60}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className="primary small" disabled={busy !== null || !name.trim()}>
                {busy === "add" ? texts.passkeyAdding : texts.addPasskey}
              </button>
            </div>
          </div>
        </form>
      )}
      {notice && (
        <output className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : undefined}>
          {notice.text}
        </output>
      )}
    </>
  );
}
