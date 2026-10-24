"use client";

import { useState } from "react";

/** The code a launcher shows (K7QM-2XZP), approved for this account. */
export function LinkForm({
  initial,
  texts,
}: { initial: string; texts: { code: string; approve: string; approved: string; failed: string } }) {
  const [code, setCode] = useState(initial);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const shown = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const formatted = shown.length > 4 ? `${shown.slice(0, 4)}-${shown.slice(4)}` : shown;
  if (state === "done") return <p className="card success">{texts.approved}</p>;
  return (
    <form
      className="card form"
      onSubmit={async (event) => {
        event.preventDefault();
        setState("busy");
        setError(null);
        const response = await fetch("/auth/link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userCode: formatted }),
        });
        if (response.ok) return setState("done");
        setState("idle");
        setError((await response.json().catch(() => ({}))).title ?? texts.failed);
      }}
    >
      <label htmlFor="code">{texts.code}</label>
      <input
        id="code"
        className="code"
        autoComplete="off"
        autoCapitalize="characters"
        required
        value={formatted}
        onChange={(event) => setCode(event.target.value)}
        placeholder="XXXX-XXXX"
      />
      <button type="submit" className="primary" disabled={state === "busy" || shown.length !== 8}>
        {texts.approve}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
