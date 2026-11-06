import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SfuAccess, watchRoute } from "../lib/share";
import type { ShareAudio } from "../lib/shareAudio";
import { type JoinRoom, type SfuEvents, ShareRoom } from "../lib/shareSfu";

const viewer = (userId: string, slot: 2 | 3 | 4 | null) => ({
  user: { userId, handle: userId, displayName: userId, avatar: null },
  device: `${userId}-device`,
  slot,
  joinedAt: "2026-11-06T10:00:00Z",
});

describe("how a viewer watches", () => {
  it("is straight from the host on the mesh, and on older answers", () => {
    expect(watchRoute({ media: "mesh", viewers: [viewer("me", null)] }, "me")).toBe("mesh");
    expect(watchRoute({ viewers: [viewer("me", null)] }, "me")).toBe("mesh");
  });

  it("is from the media server without a pad, and straight from the host with one", () => {
    expect(watchRoute({ media: "sfu", viewers: [viewer("me", null), viewer("b", 2)] }, "me")).toBe("sfu");
    expect(watchRoute({ media: "sfu", viewers: [viewer("me", 3)] }, "me")).toBe("mesh");
    // Not seated yet: from the media server.
    expect(watchRoute({ media: "sfu", viewers: [] }, "me")).toBe("sfu");
  });
});

class FakeStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

const access = (token: string): SfuAccess => ({
  url: "wss://media.test",
  token,
  room: "share-1",
  identity: "me",
  expiresAt: "2026-11-06T10:10:00Z",
});

function fakeRoom() {
  const joined: { token: string; hostId: string; events: SfuEvents; closed: boolean }[] = [];
  const join: JoinRoom = async (sfu, hostId, events) => {
    const entry = { token: sfu.token, hostId, events, closed: false };
    joined.push(entry);
    events.onState("connecting");
    return {
      stats: async () => [
        {
          id: "v",
          type: "inbound-rtp",
          kind: "video",
          framesPerSecond: 60,
          frameHeight: 720,
          framesDecoded: 9,
        },
      ],
      close: () => {
        entry.closed = true;
      },
    };
  };
  return { join, joined };
}

const track = (kind: string) => ({ kind }) as MediaStreamTrack;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("watching from the media server", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaStream", FakeStream);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("joins with the token it was given, shows the host's picture and plays their sound", async () => {
    const { join, joined } = fakeRoom();
    const played: MediaStreamTrack[] = [];
    const audio = { playTrack: (t: MediaStreamTrack) => played.push(t) } as unknown as ShareAudio;
    const renew = vi.fn(async () => access("fresh"));
    const changes = vi.fn();
    const room = new ShareRoom({
      hostId: "host",
      access: access("first"),
      renew,
      audio,
      onChange: changes,
      join,
    });
    room.start();
    await flush();
    expect(joined.map((j) => [j.token, j.hostId])).toEqual([["first", "host"]]);
    expect(renew).not.toHaveBeenCalled();
    expect(room.state).toBe("connecting");
    const events = joined[0]?.events as SfuEvents;
    events.onState("connected");
    const picture = track("video");
    events.onTrack(picture);
    events.onTrack(track("audio"));
    expect(room.state).toBe("connected");
    expect(room.stream?.getVideoTracks()).toEqual([picture]);
    expect(played).toHaveLength(1);
    expect(room.padOpen).toBe(false);
    expect(room.sendPad()).toBe(false);
    expect((await room.measure()).path).toBe("server");
    expect(room.stats.fps).toBe(60);
    events.onTrackGone(picture);
    expect(room.stream).toBeNull();
    room.close();
    expect(joined[0]?.closed).toBe(true);
    expect(room.state).toBe("closed");
  });

  it("asks for a token when it has none, and comes back with a fresh one after LiveKit gave up", async () => {
    vi.useFakeTimers();
    const { join, joined } = fakeRoom();
    let n = 0;
    const renew = vi.fn(async () => access(`fresh-${++n}`));
    const room = new ShareRoom({
      hostId: "host",
      access: null,
      renew,
      audio: { playTrack() {} } as unknown as ShareAudio,
      onChange() {},
      join,
    });
    room.start();
    await flush();
    expect(joined.map((j) => j.token)).toEqual(["fresh-1"]);
    joined[0]?.events.onState("failed");
    expect(room.state).toBe("failed");
    await vi.advanceTimersByTimeAsync(3000);
    expect(joined.map((j) => j.token)).toEqual(["fresh-1", "fresh-2"]);
    expect(joined[0]?.closed).toBe(true);
    // The old room's late news is not listened to.
    joined[0]?.events.onState("connected");
    expect(room.state).toBe("connecting");
    room.close();
  });

  it("stays failed when there is no token to be had", async () => {
    const { join, joined } = fakeRoom();
    const room = new ShareRoom({
      hostId: "host",
      access: null,
      renew: async () => null,
      audio: { playTrack() {} } as unknown as ShareAudio,
      onChange() {},
      join,
    });
    room.start();
    await flush();
    expect(joined).toEqual([]);
    expect(room.state).toBe("failed");
  });
});
