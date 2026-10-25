"use client";

import { ReportSheet } from "@/components/ProfileMenu";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type Attachment,
  type MediaItem,
  formatBytes,
  formatDuration,
  isShown,
  voiceFormat,
  waveform,
} from "@/lib/storage";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

/** How a picture or clip sits in a bubble or a grid: its own shape, within bounds. */
const ratioOf = (item: { width: number | null; height: number | null }) =>
  item.width && item.height ? Math.min(2.2, Math.max(0.5, item.width / item.height)) : 16 / 9;

/** One attachment in a message: a picture to open, a clip to play, a voice note, or why it is gone. */
export function AttachmentView({
  attachment,
  texts,
  mine,
  onOpen,
  onExpired,
}: {
  attachment: Attachment;
  texts: UiStrings;
  mine: boolean;
  onOpen: (item: MediaItem) => void;
  onExpired?: () => void;
}) {
  if (!isShown(attachment))
    return (
      <div className="media-gone">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
          {"blocked" in attachment ? (
            <path d="M5.6 5.6l12.8 12.8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
          ) : (
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
          )}
        </svg>
        <span>
          {texts[`kind_${attachment.kind}`]} ·{" "}
          {"blocked" in attachment ? texts.mediaBlocked : texts.mediaRemoved}
        </span>
      </div>
    );
  if (attachment.kind === "voice")
    return <VoicePlayer item={attachment} texts={texts} mine={mine} onExpired={onExpired} />;
  if (attachment.kind === "clip")
    return (
      <div className="media-frame clip" style={{ "--ratio": ratioOf(attachment) } as CSSProperties}>
        {/* biome-ignore lint/a11y/useMediaCaption: players' own clips have no captions */}
        <video
          src={attachment.url}
          poster={attachment.poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          onError={onExpired}
        />
      </div>
    );
  return (
    <button
      type="button"
      className="media-frame image"
      style={{ "--ratio": ratioOf(attachment) } as CSSProperties}
      aria-label={texts.openPhoto}
      onClick={() => onOpen(attachment)}
    >
      <img
        src={attachment.thumb ?? attachment.url}
        alt=""
        width={attachment.width ?? undefined}
        height={attachment.height ?? undefined}
        loading="lazy"
        decoding="async"
        onError={onExpired}
      />
    </button>
  );
}

/** A voice note: play and pause, its length, and a picture of it that fills as it plays (and
 *  seeks where it is clicked). */
export function VoicePlayer({
  item,
  texts,
  mine,
  onExpired,
}: {
  item: MediaItem;
  texts: UiStrings;
  mine?: boolean;
  onExpired?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const bars = waveform(item.id);
  const length = (item.durationMs ?? 0) / 1000;
  const progress = length > 0 ? Math.min(1, at / length) : 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    let frame = 0;
    const tick = () => {
      setAt(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    const play = () => {
      setPlaying(true);
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
    };
    const end = () => {
      stop();
      setAt(0);
    };
    el.addEventListener("play", play);
    el.addEventListener("pause", stop);
    el.addEventListener("ended", end);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("play", play);
      el.removeEventListener("pause", stop);
      el.removeEventListener("ended", end);
    };
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      // One voice note at a time on the page.
      for (const other of document.querySelectorAll<HTMLAudioElement>("audio.voice-audio"))
        if (other !== el) other.pause();
      el.play().catch(() => onExpired?.());
    } else el.pause();
  };

  return (
    <div className={`voice${mine ? " mine" : ""}${playing ? " playing" : ""}`}>
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? texts.pauseVoice : texts.playVoice}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {playing ? <path d="M8 5.5h2.6v13H8zM13.4 5.5H16v13h-2.6z" /> : <path d="M8.5 5.8v12.4L18.5 12z" />}
        </svg>
      </button>
      <span
        className="voice-wave"
        role="slider"
        tabIndex={0}
        aria-label={texts.kind_voice}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(at)}
        onClick={(event) => {
          const el = audio.current;
          if (!el || !length) return;
          const box = event.currentTarget.getBoundingClientRect();
          el.currentTime = Math.max(0, Math.min(length, ((event.clientX - box.left) / box.width) * length));
          setAt(el.currentTime);
        }}
        onKeyDown={(event) => {
          const el = audio.current;
          if (!el || !length) return;
          if (event.key === "ArrowRight") el.currentTime = Math.min(length, el.currentTime + 5);
          else if (event.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 5);
          else if (event.key === " " || event.key === "Enter") toggle();
          else return;
          event.preventDefault();
          setAt(el.currentTime);
        }}
      >
        {bars.map((height, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: the bars never move
            key={i}
            className={i / bars.length < progress ? "on" : undefined}
            style={{ "--h": height } as CSSProperties}
          />
        ))}
      </span>
      <span className="voice-time">{formatDuration(playing || at > 0 ? at * 1000 : item.durationMs)}</span>
      {/* biome-ignore lint/a11y/useMediaCaption: a voice note has no captions */}
      <audio ref={audio} className="voice-audio" src={item.url} preload="none" onError={onExpired} />
    </div>
  );
}

/** A picture or clip filling the screen, with its size, a download and (for someone else's) a
 *  report button. Closed by Escape, the ×, or a click beside it. */
