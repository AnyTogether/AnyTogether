"use client";

import { Avatar } from "@/components/Avatar";
import { useLive, useLiveEvents } from "@/components/Live";
import type { CallStrings } from "@/lib/i18n-social";
import { type Person, fill } from "@/lib/people";
import { type CallJoin, json, social } from "@/lib/social";
import { type MicState, VoiceMesh, type VoiceState, micState, toggleDeafen, toggleMic } from "@/lib/voice";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Ended = "ended" | "declined" | "no_answer" | "elsewhere" | "failed" | "mic";

/** The one call between two friends this browser is in, from ringing to a moment after it ends. */
export interface ActiveCall {
  id: string | null;
  peer: Person;
  outgoing: boolean;
  phase: "calling" | "connecting" | "live" | "ended";
  /** When the voice started flowing. */
  since: number | null;
  ended?: Ended;
  peerMuted: boolean;
  /** The other person hears no one. */
  peerDeafened?: boolean;
}

interface Incoming {
  callId: string;
  from: Person;
}

interface Calls {
  active: ActiveCall | null;
  /** Calls a friend, unless a call is going on already. */
  ring: (friend: Person) => void;
}

const CallsContext = createContext<Calls>({ active: null, ring: () => {} });
export const useCalls = () => useContext(CallsContext);

/** Nobody answers: the caller gives up after this. */
const noAnswerMs = 45_000;
/** How long the ended call stays on screen. */
const endedShowMs = 2600;

/** Calls between friends anywhere on the website: the incoming call card on every page, ringing
 *  that stops when another device answers, and the call itself with mute, leave and the speaking
 *  ring. Voice is the party's peer-to-peer WebRTC, between the two devices the API names. */
