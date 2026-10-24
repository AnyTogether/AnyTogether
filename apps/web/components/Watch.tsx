"use client";

import { Avatar } from "@/components/Avatar";
import { useLive, useLiveEvents } from "@/components/Live";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type PadOutput,
  type PadState,
  type SharePlay,
  type SharePlayJoin,
  encodePad,
  mergePads,
  nowMicros,
  padFromGamepad,
  padFromKeys,
  padKeys,
  randomSession,
  restingPad,
  samePad,
} from "@/lib/share";
import { type AudioStats, ShareAudio } from "@/lib/shareAudio";
import { type LinkState, type LinkStats, ShareConnection, type ShareSignal } from "@/lib/shareConnection";
import { social } from "@/lib/social";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "joining" | "watching" | "ended" | "removed" | "gone" | "full" | "ask" | "asked";
type Quality = "good" | "ok" | "poor";

/** Pad packets this often while the viewer holds a pad, and at once on every change. */
const padEveryMs = 1000 / 120;

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The first controller the browser sees (it shows one only after a button was pressed). */
function firstGamepad() {
  const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  for (const pad of pads) if (pad?.connected) return pad;
  return null;
}

function quality(stats: LinkStats): Quality {
  const rtt = stats.rttMs ?? 0;
  if (rtt > 200 || stats.lossRate > 0.08 || (stats.fps !== null && stats.fps < 24)) return "poor";
  if (rtt > 90 || stats.lossRate > 0.02 || (stats.fps !== null && stats.fps < 48)) return "ok";
  return "good";
}

/** Watching a friend's share play: their game's picture and sound, straight from their launcher
 *  over WebRTC; with a pad from the host, this browser's controller or keyboard plays along. */
