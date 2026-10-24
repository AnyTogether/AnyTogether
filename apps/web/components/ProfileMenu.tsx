"use client";

import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { useEffect, useRef, useState } from "react";

const reasons = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "impersonation",
  "cheating",
  "piracy",
  "other",
] as const;

/** The ⋯ on someone's profile card; for now it holds "Report", which opens the report sheet. */
export function ProfileMenu({
  person,
  texts,
}: {
  person: { userId: string; displayName: string };
  texts: UiStrings;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu card-menu" ref={box}>
      <button
        type="button"
        className="pill icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={texts.moreActions}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="pop" role="menu">
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              dialog.current?.showModal();
            }}
          >
            {texts.report}
          </button>
        </div>
      )}
      <ReportSheet dialog={dialog} person={person} texts={texts} />
    </div>
  );
}

function ReportSheet({
  dialog,
  person,
  texts,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  person: { userId: string; displayName: string };
  texts: UiStrings;
}) {
  const [reason, setReason] = useState<(typeof reasons)[number] | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    dialog.current?.close();
    if (state === "sent") {
      setState("idle");
      setReason(null);
      setNote("");
    }
  };

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby="report-title"
      onClick={(event) => {
        // A tap on the dimmed backdrop closes it.
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <div className="sheet-body">
        <h3 id="report-title">{fill(texts.reportTitle, { name: person.displayName })}</h3>
        {state === "sent" ? (
          <>
            <p className="notice success">{texts.reportSent}</p>
            <div className="row">
              <button type="button" className="pill" onClick={close}>
                {texts.done}
              </button>
            </div>
          </>
        ) : (
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!reason) return;
              setState("busy");
              setError(null);
              const response = await fetch("/reports", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  targetKind: "user",
                  targetId: person.userId,
                  reason,
                  ...(note.trim() ? { note: note.trim() } : {}),
                }),
              }).catch(() => undefined);
              if (response?.ok) return setState("sent");
              setState("idle");
              setError(response?.status === 429 ? texts.tooMany : texts.failed);
            }}
          >
            <p className="hint">{fill(texts.reportLead, { name: person.displayName })}</p>
            <fieldset className="reasons">
              <legend className="visually-hidden">{texts.report}</legend>
              {reasons.map((value) => (
                <label key={value} className={reason === value ? "on" : undefined}>
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                  />
                  <span>{texts[`reason_${value}`]}</span>
                </label>
              ))}
            </fieldset>
            <textarea
              rows={2}
              maxLength={500}
              placeholder={texts.reportNote}
              aria-label={texts.reportNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button type="button" className="pill" onClick={close}>
                {texts.cancel}
              </button>
              <button type="submit" className="pill danger solid" disabled={!reason || state === "busy"}>
                {texts.sendReport}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
