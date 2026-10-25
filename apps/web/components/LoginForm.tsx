"use client";

import type { Strings } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Texts = Pick<Strings, "email" | "sendCode" | "codeSent" | "code" | "verify" | "otherEmail" | "failed">;

/** Email, then the 6-digit code from the mail. */
export function LoginForm({ texts, next }: { texts: Texts; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (response.ok) return response;
    const problem = await response.json().catch(() => ({}));
    // A banned address still gets its code: signing in with it shows why, and how to appeal.
    if (problem.code === "account_banned" && problem.codeSent) return response;
    if (problem.code === "account_banned" && path === "/auth/email/verify") {
      router.push("/restricted");
      return null;
    }
    setError(problem.title ?? texts.failed);
    return null;
  }

  if (!sent) {
    return (
      <form
        className="card form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await post("/auth/email/start", { email })) setSent(true);
        }}
      >
        <label htmlFor="email">{texts.email}</label>
        <input
          id="email"
          type="email"
          // "webauthn" lets the browser offer passkeys in this field's autofill.
          autoComplete="email webauthn"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" className="primary" disabled={busy}>
          {texts.sendCode}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }
  return (
    <form
      className="card form"
      onSubmit={async (event) => {
        event.preventDefault();
        const verified = await post("/auth/email/verify", { email, code });
        if (verified) {
          router.push(next);
          router.refresh();
        }
      }}
    >
      <p className="hint">
        {texts.codeSent} <b>{email}</b>
      </p>
      <label htmlFor="code">{texts.code}</label>
      <input
        id="code"
        className="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        placeholder="000000"
      />
      <button type="submit" className="primary" disabled={busy || code.length !== 6}>
        {texts.verify}
      </button>
      <button
        type="button"
        className="quiet"
        onClick={() => {
          setSent(false);
          setCode("");
        }}
      >
        {texts.otherEmail}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
