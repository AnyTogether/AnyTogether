"use client";

import { useState } from "react";

/** Copies a command or a checksum, and says so for a moment. `name` tells screen readers what is
 *  copied when the page has several such buttons. */
export function CopyButton({
  text,
  label,
  done,
  name,
}: { text: string; label: string; done: string; name?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`pill copy${copied ? " on" : ""}`}
      aria-label={copied ? done : (name ?? label)}
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
        {copied ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="8" y="8" width="12" height="12" rx="2.5" />
            <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
          </>
        )}
      </svg>
      <span>{copied ? done : label}</span>
    </button>
  );
}
