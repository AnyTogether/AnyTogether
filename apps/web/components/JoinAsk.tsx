"use client";

import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { social } from "@/lib/social";
import { useState } from "react";

/** Asks to join with a join code; the leader or host answers, and a yes arrives as an invite. */
export function JoinAsk({
  texts,
  code,
  host,
  asked: askedBefore,
}: {
  texts: UiStrings;
  code: string;
  host: string;
  asked: boolean;
}) {
  const [asked, setAsked] = useState(askedBefore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    const result = await social<{ code?: string }>(`join/${code}`, { method: "POST" });
    setBusy(false);
    if (result.ok) return setAsked(true);
    const why = result.body?.code;
    setError(
      why === "restricted_by_family"
        ? texts.joinFamily
        : why === "account_muted"
          ? texts.joinMuted
          : why === "full"
            ? texts.joinFull
            : result.status === 429
              ? texts.joinTooMany
              : result.status === 404
                ? texts.joinGone
                : texts.failed,
    );
  }

  if (asked) return <span aria-live="polite">{fill(texts.joinAsked, { name: host })}</span>;
  return (
    <>
      <button type="button" className="primary" disabled={busy} onClick={ask}>
        {texts.joinAsk}
      </button>
      {error && <p className="notice error">{error}</p>}
    </>
  );
}
