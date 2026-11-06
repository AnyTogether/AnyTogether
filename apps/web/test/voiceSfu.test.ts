import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SfuAccess } from "../lib/share";
import { type JoinVoiceRoom, VoiceRoom, type VoiceRoomEvents } from "../lib/voiceSfu";

class FakeAudio {
  autoplay = false;
  muted = false;
  srcObject: unknown = null;
  play = async () => {};
}
class FakeStream {
  constructor(readonly tracks: { kind: string; enabled: boolean; stop: () => void }[]) {}
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

const access: SfuAccess = {
  url: "wss://media.test",
  token: "t",
  room: "call-1",
  identity: "me",
  expiresAt: "2026-11-06T10:10:00Z",
};

function fakeJoin() {
  const seen = {
    events: null as VoiceRoomEvents | null,
    mutedAtJoin: null as boolean | null,
    muted: [] as boolean[],
    closed: false,
  };
  const join: JoinVoiceRoom = async (_access, _mic, muted, events) => {
    seen.events = events;
    seen.mutedAtJoin = muted;
    return {
      setMuted: async (on) => {
        seen.muted.push(on);
      },
      replaceMic: async () => {},
      close: () => {
        seen.closed = true;
      },
    };
  };
  return { join, seen };
}

describe("party voice through the media server", () => {
  beforeEach(() => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaStream", FakeStream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("joins muted unless talking, and follows mute, deafen and who is there", async () => {
    const { join, seen } = fakeJoin();
    const mic = { kind: "audio", enabled: true, stopped: false, stop: () => (mic.stopped = true) };
    const room = new VoiceRoom({
      me: "me",
      stream: new FakeStream([mic]) as unknown as MediaStream,
      access,
      onChange() {},
      join,
    });
    room.setTalking(false);
    await room.start();
    expect(seen.mutedAtJoin).toBe(true);
    expect(mic.enabled).toBe(false);
    room.setTalking(true);
    expect(seen.muted.at(-1)).toBe(false);
    expect(mic.enabled).toBe(true);

    const events = seen.events as VoiceRoomEvents;
    events.onState("connected");
    events.onPeople(["me", "b", "c"]);
    events.onVoice("b", { kind: "audio" } as MediaStreamTrack);
    events.onSpeakers(["b"]);
    expect(room.state().peers).toEqual([
      { userId: "b", state: "connected", speaking: true },
      { userId: "c", state: "connected", speaking: false },
    ]);
    room.setDeafened(true);
    events.onVoice("c", { kind: "audio" } as MediaStreamTrack);
    const audios = (room as unknown as { voices: Map<string, { audio: FakeAudio }> }).voices;
    expect([...audios.values()].map((v) => v.audio.muted)).toEqual([true, true]);
    events.onPeople(["b"]);
    expect(room.state().peers.map((p) => p.userId)).toEqual(["b"]);

    room.close();
    expect(seen.closed).toBe(true);
    expect(mic.stopped).toBe(true);
    expect(room.state().peers).toEqual([]);
  });
});
