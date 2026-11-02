"use client";

import { type ReactNode, useRef } from "react";

/** A small picture that opens large: the picture is a button, the large copy waits in a modal
 *  dialog (its file is only fetched when the dialog opens). Escape, the close button or a click
 *  beside the picture closes it. */
export function Zoom({
  label,
  close,
  caption,
  large,
  children,
}: {
  label: string;
  close: string;
  caption: string;
  /** The picture drawn large, at the screen's width. */
  large: ReactNode;
  /** The picture as it sits in the page. */
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="zoom-open"
        aria-label={label}
        onClick={() => dialog.current?.showModal()}
      >
        {children}
        <span className="zoom-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="ico">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </span>
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes a modal dialog natively */}
      <dialog
        ref={dialog}
        className="zoom"
        aria-label={caption}
        onClick={(event) => {
          // A click on the dialog itself (around the picture) closes it.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <figure className="zoom-figure">
          {large}
          <figcaption>{caption}</figcaption>
        </figure>
        <button type="button" className="zoom-close" onClick={() => dialog.current?.close()}>
          {close}
        </button>
      </dialog>
    </>
  );
}
