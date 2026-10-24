import { type PadOutput, decodeAudio, decodePadOutput } from "@/lib/share";
import type { ShareAudio } from "@/lib/shareAudio";
import {
  type TrackStats,
  audioHello,
  canPlayOpusTrack,
  stereoOpus,
  trackFrom,
  trackRates,
} from "@/lib/shareOpus";

export type ShareSignalKind = "offer" | "answer" | "candidate" | "bye" | "renegotiate" | "message";

export interface ShareSignal {
  sharePlayId: string;
  from: string;
  device: string;
  kind: ShareSignalKind;
  data: unknown;
}

export type LinkState = "waiting" | "connecting" | "connected" | "reconnecting" | "failed" | "closed";

/** What the quality line shows, from the connection's statistics. */
export interface LinkStats {
  rttMs: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  /** The jitter buffer's average hold, in milliseconds. */
  jitterMs: number | null;
  lost: number;
  /** Share of packets lost in the last second, 0-1. */
  lossRate: number;
  bitrateKbps: number | null;
  path: "direct" | "relay" | null;
  codec: string | null;
  framesDecoded: number;
  /** The game's sound: "opus" once it comes as the track, else "pcm" (the data channel). */
  audio: "opus" | "pcm";
  audioChannels: number | null;
  audioKbps: number | null;
  /** The track's jitter buffer hold over the last second, milliseconds. */
  audioBufferMs: number | null;
  /** Share of the track's samples made up for lost packets in the last second, 0-1. */
  audioConcealed: number;
  /** Samples of the track played so far (48 kHz, both sides counted once). */
  audioSamples: number;
}

const emptyStats = (): LinkStats => ({
  rttMs: null,
  fps: null,
  width: null,
  height: null,
  jitterMs: null,
  lost: 0,
  lossRate: 0,
  bitrateKbps: null,
  path: null,
  codec: null,
  framesDecoded: 0,
  audio: "pcm",
  audioChannels: null,
  audioKbps: null,
  audioBufferMs: null,
  audioConcealed: 0,
  audioSamples: 0,
});

/** How long after joining the viewer waits for the host's own offer before asking for one, and
 *  how often it asks again while nothing connects. */
const askAfterMs = 1500;
const askEveryMs = 5000;

/** The viewer's side of share play: the host always offers; this answers, shows the picture,
 *  asks for the game's sound as an Opus track and plays it (or, from launchers without it, the PCM
 *  on the "audio" channel), and sends the pad on the "pad" channel (both channels unordered, no
 *  retransmits, made by the host). */
export class ShareConnection {
  private pc: RTCPeerConnection | null = null;
  private queued: RTCIceCandidateInit[] = [];
  private chain: Promise<void> = Promise.resolve();
  private pad: RTCDataChannel | null = null;
  private asker: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private previous: {
    at: number;
    bytes: number;
    lost: number;
    received: number;
    track: TrackStats | null;
  } | null = null;
  state: LinkState = "waiting";
  stream: MediaStream | null = null;
  stats: LinkStats = emptyStats();

  constructor(
    private readonly options: {
      hostId: string;
      hostDevice: string;
      iceServers: RTCIceServer[];
      audio: ShareAudio;
      signal: (device: string, kind: ShareSignalKind, data: unknown) => boolean;
      onChange: () => void;
      onPadOutput?: (output: PadOutput) => void;
    },
  ) {}

  /** Joined: the host offers by itself; if nothing came in a moment, ask. */
  start() {
    this.schedule(askAfterMs);
  }

  private schedule(ms: number) {
    clearTimeout(this.asker);
    this.asker = setTimeout(() => {
      if (this.closed || this.state === "connected") return;
      this.options.signal(this.options.hostDevice, "renegotiate", null);
      this.schedule(askEveryMs);
    }, ms);
  }

  /** Asks the host for a fresh offer now (after the socket came back, or a broken path). */
  askAgain() {
    if (this.closed) return;
    this.options.signal(this.options.hostDevice, "renegotiate", null);
    this.schedule(askEveryMs);
  }

