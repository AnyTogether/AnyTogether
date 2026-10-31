"use client";

import { Avatar } from "@/components/Avatar";
import type { UiStrings } from "@/lib/i18n";
import { rateLimitText } from "@/lib/rateLimit";
import { useRouter } from "next/navigation";
import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";

const maxBytes = 5 * 1024 * 1024;
const maxZoom = 4;

type Picked = { file: File; url: string; width: number; height: number };

/** The avatar: pick a PNG or JPEG, drag and zoom it under a round mask, and upload the square
 *  under the mask (the server cuts it out of the original, so nothing is lost to a canvas). The
 *  public picture by default; with kind "private", the friends-only one (same checks). */
export function AvatarEditor({
  person,
  texts,
  kind = "public",
  hint,
}: {
  person: { handle: string; displayName: string; avatar: string | null; privateAvatar?: string | null };
  texts: UiStrings;
  kind?: "public" | "private";
  hint?: string;
}) {
  const path = kind === "private" ? "/me/avatar/private" : "/me/avatar";
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [side, setSide] = useState(240);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState(kind === "private" ? (person.privateAvatar ?? null) : person.avatar);

  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);
  useEffect(() => {
    if (!picked || !stage.current) return;
    const measure = () => setSide(stage.current?.clientWidth ?? 240);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [picked]);

  const scale = picked ? (side / Math.min(picked.width, picked.height)) * zoom : 1;
  /** Keeps the picture covering the whole circle's square. */
  const clamp = (next: { x: number; y: number }, at = scale) => {
    if (!picked) return next;
    const spareX = Math.max(0, (picked.width * at - side) / 2);
    const spareY = Math.max(0, (picked.height * at - side) / 2);
    return {
      x: Math.min(spareX, Math.max(-spareX, next.x)),
      y: Math.min(spareY, Math.max(-spareY, next.y)),
    };
  };

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") return setError(texts.avatarWrongType);
    if (file.size > maxBytes) return setError(texts.avatarTooBig);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth < 32 || image.naturalHeight < 32) {
        URL.revokeObjectURL(url);
        return setError(texts.avatarBad);
      }
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setPicked({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError(texts.avatarBad);
    };
    image.src = url;
  }

  function onZoom(value: number) {
    const ratio = value / zoom;
    setZoom(value);
    setOffset((current) =>
      clamp(
        { x: current.x * ratio, y: current.y * ratio },
        picked ? (side / Math.min(picked.width, picked.height)) * value : 1,
      ),
    );
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start) return;
    setOffset(
      clamp({ x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y }),
    );
  }

  async function upload() {
    if (!picked) return;
    // The square under the mask, in the picture's own pixels.
    const size = Math.floor(side / scale);
    const left = Math.round(picked.width / 2 - (side / 2 + offset.x) / scale);
    const top = Math.round(picked.height / 2 - (side / 2 + offset.y) / scale);
    const fit = (value: number, total: number) => Math.min(Math.max(0, value), total - size);
    const query = `left=${fit(left, picked.width)}&top=${fit(top, picked.height)}&size=${size}`;
    setBusy(true);
    setError(null);
    const response = await fetch(`${path}?${query}`, {
      method: "PUT",
      headers: { "content-type": picked.file.type },
      body: picked.file,
    }).catch(() => undefined);
    setBusy(false);
    const result = (await response?.json().catch(() => ({}))) as {
      avatar?: string;
      privateAvatar?: string;
      code?: string;
      retryAfter?: number;
    };
    const uploaded = kind === "private" ? result.privateAvatar : result.avatar;
    if (!response?.ok || !uploaded) {
      setError(
        result.code === "payload_too_large"
          ? texts.avatarTooBig
          : result.code === "unsupported_media_type"
            ? texts.avatarWrongType
            : result.code === "rate_limited"
              ? rateLimitText(result.retryAfter, texts)
              : result.code === "bad_image"
                ? texts.avatarBad
                : texts.failed,
      );
      return;
    }
    setAvatar(uploaded);
    setPicked(null);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const response = await fetch(path, { method: "DELETE" }).catch(() => undefined);
    setBusy(false);
    if (!response?.ok) return setError(texts.failed);
    setAvatar(null);
    router.refresh();
  }

  const nudge = (dx: number, dy: number) =>
    setOffset((current) => clamp({ x: current.x + dx, y: current.y + dy }));

  return (
    <div className="avatar-edit">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {picked ? (
        <div className="crop">
          <button
            ref={stage}
            type="button"
            className="crop-stage"
            aria-label={texts.cropHint}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 24 : 6;
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [step, 0],
                ArrowRight: [-step, 0],
                ArrowUp: [0, step],
                ArrowDown: [0, -step],
              };
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              nudge(...move);
            }}
          >
            <img
              src={picked.url}
              alt=""
              draggable={false}
              style={
                {
                  width: picked.width * scale,
                  height: picked.height * scale,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                } as CSSProperties
              }
            />
            <span className="crop-mask" aria-hidden="true" />
          </button>
          <label className="zoom">
            <span>{texts.zoom}</span>
            <input
              type="range"
              min={1}
              max={maxZoom}
              step={0.01}
              value={zoom}
              onChange={(event) => onZoom(Number(event.target.value))}
            />
          </label>
          <p className="hint">{texts.cropHint}</p>
          <div className="row">
            <button type="button" className="pill" disabled={busy} onClick={() => setPicked(null)}>
              {texts.cancel}
            </button>
            <button type="button" className="primary small" disabled={busy} onClick={upload}>
              {busy ? texts.saving : texts.useAvatar}
            </button>
          </div>
        </div>
      ) : (
        <div className="current">
          {/* Only the picture this editor is for, never the other one. */}
          <Avatar person={{ handle: person.handle, displayName: person.displayName, avatar }} size={72} />
          <div className="lines">
            <div className="row start">
              <button type="button" className="pill" disabled={busy} onClick={() => input.current?.click()}>
                {texts.changeAvatar}
              </button>
              {avatar && (
                <button type="button" className="quiet" disabled={busy} onClick={remove}>
                  {texts.removeAvatar}
                </button>
              )}
            </div>
            <span className="meta">{hint ?? texts.avatarHint}</span>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