export function CallProvider({ texts, children }: { texts: CallStrings; children: ReactNode }) {
  const { me, session, send } = useLive();
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [mic, setMic] = useState<MicState>(micState);
  const muted = !mic.micOn;
  const [busy, setBusy] = useState(false);
  const mesh = useRef<VoiceMesh | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Bumped whenever a call is over, so a ring still waiting on the API knows it was cancelled. */
  const attempt = useRef(0);
  const noAnswer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearEnded = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((call: ActiveCall | null) => {
    activeRef.current = call;
    setActive(call);
  }, []);

  const finish = useCallback(
    (reason: Ended, tellServer: boolean) => {
      attempt.current++;
      const current = activeRef.current;
      mesh.current?.close();
      mesh.current = null;
      setVoice(null);
      setMic(micState());
      clearTimeout(noAnswer.current);
      if (tellServer && current?.id) social(`calls/${current.id}/leave`, { method: "POST" });
      if (!current) return;
      show({ ...current, phase: "ended", ended: reason });
      clearTimeout(clearEnded.current);
      clearEnded.current = setTimeout(() => {
        if (activeRef.current?.phase === "ended") show(null);
      }, endedShowMs);
    },
    [show],
  );

  const startVoice = useCallback(
    (callId: string, stream: MediaStream, iceServers: RTCIceServer[]) => {
      const started = new VoiceMesh({
        me,
        stream,
        iceServers,
        signal: (to, device, kind, data) => send({ op: "signal", to, device, call: callId, kind, data }),
        onChange: () => setVoice(started.state()),
      });
      mesh.current = started;
      started.setTalking(true);
      setVoice(started.state());
      return started;
    },
    [me, send],
  );

  const busyCalling = useCallback(() => !!activeRef.current && activeRef.current.phase !== "ended", []);

  const ring = useCallback(
    async (friend: Person) => {
      if (busyCalling() || !session) return;
      clearTimeout(clearEnded.current);
      const mine = ++attempt.current;
      show({ id: null, peer: friend, outgoing: true, phase: "calling", since: null, peerMuted: false });
      let stream: MediaStream | null = null;
      try {
        stream = await VoiceMesh.microphone();
        const joined = await social<CallJoin>("calls", {
          method: "POST",
          ...json({ userId: friend.userId }),
        });
        if (!joined.body?.call) throw new Error("no call");
        const id = joined.body.call.id;
        // Ended while the API was asked: hang up what it made.
        if (attempt.current !== mine) {
          for (const track of stream.getTracks()) track.stop();
          social(`calls/${id}/leave`, { method: "POST" });
          return;
        }
        startVoice(id, stream, joined.body.iceServers);
        show({ ...(activeRef.current as ActiveCall), id });
        noAnswer.current = setTimeout(() => {
          if (activeRef.current?.id === id && activeRef.current.phase === "calling")
            finish("no_answer", true);
        }, noAnswerMs);
      } catch (error) {
        for (const track of stream?.getTracks() ?? []) track.stop();
        if (attempt.current !== mine) return;
        const denied = error instanceof DOMException && /NotAllowed|Security|NotFound/.test(error.name);
        finish(denied ? "mic" : "failed", false);
      }
    },
    [session, show, startVoice, finish, busyCalling],
  );

  async function accept(item: Incoming) {
    setBusy(true);
    if (busyCalling()) finish("ended", true);
    clearTimeout(clearEnded.current);
    const mine = ++attempt.current;
    let stream: MediaStream | null = null;
    try {
      stream = await VoiceMesh.microphone();
      const answered = await social<CallJoin>(`calls/${item.callId}/answer`, { method: "POST" });
      setIncoming((list) => list.filter((i) => i.callId !== item.callId));
      if (!answered.ok || !answered.body?.call) {
        for (const track of stream.getTracks()) track.stop();
        show({
          id: item.callId,
          peer: item.from,
          outgoing: false,
          phase: "connecting",
          since: null,
          peerMuted: false,
        });
        return finish(answered.status === 409 ? "elsewhere" : "failed", false);
      }
      if (attempt.current !== mine) return;
      const caller = answered.body.call.in.find((peer) => peer.userId === item.from.userId);
      show({
        id: item.callId,
        peer: item.from,
        outgoing: false,
        phase: "connecting",
        since: null,
        peerMuted: !!caller?.muted,
        peerDeafened: !!caller?.deafened,
      });
      const started = startVoice(item.callId, stream, answered.body.iceServers);
      // We answered last, so we make the offer.
      if (caller) await started.connectTo(caller);
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      const denied = error instanceof DOMException && /NotAllowed|Security|NotFound/.test(error.name);
      show({
        id: item.callId,
        peer: item.from,
        outgoing: false,
        phase: "connecting",
        since: null,
        peerMuted: false,
      });
      finish(denied ? "mic" : "failed", true);
    } finally {
      setBusy(false);
    }
  }

  function decline(item: Incoming) {
    setIncoming((list) => list.filter((i) => i.callId !== item.callId));
    social(`calls/${item.callId}/decline`, { method: "POST" });
  }

  /** The mic or hearing changed: the voice follows, and the other person is told. */
  function change(next: MicState) {
    const call = activeRef.current;
    setMic(next);
    mesh.current?.setTalking(next.micOn);
    mesh.current?.setDeafened(next.deafened);
    if (call?.id)
      social(`calls/${call.id}/mute`, {
        method: "POST",
        ...json({ muted: !next.micOn, deafened: next.deafened }),
      });
  }

  useLiveEvents((event) => {
    const data = event.data;
    const current = activeRef.current;
    switch (event.type) {
      case "call.ringing":
        if (!data?.from || data.from.userId === me) return;
        setIncoming((list) =>
          list.some((i) => i.callId === data.callId)
            ? list
            : [...list, { callId: data.callId, from: data.from }],
        );
        return;
      case "call.answered":
        // Answered here or on another device: either way this one stops ringing.
        setIncoming((list) => list.filter((i) => i.callId !== data.callId));
        if (current && current.id === data.callId && current.outgoing && current.phase === "calling") {
          clearTimeout(noAnswer.current);
          show({ ...current, phase: "connecting" });
        }
        return;
      case "call.ended":
        setIncoming((list) => list.filter((i) => i.callId !== data.callId));
        if (current && current.id === data.callId && current.phase !== "ended")
          finish(data.reason === "declined" ? "declined" : "ended", false);
        return;
      case "call.updated":
        if (current && current.id === data.callId && data.userId !== me)
          show({ ...current, peerMuted: !!data.muted, peerDeafened: !!data.deafened });
        return;
      case "signal":
        if (mesh.current && current?.id && data.call === current.id)
          mesh.current.onSignal(data).catch(() => {});
        return;
      case "live.ready":
        // Back after the socket was away: forget calls that ended meanwhile.
        if (current?.id && current.phase !== "ended")
          social(`calls/${current.id}`).then((r) => {
            if (r.status === 404 && activeRef.current?.id === current.id) finish("ended", false);
          });
        for (const item of incoming)
          social<{ answeredAt: string | null }>(`calls/${item.callId}`).then((r) => {
            if (r.status === 404 || r.body?.answeredAt)
              setIncoming((list) => list.filter((i) => i.callId !== item.callId));
          });
        return;
    }
  });

  // The voice is flowing: the call is live from now.
  useEffect(() => {
    const current = activeRef.current;
    if (current?.phase === "connecting" && voice?.peers.some((p) => p.state === "connected"))
      show({ ...current, phase: "live", since: Date.now() });
  }, [voice, show]);

  // Room for the call panel, so it never sits on a page's own buttons.
  useEffect(() => {
    document.body.classList.toggle("in-call", !!active);
  }, [active]);

  // Closing the page leaves the call.
  useEffect(() => {
    const away = () => {
      const current = activeRef.current;
      if (current?.id && current.phase !== "ended")
        navigator.sendBeacon(`/me/social/calls/${current.id}/leave`);
    };
    window.addEventListener("pagehide", away);
    return () => window.removeEventListener("pagehide", away);
  }, []);

  useTone(incoming.length > 0 ? "incoming" : active?.phase === "calling" && active.id ? "ringback" : null);

  const ringingNow = incoming[0];
  return (
    <CallsContext.Provider value={{ active, ring }}>
      {children}
      <div className="call-layer">
        {ringingNow && (
          <div
            key={ringingNow.callId}
            className="call-card incoming"
            role="alertdialog"
            aria-label={fill(texts.callingYou, { name: ringingNow.from.displayName })}
          >
            <span className="call-face calling">
              <Avatar person={ringingNow.from} size={44} />
            </span>
            <span className="lines">
              <span className="name">{fill(texts.callingYou, { name: ringingNow.from.displayName })}</span>
              <span className="meta">{texts.voiceCall}</span>
            </span>
            <div className="call-acts">
              <button
                type="button"
                className="round hang"
                aria-label={texts.declineCall}
                title={texts.declineCall}
                disabled={busy}
                onClick={() => decline(ringingNow)}
              >
                <PhoneIcon down />
              </button>
              <button
                type="button"
                className="round pick"
                aria-label={texts.acceptCall}
                title={texts.acceptCall}
                disabled={busy}
                onClick={() => accept(ringingNow)}
              >
                <PhoneIcon />
              </button>
            </div>
          </div>
        )}
        {active && (
          <CallPanel
            texts={texts}
            call={active}
            voice={voice}
            muted={muted}
            deafened={mic.deafened}
            onMute={() => change(toggleMic(mic))}
            onDeafen={() => change(toggleDeafen(mic))}
            onEnd={() => finish("ended", true)}
          />
        )}
      </div>
    </CallsContext.Provider>
  );
}

