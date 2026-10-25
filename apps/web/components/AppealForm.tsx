"use client";

import type { UiStrings } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Why a restriction should go, sent to the moderators: one appeal at a time. */
export function AppealForm({ restrictionId, texts }: { restrictionId: string; texts: UiStrings }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (text.trim().length < 10) return setError(texts.appealTooShort);
    setBusy(true);
    setError(null);
    const response = await fetch("/me/appeals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restrictionId, text: text.trim() }),
    }).catch(() => undefined);
    setBusy(false);
    if (response?.ok) {
      setSent(true);
      router.refresh();
      return;
    }
    const problem = (await response?.json().catch(() => ({}))) ?? {};
    setError(
      problem.code === "appeal_open"
        ? texts.appealAlreadyOpen
        : problem.code === "rate_limited"
          ? texts.tooMany
          : response?.status === 401
            ? texts.restrictedExpired
            : texts.failed,
    );
  }

  if (sent) return <output className="notice success">{texts.appealSent}</output>;
  return (
    <form
      className="appeal-form"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor={`appeal-${restrictionId}`}>{texts.appealTitle}</label>
      <p className="hint">{texts.appealLead}</p>
      <textarea
        id={`appeal-${restrictionId}`}
        rows={5}
        maxLength={2000}
        value={text}
        placeholder={texts.appealPlaceholder}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="appeal-row">
        <span className="meta">{text.trim().length} / 2000</span>
        <button type="submit" className="primary" disabled={busy || text.trim().length < 10}>
          {texts.appealSend}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
