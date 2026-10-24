import { describe, expect, it } from "vitest";
import { audioHello, readAudioHello, stereoOpus, trackFrom, trackRates } from "../lib/shareOpus";

const answer = [
  "v=0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=rtpmap:96 H264/90000",
  "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "a=recvonly",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "",
].join("\r\n");

describe("share play sound", () => {
  it("says hello in the launcher's words", () => {
    // The same text the launcher's ShareAudioHello writes and reads.
    expect(audioHello()).toBe('{"type":"audio-hello","v":1,"codecs":["opus","pcm"]}');
    expect(readAudioHello(audioHello())).toEqual(["opus", "pcm"]);
    expect(readAudioHello('{"type":"audio-hello","v":2,"codecs":["lyra","pcm"]}')).toEqual(["pcm"]);
    expect(readAudioHello('{"type":"other","codecs":["opus"]}')).toBeNull();
    expect(readAudioHello("nope")).toBeNull();
  });

  it("asks for stereo Opus in the answer and changes nothing else", () => {
    const out = stereoOpus(answer);
    expect(out).toContain("a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1\r\n");
    expect(out).toContain(
      "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f\r\n",
    );
    expect(out).toContain("a=fmtp:63 111/111\r\n");
    expect(stereoOpus(out)).toBe(out);
    expect(stereoOpus(answer.replace("minptime=10;useinbandfec=1", "stereo=0"))).toContain(
      "a=fmtp:111 stereo=1;sprop-stereo=1\r\n",
    );
    const bare = answer.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", "");
    expect(stereoOpus(bare)).toContain("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;sprop-stereo=1\r\n");
    // The answers of a launcher from before the track: no audio section, nothing to change.
    const old = answer.split("m=audio")[0] ?? "";
    expect(stereoOpus(old)).toBe(old);
  });

  it("reads the track's rate, hold and losses between two reports", () => {
    const before = trackFrom({
      bytesReceived: 100_000,
      jitterBufferDelay: 10,
      jitterBufferEmittedCount: 200_000,
      totalSamplesReceived: 200_000,
      concealedSamples: 100,
    });
    const now = trackFrom({
      bytesReceived: 116_000,
      jitterBufferDelay: 1930,
      jitterBufferEmittedCount: 248_000,
      totalSamplesReceived: 248_000,
      concealedSamples: 580,
    });
    const rates = trackRates(now, before, 1);
    expect(rates.kbps).toBeCloseTo(128);
    expect(rates.bufferMs).toBeCloseTo(40);
    expect(rates.concealed).toBeCloseTo(0.01);
    expect(trackRates(now, null, 1).kbps).toBeNull();
    expect(trackFrom({}).bytes).toBe(0);
  });
});
