/** The host's game sound as it arrives on the "audio" data channel (5 ms of 16-bit stereo at
 *  48 kHz a packet), played with a small jitter buffer: playback starts once ~50 ms are queued,
 *  anything beyond ~150 ms is dropped so it never drifts behind the picture, and an underrun plays
 *  silence until the buffer has filled again. */

export interface AudioStats {
  /** Frames (48 kHz) handed to the speakers, received, and thrown away for being late or too many. */
  played: number;
  received: number;
  dropped: number;
  underruns: number;
  /** Milliseconds queued now. */
  bufferedMs: number;
}

/** The ring itself, shared by the worklet and the fallback. It must not reference anything outside
 *  itself: its source is copied into the worklet as it is. */
class PcmRing {
  buf: Float32Array;
  r = 0;
  w = 0;
  n = 0;
  frac = 0;
  primed = false;
  played = 0;
  received = 0;
  dropped = 0;
  underruns = 0;
  target: number;
  max: number;
  step: number;
  constructor(outputRate: number) {
    this.buf = new Float32Array(48000 * 2);
    this.target = 2400;
    this.max = 7200;
    this.step = 48000 / outputRate;
  }
  push(samples: Int16Array) {
    const frames = samples.length >> 1;
    const room = this.buf.length >> 1;
    if (frames >= room) return;
    this.received += frames;
    if (this.n + frames > this.max) {
      const drop = Math.min(this.n, this.n + frames - this.target);
      this.r = (this.r + drop * 2) % this.buf.length;
      this.n -= drop;
      this.dropped += drop;
    }
    for (let i = 0; i < frames * 2; i++) {
      this.buf[this.w] = (samples[i] ?? 0) / 32768;
      this.w = (this.w + 1) % this.buf.length;
    }
    this.n += frames;
  }
  render(left: Float32Array, right: Float32Array) {
    const length = left.length;
    if (!this.primed && this.n >= this.target) this.primed = true;
    for (let i = 0; i < length; i++) {
      if (!this.primed || this.n < 2) {
        if (this.primed) {
          this.primed = false;
          this.underruns++;
        }
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const len = this.buf.length;
      const next = (this.r + 2) % len;
      const t = this.frac;
      left[i] = (this.buf[this.r] ?? 0) * (1 - t) + (this.buf[next] ?? 0) * t;
      right[i] = (this.buf[this.r + 1] ?? 0) * (1 - t) + (this.buf[next + 1] ?? 0) * t;
      this.frac += this.step;
      while (this.frac >= 1 && this.n > 0) {
        this.frac -= 1;
        this.r = (this.r + 2) % len;
        this.n--;
        this.played++;
      }
    }
  }
  stats() {
    return {
      played: this.played,
      received: this.received,
      dropped: this.dropped,
      underruns: this.underruns,
      bufferedMs: this.n / 48,
    };
  }
}

const workletSource = () => `
const Ring = (${PcmRing.toString()});
class SharePcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Ring(sampleRate);
    this.since = 0;
    this.port.onmessage = (event) => this.ring.push(new Int16Array(event.data));
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    this.ring.render(left, right);
    this.since += left.length;
    if (this.since >= sampleRate / 4) {
      this.since = 0;
      this.port.postMessage(this.ring.stats());
    }
    return true;
  }
}
registerProcessor("share-pcm", SharePcm);
`;

export class ShareAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private fallback: { ring: PcmRing; processor: ScriptProcessorNode } | null = null;
  private ready: Promise<void> | null = null;
  private lastNumber: number | null = null;
  private volume = 1;
  private muted = false;
  latest: AudioStats = { played: 0, received: 0, dropped: 0, underruns: 0, bufferedMs: 0 };
  /** Packets that came after a newer one (the channel is unordered) and were left out. */
  late = 0;
  packets = 0;

  /** Makes the audio graph; call from a click, or the browser keeps it silent. */
  start() {
    if (this.ready) {
      this.context?.resume().catch(() => {});
      return this.ready;
    }
    this.ready = this.build().catch(() => {});
    return this.ready;
  }

  get running() {
    return this.context?.state === "running";
  }

  private async build() {
    const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    this.context = context;
    const gain = context.createGain();
    gain.connect(context.destination);
    this.gain = gain;
    this.apply();
    try {
      const url = URL.createObjectURL(new Blob([workletSource()], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, "share-pcm", { numberOfInputs: 0, outputChannelCount: [2] });
      node.port.onmessage = (event) => {
        this.latest = event.data as AudioStats;
      };
      node.connect(gain);
      this.node = node;
    } catch {
      // No worklets (an old browser, or not a secure page): the same ring on the page's thread.
      const ring = new PcmRing(context.sampleRate);
      const processor = context.createScriptProcessor(1024, 0, 2);
      processor.onaudioprocess = (event) => {
        ring.render(event.outputBuffer.getChannelData(0), event.outputBuffer.getChannelData(1));
        this.latest = ring.stats();
      };
      processor.connect(gain);
      this.fallback = { ring, processor };
    }
    await context.resume().catch(() => {});
  }

  /** One packet from the channel. */
  push(samples: Int16Array, number: number) {
    this.packets++;
    // Older than what was already queued: dropped (a wrap-around after 2^32 packets counts as new).
    if (this.lastNumber !== null && number <= this.lastNumber && this.lastNumber - number < 2000) {
      this.late++;
      return;
    }
    this.lastNumber = number;
    if (this.node) this.node.port.postMessage(samples.buffer, [samples.buffer]);
    else this.fallback?.ring.push(samples);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.apply();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.apply();
  }

  private apply() {
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.015);
  }

  close() {
    this.node?.disconnect();
    this.fallback?.processor.disconnect();
    this.context?.close().catch(() => {});
    this.context = null;
    this.node = null;
    this.fallback = null;
    this.ready = null;
    this.lastNumber = null;
  }
}