function CallPanel({
  texts,
  call,
  voice,
  muted,
  deafened,
  onMute,
  onDeafen,
  onEnd,
}: {
  texts: CallStrings;
  call: ActiveCall;
  voice: VoiceState | null;
  muted: boolean;
  deafened: boolean;
  onMute: () => void;
  onDeafen: () => void;
  onEnd: () => void;
}) {
  const name = call.peer.displayName;
  const peer = voice?.peers.find((p) => p.userId === call.peer.userId);
  const over = call.phase === "ended";
  const status = over
    ? {
        ended: texts.callEnded,
        declined: fill(texts.callDeclined, { name }),
        no_answer: texts.callNoAnswer,
        elsewhere: texts.callElsewhere,
        failed: texts.callFailed,
        mic: texts.micDenied,
      }[call.ended ?? "ended"]
    : call.phase === "calling"
      ? texts.calling
      : call.phase === "connecting"
        ? texts.callConnecting
        : null;
  return (
    <section className={`call-panel is-${call.phase}`} aria-label={texts.voiceCall}>
      <span
        className={`call-face big${call.phase === "calling" ? " calling" : ""}${
          !over && peer?.speaking ? " speaking" : ""
        }`}
      >
        <Avatar person={call.peer} size={64} />
        {(call.peerMuted || call.peerDeafened) && !over && (
          <i
            className="muted-badge"
            title={fill(call.peerDeafened ? texts.peerDeafened : texts.peerMuted, { name })}
          >
            {call.peerDeafened ? <HeadphonesIcon off /> : <MicIcon off />}
          </i>
        )}
      </span>
      <span className="lines">
        <span className="name">{name}</span>
        <span className="meta" aria-live="polite">
          {status ?? <Clock since={call.since ?? Date.now()} />}
          {(call.peerMuted || call.peerDeafened) && !over && (
            <span className="sr-only">
              {fill(call.peerDeafened ? texts.peerDeafened : texts.peerMuted, { name })}
            </span>
          )}
        </span>
      </span>
      {!over && (
        <div className="call-acts">
          <button
            type="button"
            className={`mic small-mic${muted ? "" : " on"}${!muted && voice?.speaking ? " hot" : ""}`}
            aria-pressed={muted}
            aria-label={muted ? texts.micOff : texts.micOn}
            title={muted ? texts.micOff : texts.micOn}
            disabled={!call.id}
            onClick={onMute}
          >
            <MicIcon off={muted} />
          </button>
          <button
            type="button"
            className={`mic small-mic deafen${deafened ? "" : " on"}`}
            aria-pressed={deafened}
            aria-label={deafened ? texts.undeafen : texts.deafen}
            title={deafened ? texts.undeafen : texts.deafen}
            disabled={!call.id}
            onClick={onDeafen}
          >
            <HeadphonesIcon off={deafened} />
          </button>
          <button
            type="button"
            className="round hang"
            aria-label={texts.endCall}
            title={texts.endCall}
            onClick={onEnd}
          >
            <PhoneIcon down />
          </button>
        </div>
      )}
    </section>
  );
}

