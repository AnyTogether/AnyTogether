"use client";

import { MediaTile, MediaViewer } from "@/components/Media";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type MediaItem, kindOfFile, posterOf, uploadMedia } from "@/lib/storage";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/** A profile's gallery: pinned screenshots and clips, opened full size. Its owner picks what is in
 *  it (and in what order) from what they keep, or uploads more. */
export function Gallery({
  items: initial,
  mine,
  max,
  name,
  texts,
}: {
  items: MediaItem[];
  mine: boolean;
  max: number;
  name: string;
  texts: UiStrings;
}) {
  const [items, setItems] = useState(initial);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const [opened, setOpened] = useState(0);
  const sheet = useRef<HTMLDialogElement>(null);

  return (
    <>
      {mine && (
        <button
          type="button"
          className="pill gallery-edit"
          onClick={() => {
            setOpened((n) => n + 1);
            sheet.current?.showModal();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16z" />
          </svg>
          {texts.editGallery}
        </button>
      )}
      {items.length === 0 ? (
        <p className="empty">
          {mine ? fill(texts.galleryEmptyMine, { max }) : fill(texts.galleryEmpty, { name })}
        </p>
      ) : (
        <ul className={`pin-grid count-${Math.min(items.length, 4)}`}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="gallery-cell"
                aria-label={texts[`kind_${item.kind}`]}
                onClick={() => setViewing(item)}
              >
                <MediaTile item={item} texts={texts} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <MediaViewer
        item={viewing}
        texts={texts}
        locale={texts.language}
        canReport={!mine}
        onClose={() => setViewing(null)}
      />
      {mine && (
        <GalleryPicker
          dialog={sheet}
          opened={opened}
          current={items}
          max={max}
          texts={texts}
          onSaved={setItems}
        />
      )}
    </>
  );
}

function GalleryPicker({
  dialog,
  opened,
  current,
  max,
  texts,
  onSaved,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  /** Goes up each time the sheet opens: what can be picked is fetched again. */
  opened: number;
  current: MediaItem[];
  max: number;
  texts: UiStrings;
  onSaved: (items: MediaItem[]) => void;
}) {
  const router = useRouter();
  const heading = useId();
  const [pool, setPool] = useState<MediaItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>(current.map((i) => i.id));
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = async () => {
    const response = await fetch("/me/storage/me/media").catch(() => undefined);
    const body = (await response?.json().catch(() => null)) as { media?: MediaItem[] } | null;
    setPool((body?.media ?? []).filter((m) => m.kind !== "voice" && !m.hidden));
    setPicked(current.map((i) => i.id));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetched each time the sheet opens
  useEffect(() => {
    if (opened > 0) load();
  }, [opened]);
  const toggle = (id: string) =>
    setPicked((all) =>
      all.includes(id) ? all.filter((x) => x !== id) : all.length >= max ? all : [...all, id],
    );

  return (
    <dialog
      ref={dialog}
      className="sheet gallery-sheet"
      aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === "Escape") dialog.current?.close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="sheet-body">
        <h3 id={heading}>{texts.gallery}</h3>
        <p className="hint">{fill(texts.galleryPick, { max })}</p>
        {pool === null ? (
          <div className="pick-grid loading" aria-busy="true" />
        ) : pool.length === 0 ? (
          <p className="empty">{texts.galleryNothing}</p>
        ) : (
          <ul className="pick-grid">
            {pool.map((item) => {
              const at = picked.indexOf(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`pick-cell${at >= 0 ? " on" : ""}`}
                    aria-pressed={at >= 0}
                    aria-label={texts[`kind_${item.kind}`]}
                    disabled={at < 0 && picked.length >= max}
                    onClick={() => toggle(item.id)}
                  >
                    <MediaTile item={item} texts={texts} />
                    <span className="pick-n" aria-hidden="true">
                      {at >= 0 ? at + 1 : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row spread">
          <span className="meta-mono">{fill(texts.galleryPicked, { n: picked.length, max })}</span>
          <input
            ref={picker}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,video/mp4"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              const kind = file ? kindOfFile(file) : null;
              if (!file || !kind) return setError(texts.notMedia);
              setBusy("upload");
              setError(null);
              const made = await uploadMedia(file, kind);
              const item = made.body.media;
              if (!made.ok || !item) {
                setBusy(null);
                return setError(made.body.code === "quota_exceeded" ? texts.quotaFull : texts.failed);
              }
              let shown = item;
              if (kind === "clip") {
                const poster = await posterOf(file);
                if (poster) {
                  const response = await fetch(`/me/upload/${item.id}/poster`, {
                    method: "PUT",
                    body: poster,
                  }).catch(() => undefined);
                  const body = (await response?.json().catch(() => null)) as { media?: MediaItem } | null;
                  if (body?.media) shown = body.media;
                }
              }
              setPool((all) => [shown, ...(all ?? [])]);
              setPicked((all) => (all.length >= max ? all : [...all, shown.id]));
              setBusy(null);
            }}
          />
          <button
            type="button"
            className="pill"
            disabled={busy !== null}
            onClick={() => picker.current?.click()}
          >
            {busy === "upload" ? `${texts.galleryUpload}…` : texts.galleryUpload}
          </button>
          <button
            type="button"
            className="pill solid"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("save");
              const response = await fetch("/me/storage/me/gallery", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ items: picked }),
              }).catch(() => undefined);
              const body = (await response?.json().catch(() => null)) as { items?: MediaItem[] } | null;
              setBusy(null);
              if (!response?.ok || !body?.items) return setError(texts.failed);
              onSaved(body.items);
              dialog.current?.close();
              router.refresh();
            }}
          >
            {texts.save}
          </button>
        </div>
      </div>
    </dialog>
  );
}
