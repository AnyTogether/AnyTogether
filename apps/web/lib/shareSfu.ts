import type { SfuAccess } from "@/lib/share";
import type { ShareAudio } from "@/lib/shareAudio";
import { type LinkState, type LinkStats, type StatsSample, readLinkStats } from "@/lib/shareConnection";

/** The room as this page needs it: the host's tracks come in, the connection's state changes,
 *  and the receivers' statistics. */
export interface SfuHandle {
  /** Every receiver's statistics entries together. */
  stats(): Promise<unknown[]>;
  close(): void;
}

export interface SfuEvents {
  /** One of the host's tracks arrived (the game's picture or sound). */
  onTrack(track: MediaStreamTrack): void;
  /** The host's track went (they stopped publishing it). */
  onTrackGone(track: MediaStreamTrack): void;
  onState(state: LinkState): void;
}

export type JoinRoom = (access: SfuAccess, hostId: string, events: SfuEvents) => Promise<SfuHandle>;

/** Into the room with LiveKit's client, loaded only when a share play needs it. Only the host's
 *  tracks are taken; the picture is shown as it comes, with as little waiting as the browser
 *  allows. */
export const joinLiveKit: JoinRoom = async (access, hostId, events) => {
  const { Room, RoomEvent, ConnectionState, Track } = await import("livekit-client");
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const tracks = new Set<{ getRTCStatsReport(): Promise<RTCStatsReport | undefined> }>();
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (participant.identity !== hostId) return;
    const receiver = (track as unknown as { receiver?: RTCRtpReceiver & { playoutDelayHint?: number } })
      .receiver;
    try {
      if (receiver) receiver.jitterBufferTarget = 0;
    } catch {}
    try {
      if (receiver) receiver.playoutDelayHint = 0;
    } catch {}
    if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;
    tracks.add(track);
    events.onTrack(track.mediaStreamTrack);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    if (participant.identity !== hostId) return;
    tracks.delete(track);
    events.onTrackGone(track.mediaStreamTrack);
  });
  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (state === ConnectionState.Connected) events.onState("connected");
    else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting)
      events.onState("reconnecting");
    else if (state === ConnectionState.Disconnected) events.onState("failed");
    else events.onState("connecting");
  });
  events.onState("connecting");
  await room.connect(access.url, access.token, { autoSubscribe: true });
  return {
    async stats() {
      const all: unknown[] = [];
      for (const track of tracks) {
        const report = await track.getRTCStatsReport().catch(() => undefined);
        if (report) for (const entry of report.values()) all.push(entry);
      }
      return all;
    },
    close() {
      room.disconnect().catch(() => {});
    },
  };
};

const emptyStats = (): LinkStats => readLinkStats([], null).stats;

/** Watching through the server's media server: the host publishes the game once, and this page
 *  takes its picture and sound from there. Nothing goes back: a viewer with a pad watches
 *  straight from the host instead (ShareConnection). It has the same face as ShareConnection, so
 *  the page treats both alike. */
export class ShareRoom {
  readonly route = "sfu" as const;
  state: LinkState = "waiting";
  stream: MediaStream | null = null;
  stats: LinkStats = emptyStats();
  readonly padOpen = false;
  private handle: SfuHandle | null = null;
  private opening: Promise<void> | null = null;
  private previous: StatsSample | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** Which opening the room's callbacks belong to; older ones are not listened to. */
  private generation = 0;

  constructor(
    private readonly options: {
      hostId: string;
      /** The room, when the join answer brought it; asked for with `renew` otherwise. */
      access: SfuAccess | null;
      /** A fresh token (GET /share-plays/:id/sfu); null when there is none to be had. */
      renew: () => Promise<SfuAccess | null>;
      audio: ShareAudio;
      onChange: () => void;
      join?: JoinRoom;
    },
  ) {}

  start() {
    this.open(this.options.access);
  }

  /** Back in with a fresh token when the room was lost (the socket came back, or it failed). */
  askAgain() {
    if (this.closed || this.state === "connected" || this.state === "reconnecting") return;
    this.open(null);
  }

  setIceServers() {}
  onSignal() {}
  sendPad() {
    return false;
  }

  private open(access: SfuAccess | null) {
    if (this.closed || this.opening) return;
    clearTimeout(this.retry);
    this.opening = (async () => {
      this.drop();
      const generation = ++this.generation;
      const current = () => generation === this.generation && !this.closed;
      this.set("connecting");
      try {
        const fresh = access ?? (await this.options.renew());
        if (this.closed) return;
        if (!fresh) return this.set("failed");
        const join = this.options.join ?? joinLiveKit;
        const handle = await join(fresh, this.options.hostId, {
          onTrack: (track) => {
            if (current()) this.track(track);
          },
          onTrackGone: (track) => {
            if (current() && track.kind === "video" && this.stream?.getVideoTracks().includes(track)) {
              this.stream = null;
              this.options.onChange();
            }
          },
          onState: (state) => {
            if (!current()) return;
            this.set(state);
            // LiveKit gave up on its own reconnecting: in again with a fresh token, after a breath.
            if (state === "failed") this.retry = setTimeout(() => this.open(null), 3000);
          },
        });
        if (!current()) return handle.close();
        this.handle = handle;
      } catch {
        if (!current()) return;
        this.set("failed");
        this.retry = setTimeout(() => this.open(null), 3000);
      }
    })().finally(() => {
      this.opening = null;
    });
  }

  private track(track: MediaStreamTrack) {
    if (track.kind === "audio") {
      this.options.audio.playTrack(track);
      return;
    }
    if (track.kind !== "video") return;
    this.stream = new MediaStream([track]);
    this.options.onChange();
  }

  async measure() {
    if (!this.handle) return this.stats;
    const { stats, sample } = readLinkStats(await this.handle.stats().catch(() => []), this.previous);
    this.previous = sample;
    // Not straight from the host, whatever the candidates say.
    this.stats = { ...stats, path: "server" };
    return this.stats;
  }

  private set(state: LinkState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onChange();
  }

  private drop() {
    this.handle?.close();
    this.handle = null;
    this.stream = null;
    this.previous = null;
  }

  /** Leaving: out of the room (the API takes the seat away as well). */
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.retry);
    this.drop();
    this.state = "closed";
  }
}