/** "0:42", "12:05", "1:02:09" since the call went live. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return <time>{h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`}</time>;
}

/** A soft ring while a call comes in, a ringback while ours rings; made by the page, no files. The
 *  browser may keep it silent until the page was touched once, which is fine. */
function useTone(kind: "incoming" | "ringback" | null) {
  useEffect(() => {
    if (!kind) return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      return;
    }
    const beep = (frequencies: number[], at: number, length: number, volume: number) => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.03);
      gain.gain.setValueAtTime(volume, at + length - 0.08);
      gain.gain.linearRampToValueAtTime(0, at + length);
      gain.connect(context.destination);
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(at);
        oscillator.stop(at + length);
      }
    };
    const once = () => {
      const at = context.currentTime + 0.02;
      if (kind === "incoming") {
        beep([660], at, 0.18, 0.08);
        beep([880], at + 0.22, 0.26, 0.08);
      } else beep([440, 480], at, 1.2, 0.04);
    };
    context.resume().catch(() => {});
    once();
    const timer = setInterval(once, kind === "incoming" ? 2200 : 3500);
    return () => {
      clearInterval(timer);
      context.close().catch(() => {});
    };
  }, [kind]);
}

export function PhoneIcon({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`stroke${down ? " hang-up" : ""}`}>
      <path d="M6.6 3.8 8.9 4.3a1.5 1.5 0 0 1 1.1 1.2l.4 2.6a1.5 1.5 0 0 1-.6 1.4l-1.4 1a12 12 0 0 0 5.1 5.1l1-1.4a1.5 1.5 0 0 1 1.4-.6l2.6.4a1.5 1.5 0 0 1 1.2 1.1l.5 2.3a1.6 1.6 0 0 1-1.6 1.9A16 16 0 0 1 4.7 5.4a1.6 1.6 0 0 1 1.9-1.6z" />
    </svg>
  );
}

function HeadphonesIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="14" width="4" height="6" rx="1.6" />
      <rect x="16.5" y="14" width="4" height="6" rx="1.6" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** A phone button that calls a friend; off while a call is going on. */
export function CallButton({ person, label }: { person: Person; label: string }) {
  const { active, ring } = useCalls();
  const { session } = useLive();
  return (
    <button
      type="button"
      className="pill icon call-btn"
      aria-label={label}
      title={label}
      disabled={!session || (!!active && active.phase !== "ended")}
      onClick={() => ring(person)}
    >
      <PhoneIcon />
    </button>
  );
}