  setIceServers(iceServers: RTCIceServer[]) {
    this.options.iceServers = iceServers;
    this.pc?.setConfiguration({ ...this.pc.getConfiguration(), iceServers });
  }

  onSignal(signal: ShareSignal) {
    if (this.closed || signal.from !== this.options.hostId) return;
    this.options.hostDevice = signal.device;
    // One at a time: a second offer waits for the first answer.
    this.chain = this.chain.then(() => this.handle(signal)).catch(() => {});
    return this.chain;
  }

  private async handle({ kind, data }: ShareSignal) {
    if (kind === "bye") {
      this.drop();
      this.set("waiting");
      this.schedule(askEveryMs);
      return;
    }
    if (kind === "offer") {
      if (!this.pc || this.pc.connectionState === "failed" || this.pc.connectionState === "closed")
        this.open();
      const pc = this.pc as RTCPeerConnection;
      if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      for (const candidate of this.queued.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
      const answer = await pc.createAnswer();
      // Stereo asked for, or the browser decodes the game's sound as mono.
      try {
        await pc.setLocalDescription({ type: "answer", sdp: stereoOpus(answer.sdp ?? "") });
      } catch {
        await pc.setLocalDescription(answer);
      }
      this.options.signal(this.options.hostDevice, "answer", pc.localDescription?.toJSON());
      if (this.state !== "connected") this.set("connecting");
      return;
    }
    if (kind === "candidate" && data) {
      const candidate = data as RTCIceCandidateInit;
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(candidate).catch(() => {});
      else this.queued.push(candidate);
    }
  }

  private open() {
    this.drop();
    const pc = new RTCPeerConnection({ iceServers: this.options.iceServers });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.options.signal(this.options.hostDevice, "candidate", event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      // As little waiting as the browser allows: the picture as soon as it is decoded.
      const receiver = event.receiver as RTCRtpReceiver & {
        playoutDelayHint?: number;
        jitterBufferTarget?: number;
      };
      try {
        receiver.jitterBufferTarget = 0;
      } catch {}
      try {
        receiver.playoutDelayHint = 0;
      } catch {}
      if (event.track.kind === "audio") {
        this.options.audio.playTrack(event.track);
        return;
      }
      if (event.track.kind !== "video") return;
      this.stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onChange();
    };
    pc.ondatachannel = ({ channel }) => {
      channel.binaryType = "arraybuffer";
      if (channel.label === "audio") {
        // The hello: a launcher that knows it sends the sound as the Opus track instead.
        const hello = () => {
          if (canPlayOpusTrack() && channel.readyState === "open") channel.send(audioHello());
        };
        if (channel.readyState === "open") hello();
        else channel.onopen = hello;
        channel.onmessage = (message) => {
          if (!(message.data instanceof ArrayBuffer)) return;
          const packet = decodeAudio(message.data);
          if (packet) this.options.audio.push(packet.samples, packet.number);
        };
      } else if (channel.label === "pad") {
        this.pad = channel;
        channel.onmessage = (message) => {
          if (!(message.data instanceof ArrayBuffer)) return;
          const output = decodePadOutput(message.data);
          if (output) this.options.onPadOutput?.(output);
        };
        channel.onopen = channel.onclose = () => this.options.onChange();
      }
    };
    pc.onconnectionstatechange = () => {
      const now = pc.connectionState;
      if (pc !== this.pc) return;
      if (now === "connected") {
        clearTimeout(this.asker);
        this.set("connected");
      } else if (now === "disconnected") {
        this.set("reconnecting");
      } else if (now === "failed") {
        // A broken path: the host restarts ICE (through the relay if it must) when asked.
        this.set("reconnecting");
        this.askAgain();
      }
    };
  }

  /** Whether pad packets can go now. */
  get padOpen() {
    return this.pad?.readyState === "open";
  }

  /** One pad packet; skipped while the channel is backed up, as the next one carries everything. */
  sendPad(bytes: Uint8Array<ArrayBuffer>) {
    const pad = this.pad;
    if (!pad || pad.readyState !== "open" || pad.bufferedAmount > 8 * 1024) return false;
    pad.send(bytes);
    return true;
  }

  async measure() {
    const pc = this.pc;
    if (!pc) return this.stats;
    const report = await pc.getStats().catch(() => null);
    if (!report) return this.stats;
    const next = emptyStats();
    let pair: RTCIceCandidatePairStats | undefined;
    const byId = new Map<string, Record<string, unknown>>();
    for (const entry of report.values()) byId.set(entry.id, entry);
    let bytes = 0;
    let received = 0;
    let track: TrackStats | null = null;
    for (const entry of report.values()) {
      if (entry.type === "transport" && entry.selectedCandidatePairId)
        pair = byId.get(entry.selectedCandidatePairId) as RTCIceCandidatePairStats | undefined;
      if (entry.type === "inbound-rtp" && entry.kind === "video") {
        next.fps = entry.framesPerSecond ?? null;
        next.width = entry.frameWidth ?? null;
        next.height = entry.frameHeight ?? null;
        next.lost = entry.packetsLost ?? 0;
        next.framesDecoded = entry.framesDecoded ?? 0;
        received = entry.packetsReceived ?? 0;
        bytes = entry.bytesReceived ?? 0;
        if (entry.jitterBufferEmittedCount)
          next.jitterMs = (entry.jitterBufferDelay / entry.jitterBufferEmittedCount) * 1000;
        const codec = entry.codecId ? byId.get(entry.codecId) : undefined;
        next.codec = typeof codec?.mimeType === "string" ? codec.mimeType.replace(/^video\//, "") : null;
      }
      if (entry.type === "inbound-rtp" && entry.kind === "audio") {
        track = trackFrom(entry);
        const codec = entry.codecId ? byId.get(entry.codecId) : undefined;
        if (typeof codec?.mimeType === "string" && /opus/i.test(codec.mimeType) && track.samples > 0)
          next.audio = "opus";
        next.audioChannels = typeof codec?.channels === "number" ? codec.channels : null;
        next.audioSamples = track.samples - track.concealed;
      }
    }
    if (!pair)
      for (const entry of report.values())
        if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded") pair = entry;
    if (pair) {
      next.rttMs = typeof pair.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null;
      const local = byId.get(pair.localCandidateId);
      const remote = byId.get(pair.remoteCandidateId);
      next.path = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "direct";
    }
    const now = performance.now();
    if (this.previous && now > this.previous.at) {
      const seconds = (now - this.previous.at) / 1000;
      next.bitrateKbps = Math.max(0, ((bytes - this.previous.bytes) * 8) / seconds / 1000);
      const lostNow = Math.max(0, next.lost - this.previous.lost);
      const gotNow = Math.max(0, received - this.previous.received);
      next.lossRate = lostNow + gotNow ? lostNow / (lostNow + gotNow) : 0;
    }
    if (track) {
      const rates = trackRates(
        track,
        this.previous?.track ?? null,
        this.previous ? (now - this.previous.at) / 1000 : 0,
      );
      next.audioKbps = rates.kbps;
      next.audioBufferMs = rates.bufferMs;
      next.audioConcealed = rates.concealed;
    }
    this.previous = { at: now, bytes, lost: next.lost, received, track };
    this.stats = next;
    return next;
  }

  private set(state: LinkState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onChange();
  }

  private drop() {
    this.pad = null;
    this.queued = [];
    this.previous = null;
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.close();
    }
    this.pc = null;
    this.stream = null;
  }

  /** Leaving: the host hears it at once. */
  close(sayBye = true) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.asker);
    if (sayBye) this.options.signal(this.options.hostDevice, "bye", null);
    this.drop();
    this.state = "closed";
  }
}
