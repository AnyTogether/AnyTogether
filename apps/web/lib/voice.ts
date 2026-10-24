import type { CallPeer } from "@/lib/social";

export type SignalKind = "offer" | "answer" | "candidate" | "bye" | "renegotiate";

interface Peer {
  userId: string;
  device: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  queued: RTCIceCandidateInit[];
  makingOffer: boolean;
  speaking: boolean;
  quietSince: number;
}

export interface VoiceState {
  peers: { userId: string; state: RTCPeerConnectionState; speaking: boolean }[];
  speaking: boolean;
  /** The microphone's level while it is sending, 0..1. */
  level: number;
}

/** Above this the person is speaking; the ring stays a moment after, so it does not flicker. */
const speakingLevel = 0.02;
const speakingHoldMs = 350;

/** Voice in a party as a peer-to-peer mesh: one RTCPeerConnection per member, Opus with in-band
 *  FEC and DTX, the platform's echo cancellation, noise suppression and gain. Whoever joins later
 *  makes the offers; if two offer at once, the "polite" side (the larger user ID) gives way. */
export class VoiceMesh {
  private peers = new Map<string, Peer>();
  private stream: MediaStream | null;
  private context: AudioContext | null = null;
  private local: AnalyserNode | null = null;
  private talking = false;
  private speaking = false;
  private quietSince = 0;
  private level = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Asks for the microphone, with the platform's voice processing; throws when the browser or
   *  the person says no. */
  static microphone() {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  }

  constructor(
    private readonly options: {
      me: string;
      stream: MediaStream;
      iceServers: RTCIceServer[];
      signal: (to: string, device: string, kind: SignalKind, data: unknown) => boolean;
      onChange: () => void;
    },
  ) {
    this.stream = options.stream;
    this.context = new AudioContext();
    this.local = this.analyse(this.stream);
    this.setTalking(false);
    this.timer = setInterval(() => this.measure(), 100);
  }

  /** Sends the microphone or not (muted, or push-to-talk not held). */
  setTalking(on: boolean) {
    this.talking = on;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = on;
  }

  /** Calls a member already in the call (we are the newcomer, so we offer). */
  async connectTo(peer: CallPeer) {
    if (peer.userId === this.options.me) return;
    const known = this.peers.get(peer.userId);
    if (known && known.device === peer.device && known.pc.connectionState !== "failed") return;
    if (known) this.drop(peer.userId, false);
    await this.offer(this.open(peer));
  }

  async onSignal(signal: { from: string; device: string; kind: SignalKind; data: unknown }) {
    const { from, device, kind } = signal;
    let peer = this.peers.get(from);
    if (kind === "bye") return this.drop(from, false);
    if (peer && peer.device !== device && kind === "offer") {
      this.drop(from, false);
      peer = undefined;
    }
    if (kind === "offer") {
      peer ??= this.open({ userId: from, device });
      const polite = this.options.me > from;
      const collision = peer.makingOffer || peer.pc.signalingState !== "stable";
      if (collision && !polite) return;
      if (collision) await peer.pc.setLocalDescription({ type: "rollback" });
      await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
      await this.flush(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription({ type: "answer", sdp: tuneOpus(answer.sdp ?? "") });
      this.send(peer, "answer", peer.pc.localDescription?.toJSON());
      return;
    }
    if (!peer || peer.device !== device) return;
    if (kind === "answer" && peer.pc.signalingState === "have-local-offer") {
      await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
      await this.flush(peer);
    } else if (kind === "candidate" && signal.data) {
      if (peer.pc.remoteDescription)
        await peer.pc.addIceCandidate(signal.data as RTCIceCandidateInit).catch(() => {});
      else peer.queued.push(signal.data as RTCIceCandidateInit);
    } else if (kind === "renegotiate") {
      await this.offer(peer, true);
    }
  }

  /** Someone left the call: their connection goes. */
  drop(userId: string, sayBye = true) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    if (sayBye) this.send(peer, "bye", null);
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(userId);
    this.options.onChange();
  }

  close() {
    for (const userId of [...this.peers.keys()]) this.drop(userId);
    clearInterval(this.timer);
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.context?.close().catch(() => {});
    this.stream = null;
  }