export function MediaViewer({
  item,
  texts,
  locale,
  canReport,
  onClose,
}: {
  item: MediaItem | null;
  texts: UiStrings;
  locale: string;
  canReport: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const report = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (item && !el.open) el.showModal();
    if (!item && el.open) el.close();
  }, [item]);

  return (
    <>
      <dialog
        ref={dialog}
        className="viewer"
        aria-label={item ? texts[`kind_${item.kind}`] : undefined}
        onClose={onClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") dialog.current?.close();
        }}
        onClick={(event) => {
          if (
            event.target === event.currentTarget ||
            (event.target as HTMLElement).classList.contains("viewer-stage")
          )
            dialog.current?.close();
        }}
      >
        {item && (
          <>
            <div className="viewer-stage">
              {item.kind === "voice" ? (
                <div className="viewer-voice">
                  <VoicePlayer item={item} texts={texts} />
                </div>
              ) : item.kind === "clip" ? (
                // biome-ignore lint/a11y/useMediaCaption: players' own clips have no captions
                <video src={item.url} poster={item.poster ?? undefined} controls autoPlay playsInline />
              ) : (
                <img
                  src={item.url}
                  alt=""
                  width={item.width ?? undefined}
                  height={item.height ?? undefined}
                />
              )}
            </div>
            <div className="viewer-bar">
              <span className="viewer-meta">
                {texts[`kind_${item.kind}`]}
                {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                {item.kind === "clip" && item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ""}
                {` · ${formatBytes(item.size, locale)}`}
              </span>
              <a className="pill" href={item.url} download>
                <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                  <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
                </svg>
                {texts.saveMedia}
              </a>
              {canReport && (
                <button type="button" className="pill danger" onClick={() => report.current?.showModal()}>
                  {texts.reportMedia}
                </button>
              )}
              <button
                type="button"
                className="pill icon viewer-close"
                aria-label={texts.closeViewer}
                onClick={() => dialog.current?.close()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </>
        )}
      </dialog>
      {item && canReport && (
        <ReportSheet
          dialog={report}
          person={{ userId: item.id, displayName: "" }}
          texts={texts}
          kind="media"
          title={fill(texts.reportMediaTitle, { kind: texts[`kind_${item.kind}`].toLowerCase() })}
          lead={texts.reportMediaLead}
        />
      )}
    </>
  );
}

type Recording = { blob: Blob; durationMs: number };

/** Records a voice note with the microphone: up to a minute, a level meter while it listens, then
 *  send or discard. */
export function VoiceRecorder({
  texts,
  maxMs,
  onSend,
  onCancel,
  onError,
}: {
  texts: UiStrings;
  maxMs: number;
  onSend: (recording: Recording) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const wanted = useRef<"send" | "cancel">("cancel");
  const done = useRef(onSend);
  done.current = onSend;

  const stop = useCallback((how: "send" | "cancel") => {
    wanted.current = how;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: starts once, when the recorder opens
  useEffect(() => {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let cancelled = false;
    const type =
      typeof MediaRecorder === "undefined" ? null : voiceFormat((t) => MediaRecorder.isTypeSupported(t));
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      onError(texts.noRecorder);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((media) => {
        if (cancelled) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream = media;
        const chunks: Blob[] = [];
        const rec = new MediaRecorder(media, { mimeType: type, audioBitsPerSecond: 32_000 });
        recorder.current = rec;
        rec.ondataavailable = (event) => event.data.size && chunks.push(event.data);
        rec.onstop = () => {
          const durationMs = Date.now() - started.current;
          for (const track of media.getTracks()) track.stop();
          if (wanted.current === "send" && durationMs > 400)
            done.current({
              blob: new Blob(chunks, { type: type.split(";")[0] }),
              durationMs: Math.min(durationMs, maxMs),
            });
          else onCancel();
        };
        // A level meter, so it is clear the microphone hears something.
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        started.current = Date.now();
        rec.start(250);
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let peak = 0;
          for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
          setLevel(peak / 128);
          const ms = Date.now() - started.current;
          setElapsed(ms);
          if (ms >= maxMs) stop("send");
          else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      })
      .catch(() => onError(texts.micDenied));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (recorder.current?.state === "recording") {
        wanted.current = "cancel";
        recorder.current.stop();
      }
      for (const track of stream?.getTracks() ?? []) track.stop();
      context?.close().catch(() => {});
    };
  }, []);

  return (
    <div className="recorder">
      <button
        type="button"
        className="pill icon"
        aria-label={texts.discardVoice}
        onClick={() => stop("cancel")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
        </svg>
      </button>
      <span className="rec-dot" aria-hidden="true" style={{ "--level": level } as CSSProperties} />
      <span className="rec-time" aria-live="off">
        {formatDuration(elapsed)} <span className="rec-max">/ {formatDuration(maxMs)}</span>
      </span>
      <span className="rec-track" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (elapsed / maxMs) * 100)}%` }} />
      </span>
      <button
        type="button"
        className="primary send"
        aria-label={texts.sendVoice}
        onClick={() => stop("send")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
          <path d="M5 12h13M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

/** A square of media for grids (Settings, the gallery): the picture, the clip's poster, or a voice
 *  note's wave, with its length. */
export function MediaTile({ item, texts }: { item: MediaItem; texts: UiStrings }) {
  const still = item.kind === "image" ? (item.thumb ?? item.url) : item.kind === "clip" ? item.poster : null;
  return (
    <span className={`tile-media ${item.kind}`}>
      {still ? (
        <img src={still} alt="" loading="lazy" decoding="async" />
      ) : item.kind === "clip" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M10 9.5v5l4.5-2.5z" />
        </svg>
      ) : (
        <span className="tile-wave" aria-hidden="true">
          {waveform(item.id, 14).map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the bars never move
            <i key={i} style={{ "--h": h } as CSSProperties} />
          ))}
        </span>
      )}
      {item.kind !== "image" && (
        <span className="tile-badge">
          {item.kind === "clip" && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 5.8v12.4L18.5 12z" />
            </svg>
          )}
          {item.durationMs ? formatDuration(item.durationMs) : texts[`kind_${item.kind}`]}
        </span>
      )}
    </span>
  );
}