export function Watch({ texts, initial, id }: { texts: UiStrings; initial: SharePlay | null; id: string }) {
  const { me, session, status, send } = useLive();
  const [share, setShare] = useState<SharePlay | null>(initial);
  const [phase, setPhase] = useState<Phase>(initial ? "joining" : "gone");
  const [link, setLink] = useState<LinkState>("waiting");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [audioStats, setAudioStats] = useState<AudioStats | null>(null);
  const [audioOut, setAudioOut] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [details, setDetails] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [gamepad, setGamepad] = useState<string | null>(null);
  const [touchOnly, setTouchOnly] = useState(false);
  const [light, setLight] = useState<string | null>(null);
  const [padRtt, setPadRtt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  /** The first frame was drawn: until then the veil stays up. */
  const [picture, setPicture] = useState(false);

  const conn = useRef<ShareConnection | null>(null);
  const audio = useRef<ShareAudio | null>(null);
  const pending = useRef<ShareSignal[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const keys = useRef(new Set<string>());
  const sequence = useRef(0);
  const padSession = useRef<bigint>(0n);
  const lastPad = useRef<PadState>(restingPad());
  const shareRef = useRef(share);
  shareRef.current = share;
  const joinedOnce = useRef(false);
  const rumble = useRef({ large: 0, small: 0, at: 0 });

  const host = share?.host ?? null;
  const hostName = host?.displayName ?? "?";
  const game = share?.title ?? share?.titleId ?? "";
  const slot = share?.viewers.find((viewer) => viewer.user.userId === me)?.slot ?? null;
  const slotRef = useRef(slot);
  slotRef.current = slot;

  const signal = useCallback(
    (device: string, kind: string, data: unknown) => {
      const current = shareRef.current;
      if (!current?.host) return false;
      return send({ op: "signal", to: current.host.userId, device, share: current.id, kind, data });
    },
    [send],
  );

  const finish = useCallback((next: Phase, sayBye: boolean) => {
    conn.current?.close(sayBye);
    conn.current = null;
    audio.current?.close();
    audio.current = null;
    setStream(null);
    setPhase(next);
  }, []);

  /** Joins (again, after the socket came back: the seat moves to this device and keeps its pad). */
  const join = useCallback(async () => {
    const joined = await social<SharePlayJoin & { join?: string }>(`share-plays/${id}/join`, {
      method: "POST",
    });
    if (!joined.ok || !joined.body) {
      if (!joined.status) return;
      // A public share play that takes requests: ask the host first.
      if (joined.status === 403 && joined.body?.join === "request") return finish("ask", false);
      finish(joined.status === 409 ? "full" : "gone", false);
      return;
    }
    const { sharePlay, iceServers } = joined.body;
    setShare(sharePlay);
    shareRef.current = sharePlay;
    setPhase("watching");
    if (conn.current) {
      conn.current.setIceServers(iceServers);
      if (conn.current.state !== "connected") conn.current.askAgain();
      return;
    }
    if (!sharePlay.host) return;
    audio.current ??= new ShareAudio();
    // The browser may already let the page play sound (the user clicked their way here).
    audio.current.start().then(() => setSoundOn(!!audio.current?.running));
    const started = new ShareConnection({
      hostId: sharePlay.host.userId,
      hostDevice: sharePlay.hostDevice,
      iceServers,
      audio: audio.current,
      signal,
      onChange: () => {
        setLink(started.state);
        setStream(started.stream);
        setPadOpen(started.padOpen);
      },
      onPadOutput: (output) => feedback(output),
    });
    conn.current = started;
    for (const waiting of pending.current.splice(0)) started.onSignal(waiting);
    started.start();
  }, [id, signal, finish]);

  // Join once the socket is up: signals for this browser go to its session.
  useEffect(() => {
    if (phase !== "joining" || status !== "ready" || !session || joinedOnce.current) return;
    joinedOnce.current = true;
    padSession.current = randomSession();
    join();
  }, [phase, status, session, join]);

  useLiveEvents((event) => {
    const data = event.data;
    switch (event.type) {
      case "share_play.request_answered":
        if (data?.sharePlayId !== id) return;
        if (data.answer === "accepted") {
          joinedOnce.current = false;
          setPhase("joining");
        } else setPhase("gone");
        return;
      case "share_play.signal":
        if (data?.sharePlayId !== id) return;
        if (conn.current) conn.current.onSignal(data as ShareSignal);
        else if (pending.current.length < 200) pending.current.push(data as ShareSignal);
        return;
      case "share_play.updated": {
        if (data?.id !== id) return;
        const next = data as SharePlay;
        const before = shareRef.current?.viewers.find((v) => v.user.userId === me)?.slot ?? null;
        const after = next.viewers.find((v) => v.user.userId === me)?.slot ?? null;
        if (before !== after)
          setNotice(
            after
              ? fill(texts.shareGranted, { name: next.host?.displayName ?? "?", n: after })
              : fill(texts.shareRevoked, { name: next.host?.displayName ?? "?" }),
          );
        setShare(next);
        shareRef.current = next;
        return;
      }
      case "share_play.ended":
        if (data?.sharePlayId !== id) return;
        finish(data.reason === "removed" ? "removed" : "ended", false);
        return;
      case "live.ready":
        // Back after the socket was away: in again on this device, and a fresh offer if needed.
        if (joinedOnce.current && conn.current) join();
        return;
    }
  });

  // The game's vibration on the controller, its light bar as the player badge's colour, and the
  // pad's round trip from the echo of the last input.
  function feedback(output: PadOutput) {
    const rtt = Number(nowMicros() - output.sentMicros) / 1000;
    if (rtt >= 0 && rtt < 5000) setPadRtt((old) => (old === null ? rtt : old * 0.8 + rtt * 0.2));
    setLight(output.light ? `rgb(${output.light.join(" ")})` : null);
    const now = performance.now();
    const last = rumble.current;
    const changed = output.large !== last.large || output.small !== last.small;
    if (!changed && (now - last.at < 90 || (output.large === 0 && output.small === 0))) return;
    rumble.current = { large: output.large, small: output.small, at: now };
    const actuator = (
      firstGamepad() as
        | (Gamepad & {
            vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> };
          })
        | null
    )?.vibrationActuator;
    actuator
      ?.playEffect?.("dual-rumble", {
        duration: output.large || output.small ? 140 : 1,
        strongMagnitude: output.large / 255,
        weakMagnitude: output.small / 255,
      })
      .catch(() => {});
  }

  // The picture into the video element.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    if (stream) element.play().catch(() => {});
    else setPicture(false);
  }, [stream]);

  // The quality line, once a second.
  useEffect(() => {
    if (phase !== "watching") return;
    const timer = setInterval(async () => {
      const current = conn.current;
      if (!current) return;
      setStats({ ...(await current.measure()) });
      if (audio.current) {
        setAudioStats({ ...audio.current.latest });
        setAudioOut(audio.current.outputLevel());
        setSoundOn(audio.current.running);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // A controller shows up once a button on it is pressed; looked for twice a second.
  useEffect(() => {
    setTouchOnly(window.matchMedia("(hover: none) and (pointer: coarse)").matches);
    const look = () => {
      const pad = firstGamepad();
      setGamepad(pad ? pad.id.replace(/\s*\(.*$/, "").trim() || pad.id : null);
    };
    look();
    const timer = setInterval(look, 500);
    window.addEventListener("gamepadconnected", look);
    window.addEventListener("gamepaddisconnected", look);
    return () => {
      clearInterval(timer);
      window.removeEventListener("gamepadconnected", look);
      window.removeEventListener("gamepaddisconnected", look);
    };
  }, []);

  /** The pad as it is now, from the controller and the keyboard together. */
  const readPad = useCallback(() => {
    const pad = firstGamepad();
    const fromKeys = padFromKeys(keys.current);
    return pad ? mergePads(padFromGamepad(pad), fromKeys) : fromKeys;
  }, []);

  const sendPad = useCallback((state: PadState) => {
    const current = conn.current;
    if (!current || !slotRef.current) return false;
    sequence.current = (sequence.current + 1) >>> 0;
    lastPad.current = state;
    return current.sendPad(encodePad(sequence.current, nowMicros(), padSession.current, state));
  }, []);

  // Holding a pad: 120 packets a second, and one at once whenever something changes.
  useEffect(() => {
    if (!slot || !padOpen || phase !== "watching") return;
    const timer = setInterval(() => sendPad(readPad()), padEveryMs);
    const key = (event: KeyboardEvent) => {
      if (!padKeys.has(event.code) || typing(event.target) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      // Tab moves the focus as usual unless the picture has it.
      if (event.code === "Tab" && document.activeElement !== stage.current) return;
      event.preventDefault();
      const before = keys.current.has(event.code);
      if (event.type === "keydown") keys.current.add(event.code);
      else keys.current.delete(event.code);
      if (before !== keys.current.has(event.code)) {
        const state = readPad();
        if (!samePad(state, lastPad.current)) sendPad(state);
      }
    };
    const blur = () => {
      keys.current.clear();
      sendPad(readPad());
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
      keys.current.clear();
    };
  }, [slot, padOpen, phase, readPad, sendPad]);

  // Notices fade after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    audio.current?.setVolume(volume);
    audio.current?.setMuted(muted);
  }, [volume, muted]);

  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  // Closing the page leaves the share play; the host stops sending at once.
  useEffect(() => {
    const away = () => {
      if (!conn.current) return;
      conn.current.close(true);
      navigator.sendBeacon(`/me/social/share-plays/${id}/leave`);
    };
    window.addEventListener("pagehide", away);
    return () => {
      window.removeEventListener("pagehide", away);
      conn.current?.close(true);
      audio.current?.close();
    };
  }, [id]);

  async function enableSound() {
    if (!audio.current) return;
    await audio.current.start();
    setSoundOn(audio.current.running);
  }

  async function leave() {
    // Let go of every button first, so nothing stays held in the game.
    if (slotRef.current) sendPad(restingPad());
    finish("ended", true);
    await social(`share-plays/${id}/leave`, { method: "POST" });
    location.assign("/friends");
  }

  function toggleFullscreen() {
    const element = stage.current;
    if (!element) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (element.requestFullscreen) element.requestFullscreen().catch(() => {});
    else
      (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  }

  if (phase === "ask" || phase === "asked")
    return (
      <section className="page narrowish watch-over">
        <div className="card in d1">
          <h3 className="sub">{texts.shareTitle}</h3>
          <output className="over-line">
            {phase === "asked" ? texts.askedState : fill(texts.shareSharing, { game })}
            {host && <> · {fill(texts.hostedBy, { name: hostName })}</>}
          </output>
          {phase === "ask" ? (
            <button
              type="button"
              className="primary small"
              onClick={async () => {
                const asked = await social(`share-plays/${id}/requests`, { method: "POST" });
                if (asked.ok) setPhase("asked");
                else setNotice(asked.status === 429 ? texts.tooMany : texts.failed);
              }}
            >
              {texts.askToJoin}
            </button>
          ) : (
            <button
              type="button"
              className="pill"
              onClick={async () => {
                await social(`share-plays/${id}/requests/me`, { method: "DELETE" });
                setPhase("ask");
              }}
            >
              {texts.takeBack}
            </button>
          )}
          {notice && <p className="error">{notice}</p>}
        </div>
      </section>
    );

  if (phase !== "joining" && phase !== "watching") {
    const message =
      phase === "ended"
        ? fill(texts.shareEnded, { name: hostName })
        : phase === "removed"
          ? fill(texts.shareRemoved, { name: hostName })
          : phase === "full"
            ? texts.shareFull
            : texts.shareGone;
    return (
      <section className="page narrowish watch-over">
        <div className="card in d1">
          <h3 className="sub">{texts.shareTitle}</h3>
          <output className="over-line">{message}</output>
          <Link href="/friends" className="pill">
            {texts.shareBack}
          </Link>
        </div>
      </section>
    );
  }

  const live = link === "connected" && !!stream && picture;
  const veil =
    link === "connected"
      ? stream && picture
        ? null
        : fill(texts.shareWaiting, { name: hostName })
      : link === "reconnecting"
        ? texts.shareReconnecting
        : link === "failed"
          ? texts.shareFailed
          : fill(texts.shareConnecting, { name: hostName });
  const grade = stats && live ? quality(stats) : null;
  const gradeText = grade
    ? { good: texts.shareQualityGood, ok: texts.shareQualityOk, poor: texts.shareQualityPoor }[grade]
    : null;
  const ms = (value: number | null | undefined) =>
    value === null || value === undefined ? "–" : value < 1 ? "<1 ms" : `${Math.round(value)} ms`;

  return (
    <section className="page watch">
      <div
        ref={stage}
        className={`stage in d1${live ? " is-live" : ""}${fullscreen ? " is-full" : ""}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the picture takes the keyboard while playing
        tabIndex={0}
        aria-label={fill(texts.shareWatching, { name: hostName })}
        data-link={link}
        data-frames={stats?.framesDecoded ?? 0}
        data-sound={stats?.audio === "opus" ? stats.audioSamples : (audioStats?.played ?? 0)}
        data-audio={stats?.audio ?? "pcm"}
        data-audio-channels={stats?.audioChannels ?? 0}
        data-audio-kbps={stats?.audioKbps?.toFixed(1) ?? ""}
        data-audio-buffer={stats?.audioBufferMs?.toFixed(1) ?? ""}
        data-pcm={audioStats?.received ?? 0}
        data-audio-out={audioOut.toFixed(3)}
        data-audio-concealed={stats?.audioConcealed.toFixed(4) ?? ""}
        onPointerDown={() => {
          if (!soundOn) enableSound();
        }}
      >
        <video
          ref={video}
          className="stage-video"
          autoPlay
          playsInline
          muted
          disablePictureInPicture
          onResize={(event) => setPicture(event.currentTarget.videoWidth > 0)}
          onLoadedData={(event) => setPicture(event.currentTarget.videoWidth > 0)}
        />
        <div className="stage-top">
          {host && <Avatar person={host} size={28} />}
          <span className="lines">
            <span className="name">{fill(texts.shareWatching, { name: hostName })}</span>
            <span className="meta">{game}</span>
          </span>
          <span className={`live-tag${live ? " on" : ""}`}>
            <i />
            {texts.shareLive}
          </span>
        </div>
        {veil && (
          <div className="stage-veil" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>{veil}</span>
          </div>
        )}
        {!soundOn && live && (
          <button type="button" className="sound-hint" onClick={enableSound}>
            <SpeakerIcon off />
            {texts.shareSoundOff}
          </button>
        )}
        <div className="stage-bar">
          <div className="sound">
            <button
              type="button"
              className="stage-btn"
              aria-label={muted || !soundOn ? texts.shareUnmute : texts.shareMute}
              title={muted || !soundOn ? texts.shareUnmute : texts.shareMute}
              onClick={(event) => {
                event.stopPropagation();
                if (!soundOn) return enableSound();
                setMuted(!muted);
              }}
            >
              <SpeakerIcon off={muted || !soundOn} />
            </button>
            <input
              type="range"
              className="volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label={texts.shareVolume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
                setMuted(false);
              }}
            />
          </div>
          <button
            type="button"
            className={`quality-chip${grade ? ` is-${grade}` : ""}`}
            aria-expanded={details}
            aria-label={texts.shareDetails}
            onClick={() => setDetails(!details)}
          >
            <i />
            {grade ? (
              <>
                <span className="grade">{gradeText}</span>
                <span className="figures">
                  {ms(stats?.rttMs)}
                  {stats?.fps ? ` · ${Math.round(stats.fps)} fps` : ""}
                  {stats?.height ? ` · ${stats.height}p` : ""}
                </span>
              </>
            ) : (
              <span className="figures">–</span>
            )}
          </button>
          <button
            type="button"
            className="stage-btn"
            aria-label={fullscreen ? texts.shareExitFullscreen : texts.shareFullscreen}
            title={fullscreen ? texts.shareExitFullscreen : texts.shareFullscreen}
            onClick={toggleFullscreen}
          >
            <FullscreenIcon exit={fullscreen} />
          </button>
        </div>
        {details && (
          <dl className="stage-stats">
            <div>
              <dt>{texts.shareStatRtt}</dt>
              <dd>{ms(stats?.rttMs)}</dd>
            </div>
            <div>
              <dt>{texts.shareStatFps}</dt>
              <dd>{stats?.fps ? `${Math.round(stats.fps)} fps` : "–"}</dd>
            </div>
            <div>
              <dt>{texts.shareStatResolution}</dt>
              <dd>
                {stats?.width ? `${stats.width}×${stats.height}` : "–"}
                {stats?.codec ? ` ${stats.codec}` : ""}
              </dd>
            </div>
            <div>
              <dt>{texts.shareStatBitrate}</dt>
              <dd>{stats?.bitrateKbps ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbit/s` : "–"}</dd>
            </div>
            <div>
              <dt>{texts.shareStatJitter}</dt>
              <dd>{ms(stats?.jitterMs)}</dd>
            </div>
            <div>
              <dt>{texts.shareStatAudio}</dt>
              <dd>
                {!soundOn
                  ? "–"
                  : stats?.audio === "opus"
                    ? `${ms(stats.audioBufferMs)} · Opus${stats.audioKbps ? ` ${Math.round(stats.audioKbps)} kbit/s` : ""}`
                    : audioStats
                      ? `${ms(audioStats.bufferedMs)} · PCM`
                      : "–"}
              </dd>
            </div>
            <div>
              <dt>{texts.shareStatLost}</dt>
              <dd>
                {stats ? stats.lost : "–"}
                {stats?.lossRate ? ` (${(stats.lossRate * 100).toFixed(1)}%)` : ""}
              </dd>
            </div>
            <div>
              <dt>{texts.shareStatPath}</dt>
              <dd>
                {stats?.path === "relay"
                  ? texts.sharePathRelay
                  : stats?.path === "direct"
                    ? texts.sharePathDirect
                    : "–"}
              </dd>
            </div>
            {slot && (
              <div>
                <dt>{texts.shareStatPad}</dt>
                <dd>{ms(padRtt)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="watch-under in d2">
        <div
          className={`seat${slot ? " playing" : ""}`}
          style={light && slot ? { ["--light" as string]: light } : undefined}
        >
          <span className="seat-badge" aria-hidden="true">
            {slot ? `P${slot}` : <EyeIcon />}
          </span>
          <span className="lines">
            <span className="name">
              {slot ? fill(texts.shareYouArePlayer, { n: slot }) : texts.shareWatchOnly}
            </span>
            <span className="meta">
              {slot
                ? touchOnly && !gamepad
                  ? texts.sharePhoneWatch
                  : gamepad
                    ? `${texts.shareController} · ${gamepad}`
                    : texts.shareNoController
                : fill(texts.shareWatchOnlyHint, { name: hostName })}
            </span>
          </span>
        </div>
        <button type="button" className="pill danger" onClick={leave}>
          {texts.shareLeave}
        </button>
      </div>

      {slot && !touchOnly && (
        <details className="card keys in d3">
          <summary className="sub">{texts.shareKeyboard}</summary>
          <dl className="keymap">
            {(
              [
                [["W", "A", "S", "D"], texts.shareKeysStick],
                [["↑", "←", "↓", "→"], texts.shareKeysDpad],
                [["I", "J", "K", "L"], texts.shareKeysFace],
                [["Q", "E"], texts.shareKeysShoulders],
                [["Z", "C"], texts.shareKeysTriggers],
                [["F", "G"], texts.shareKeysSticks],
                [["Enter"], texts.shareKeysOptions],
                [["Tab", "⌫"], texts.shareKeysTouchpad],
              ] as [string[], string][]
            ).map(([caps, what]) => (
              <div key={what}>
                <dt>
                  {caps.map((cap) => (
                    <kbd key={cap}>{cap}</kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {notice && <output className="watch-notice">{notice}</output>}
    </section>
  );
}

function SpeakerIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {off ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />
      )}
    </svg>
  );
}

function FullscreenIcon({ exit }: { exit?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
