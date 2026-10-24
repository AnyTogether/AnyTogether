/** How the game's sound reaches this viewer, agreed with the host per viewer.
 *
 *  Every host sends 16-bit stereo PCM on the "audio" data channel (~1.5 Mbit/s). A viewer that can
 *  play an Opus audio track says so with a text message on that channel once it opens; a launcher
 *  that understands it adds the game's sound to the connection as a WebRTC audio track (Opus,
 *  stereo, ~128 kbit/s, with the browser's own jitter buffer, loss concealment and lip sync to the
 *  picture), offers again, and stops the PCM once this answer takes the track. Older launchers
 *  ignore the hello and keep sending PCM, which this page still plays. */

export type AudioCodec = "opus" | "pcm";

export const helloType = "audio-hello";

/** The hello sent on the "audio" channel (text; the PCM packets are binary). */
export function audioHello(codecs: AudioCodec[] = ["opus", "pcm"]) {
  return JSON.stringify({ type: helloType, v: 1, codecs });
}

/** A hello read back (for tests and tools); unknown codecs are left out. */
export function readAudioHello(text: string): AudioCodec[] | null {
  try {
    const value = JSON.parse(text) as { type?: unknown; codecs?: unknown };
    if (value.type !== helloType || !Array.isArray(value.codecs)) return null;
    return value.codecs.filter((codec): codec is AudioCodec => codec === "opus" || codec === "pcm");
  } catch {
    return null;
  }
}

/** Whether this browser can take the track: Opus is in every WebRTC browser, so whenever it has
 *  RTCPeerConnection, unless the receiver's capabilities say otherwise. */
export function canPlayOpusTrack() {
  if (typeof RTCPeerConnection === "undefined") return false;
  const capabilities =
    typeof RTCRtpReceiver !== "undefined" && typeof RTCRtpReceiver.getCapabilities === "function"
      ? RTCRtpReceiver.getCapabilities("audio")
      : null;
  return !capabilities || capabilities.codecs.some((codec) => /opus/i.test(codec.mimeType));
}

/** The answer asking for stereo on every Opus format: browsers decode Opus as mono unless their
 *  own description asks for stereo. Nothing else changes. */
export function stereoOpus(sdp: string) {
  const payloads = [...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/gi)].map((match) => match[1]);
  if (!payloads.length) return sdp;
  const newline = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(newline);
  for (const payload of payloads) {
    const prefix = `a=fmtp:${payload} `;
    const index = lines.findIndex((line) => line.startsWith(prefix));
    if (index >= 0) {
      const pairs = (lines[index] ?? "")
        .slice(prefix.length)
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split("=") as [string, string?]);
      for (const key of ["stereo", "sprop-stereo"]) {
        const found = pairs.find(([name]) => name.toLowerCase() === key);
        if (found) found[1] = "1";
        else pairs.push([key, "1"]);
      }
      lines[index] =
        prefix + pairs.map(([name, value]) => (value === undefined ? name : `${name}=${value}`)).join(";");
    } else {
      const rtpmap = lines.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `));
      if (rtpmap >= 0) lines.splice(rtpmap + 1, 0, `${prefix}stereo=1;sprop-stereo=1`);
    }
  }
  return lines.join(newline);
}

/** The Opus track's numbers from one inbound-rtp report and the one before it. */
export interface TrackStats {
  bytes: number;
  delay: number;
  emitted: number;
  samples: number;
  concealed: number;
}

export function trackFrom(entry: Record<string, unknown>): TrackStats {
  const number = (key: string) => (typeof entry[key] === "number" ? (entry[key] as number) : 0);
  return {
    bytes: number("bytesReceived"),
    delay: number("jitterBufferDelay"),
    emitted: number("jitterBufferEmittedCount"),
    samples: number("totalSamplesReceived"),
    concealed: number("concealedSamples"),
  };
}

/** Over the time between two reports: kbit/s, the jitter buffer's hold in ms, and the share of
 *  samples made up for lost packets. */
export function trackRates(now: TrackStats, before: TrackStats | null, seconds: number) {
  const emitted = now.emitted - (before?.emitted ?? 0);
  const samples = now.samples - (before?.samples ?? 0);
  return {
    kbps: before && seconds > 0 ? Math.max(0, ((now.bytes - before.bytes) * 8) / seconds / 1000) : null,
    bufferMs: emitted > 0 ? ((now.delay - (before?.delay ?? 0)) / emitted) * 1000 : null,
    concealed: samples > 0 ? Math.max(0, now.concealed - (before?.concealed ?? 0)) / samples : 0,
  };
}
