"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FilmStrings = {
  label: string;
  play: string;
  pause: string;
  soundOn: string;
  soundOff: string;
  watch: string;
};

const base = "/media/anyps5-promo";

/** The AnyPS5 film. Nothing of it is fetched until it comes near the screen (the picture under it
 *  is a lazy image, the video gets its sources only then); it plays silently while it is on screen
 *  and stops when it leaves. Sound is one press away. With reduced motion it waits for a press of
 *  its play button instead of starting by itself. */
export function PromoFilm({ t }: { t: FilmStrings }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [poster, setPoster] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [still, setStill] = useState(false);
  const [started, setStarted] = useState(false);
  // Pressed play (needed with reduced motion), pressed pause (stays paused until play again).
  const wanted = useRef({ started: false, paused: false, visible: false });

  const tryPlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.play().catch(() => setPlaying(false));
  }, []);

  useEffect(() => {
    // React does not always carry the muted attribute over from the server's HTML; a browser only
    // starts a video by itself when it is muted.
    if (video.current) video.current.muted = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduce.matches);
    const changed = () => setStill(reduce.matches);
    reduce.addEventListener("change", changed);
    return () => reduce.removeEventListener("change", changed);
  }, []);

  // Fetch it a little before it is seen.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    setPoster(picture.current?.currentSrc || `${base}-1920.webp`);
    video.current?.load();
  }, [near]);

  // Play while on screen, stop when it leaves.
  useEffect(() => {
    const el = frame.current;
    const v = video.current;
    if (!el || !v || !near) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        wanted.current.visible = Boolean(entry?.isIntersecting);
        const w = wanted.current;
        if (w.visible && !w.paused && (!still || w.started)) tryPlay();
        else if (!w.visible) v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, still, tryPlay]);

  // The thin line along the bottom: how far into the film.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const v = video.current;
      if (v && bar.current && v.duration)
        bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const start = () => {
    wanted.current.started = true;
    wanted.current.paused = false;
    setStarted(true);
    setNear(true);
    tryPlay();
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) start();
    else {
      wanted.current.paused = true;
      v.pause();
    }
  };

  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted && v.paused) start();
  };

  const waiting = still && !started && !playing;

  return (
    <div className={`film-frame${playing ? " is-playing" : ""}`} ref={frame}>
      <img
        ref={picture}
        className="film-poster"
        src={`${base}-960.webp`}
        srcSet={`${base}-960.webp 960w, ${base}-1920.webp 1920w`}
        sizes="(max-width: 1232px) calc(100vw - 32px), 1200px"
        width={1920}
        height={1080}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <video
        ref={video}
        className="film-video"
        aria-label={t.label}
        muted
        loop
        playsInline
        preload={near ? "metadata" : "none"}
        poster={poster}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
      >
        {near && <source src={`${base}.webm`} type='video/webm; codecs="vp9, opus"' />}
        {near && <source src={`${base}.mp4`} type='video/mp4; codecs="avc1.64002A, mp4a.40.2"' />}
      </video>

      {waiting && (
        <button type="button" className="film-start" onClick={start}>
          <span className="film-start-disc">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" />
            </svg>
          </span>
          <span>{t.watch}</span>
        </button>
      )}

      <div className="film-controls">
        {!waiting && (
          <button
            type="button"
            className="film-btn"
            onClick={togglePlay}
            aria-label={playing ? t.pause : t.play}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {playing ? <path d="M8 5v14M16 5v14" /> : <path d="M8 5.5v13l10.5-6.5z" className="fill" />}
            </svg>
          </button>
        )}
        <button
          type="button"
          className="film-btn film-sound"
          onClick={toggleSound}
          aria-label={muted ? t.soundOn : t.soundOff}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" className="fill" />
            {muted ? (
              <path d="M16 9.5l5 5M21 9.5l-5 5" />
            ) : (
              <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
            )}
          </svg>
          <span>{muted ? t.soundOn : t.soundOff}</span>
        </button>
      </div>
      <span className="film-progress" aria-hidden="true">
        <span ref={bar} />
      </span>
    </div>
  );
}
