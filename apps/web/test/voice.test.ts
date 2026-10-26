import { afterEach, describe, expect, it, vi } from "vitest";
import { voiceEn, voiceTr } from "../lib/i18n-voice";
import {
  VoiceMesh,
  audioConstraints,
  loadNoiseSuppression,
  noiseSuppressionKey,
  processingMatches,
  saveNoiseSuppression,
} from "../lib/voice";

/** A microphone track as far as the switch needs one. */
function fakeTrack(settings: MediaTrackSettings, apply: (c: MediaTrackConstraints) => Promise<void>) {
  const track = {
    kind: "audio",
    enabled: true,
    stopped: false,
    settings,
    applyConstraints: vi.fn(async (c: MediaTrackConstraints) => {
      await apply(c);
    }),
    getSettings: () => track.settings,
    stop: () => {
      track.stopped = true;
    },
  };
  return track;
}

function fakeStream(tracks: unknown[]) {
  const list = [...tracks];
  return {
    getAudioTracks: () => list,
    getTracks: () => list,
    removeTrack: (t: unknown) => list.splice(list.indexOf(t), 1),
    addTrack: (t: unknown) => list.push(t),
  };
}

/** The mesh's state as setNoiseSuppression reads it: the stream, the connections, talking. */
function fakeMesh(track: ReturnType<typeof fakeTrack>) {
  const sender: { track: unknown; replaceTrack: ReturnType<typeof vi.fn> } = {
    track,
    replaceTrack: vi.fn(async (t: unknown) => {
      sender.track = t;
    }),
  };
  const mesh = {
    stream: fakeStream([track]),
    peers: new Map([["b", { pc: { getSenders: () => [sender] } }]]),
    talking: false,
    local: null,
    analyse: vi.fn(() => "analyser"),
  };
  return { mesh, sender };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("noise suppression in voice", () => {
  it("asks for it, with echo cancellation and gain always on", () => {
    expect(audioConstraints(true)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    });
    expect(audioConstraints(false)).toMatchObject({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  it("is on until turned off, and on where storage is shut", () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    expect(loadNoiseSuppression(storage)).toBe(true);
    saveNoiseSuppression(false, storage);
    expect(kept.get(noiseSuppressionKey)).toBe("off");
    expect(loadNoiseSuppression(storage)).toBe(false);
    saveNoiseSuppression(true, storage);
    expect(loadNoiseSuppression(storage)).toBe(true);
    const shut = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadNoiseSuppression(shut)).toBe(true);
    expect(loadNoiseSuppression(undefined)).toBe(true);
  });

  it("changes the live track when the browser lets it, nothing reconnecting", async () => {
    const track = fakeTrack({ noiseSuppression: true }, async (c) => {
      track.settings = { noiseSuppression: c.noiseSuppression as boolean };
    });
    const { mesh, sender } = fakeMesh(track);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await VoiceMesh.prototype.setNoiseSuppression.call(mesh as unknown as VoiceMesh, false);
    expect(track.applyConstraints).toHaveBeenCalledWith(audioConstraints(false));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(sender.replaceTrack).not.toHaveBeenCalled();
    expect(track.stopped).toBe(false);
  });

  it("puts a new track on every connection when the browser will not change it", async () => {
    // Chrome takes the constraints and keeps the processing: the settings still say true.
    const track = fakeTrack({ noiseSuppression: true }, async () => {});
    const replacement = fakeTrack({ noiseSuppression: false }, async () => {});
    const { mesh, sender } = fakeMesh(track);
    const getUserMedia = vi.fn(async () => fakeStream([replacement]));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await VoiceMesh.prototype.setNoiseSuppression.call(mesh as unknown as VoiceMesh, false);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: audioConstraints(false), video: false });
    expect(sender.replaceTrack).toHaveBeenCalledWith(replacement);
    expect(sender.track).toBe(replacement);
    expect(track.stopped).toBe(true);
    expect(replacement.enabled).toBe(false);
    expect(mesh.stream.getAudioTracks()).toEqual([replacement]);
    expect(mesh.analyse).toHaveBeenCalled();
  });

  it("takes a browser that does not report its processing at its word", () => {
    expect(processingMatches({}, false)).toBe(true);
    expect(processingMatches({ noiseSuppression: false }, false)).toBe(true);
    expect(processingMatches({ noiseSuppression: true }, false)).toBe(false);
  });

  it("is said in both languages", () => {
    expect(Object.keys(voiceTr).sort()).toEqual(Object.keys(voiceEn).sort());
  });
});