  state(): VoiceState {
    return {
      peers: [...this.peers.values()].map((p) => ({
        userId: p.userId,
        state: p.pc.connectionState,
        speaking: p.speaking,
      })),
      speaking: this.speaking,
      level: this.level,
    };
  }

  private send(peer: Peer, kind: SignalKind, data: unknown) {
    this.options.signal(peer.userId, peer.device, kind, data);
  }

  private open(target: CallPeer): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = {
      ...target,
      pc,
      audio,
      analyser: null,
      queued: [],
      makingOffer: false,
      speaking: false,
      quietSince: 0,
    };
    for (const track of this.stream?.getAudioTracks() ?? []) pc.addTrack(track, this.stream as MediaStream);
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send(peer, "candidate", event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const incoming = stream ?? new MediaStream([event.track]);
      audio.srcObject = incoming;
      audio.play().catch(() => {});
      peer.analyser = this.analyse(incoming);
    };
    pc.onconnectionstatechange = () => {
      // When a path breaks, the impolite side restarts ICE (through the relay if it must).
      if (pc.connectionState === "failed" && this.options.me < peer.userId) this.offer(peer, true);
      this.options.onChange();
    };
    this.peers.set(target.userId, peer);
    this.options.onChange();
    return peer;
  }

  private async offer(peer: Peer, restart = false) {
    try {
      peer.makingOffer = true;
      const offer = await peer.pc.createOffer({ iceRestart: restart });
      if (peer.pc.signalingState !== "stable") return;
      await peer.pc.setLocalDescription({ type: "offer", sdp: tuneOpus(offer.sdp ?? "") });
      this.send(peer, "offer", peer.pc.localDescription?.toJSON());
    } finally {
      peer.makingOffer = false;
    }
  }

  private async flush(peer: Peer) {
    for (const candidate of peer.queued.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
  }

  private analyse(stream: MediaStream) {
    if (!this.context) return null;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  /** Levels ten times a second, for the speaking rings and the microphone meter. */
  private measure() {
    const now = performance.now();
    let changed = false;
    const local = this.talking ? rms(this.local) : 0;
    if (Math.abs(local - this.level) > 0.004) {
      this.level = local;
      changed = true;
    }
    const step = (speaking: boolean, value: number, quietSince: number) => {
      if (value > speakingLevel) return { speaking: true, quietSince: now };
      return { speaking: speaking && now - quietSince < speakingHoldMs, quietSince };
    };
    const mine = step(this.speaking, local, this.quietSince);
    changed ||= mine.speaking !== this.speaking;
    this.speaking = mine.speaking;
    this.quietSince = mine.quietSince;
    for (const peer of this.peers.values()) {
      const next = step(peer.speaking, rms(peer.analyser), peer.quietSince);
      changed ||= next.speaking !== peer.speaking;
      peer.speaking = next.speaking;
      peer.quietSince = next.quietSince;
    }
    if (changed) this.options.onChange();
  }
}

function rms(analyser: AnalyserNode | null) {
  if (!analyser) return 0;
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** Opus for voice: mono, in-band FEC (rides out about 10 % loss), DTX (silence costs almost
 *  nothing), at most 32 kbit/s. */
export function tuneOpus(sdp: string) {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!match) return sdp;
  const payload = match[1];
  const wanted = { useinbandfec: "1", usedtx: "1", stereo: "0", maxaveragebitrate: "32000" };
  const fmtp = new RegExp(`a=fmtp:${payload} ([^\\r\\n]*)`);
  if (!fmtp.test(sdp)) {
    const params = Object.entries(wanted)
      .map(([key, value]) => `${key}=${value}`)
      .join(";");
    return sdp.replace(match[0], `${match[0]}\r\na=fmtp:${payload} ${params}`);
  }
  return sdp.replace(fmtp, (_, existing: string) => {
    const params = new Map(
      existing
        .split(";")
        .filter(Boolean)
        .map((pair) => pair.split("=") as [string, string]),
    );
    for (const [key, value] of Object.entries(wanted)) params.set(key, value);
    return `a=fmtp:${payload} ${[...params].map(([key, value]) => `${key}=${value}`).join(";")}`;
  });
}

/** "KeyV" → "V", "Space" → "Space". */
export const keyLabel = (code: string) => code.replace(/^Key|^Digit/, "").replace(/^Arrow/, "");
