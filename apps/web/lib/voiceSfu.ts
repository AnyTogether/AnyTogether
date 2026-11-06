import type { SfuAccess } from "@/lib/share";
import { VoiceMesh, type VoiceState, audioConstraints, processingMatches } from "@/lib/voice";

/** What the page hears from the room. */
export interface VoiceRoomEvents {
  /** Someone's voice arrived (a track), or went (null). */
  onVoice(userId: string, track: MediaStreamTrack | null): void;
  /** Who in the room is speaking now (LiveKit's active speakers). */
  onSpeakers(userIds: string[]): void;
  /** Someone came into the room or left it. */
  onPeople(userIds: string[]): void;
  onState(state: RTCPeerConnectionState): void;
}

export interface VoiceRoomHandle {
  /** Sends the microphone or not. */
  setMuted(muted: boolean): Promise<void>;
  /** Another microphone track in place of the one sent (noise suppression changed). */
  replaceMic(track: MediaStreamTrack): Promise<void>;
  close(): void;
}

export type JoinVoiceRoom = (
  access: SfuAccess,
  mic: MediaStreamTrack,
  muted: boolean,
  events: VoiceRoomEvents,
) => Promise<VoiceRoomHandle>;

/** Into the room with LiveKit's client, loaded only when a call needs it: the microphone as one
 *  Opus track (DTX and redundancy for lost packets), everyone else's voices as they come. */
export const joinLiveKitVoice: JoinVoiceRoom = async (access, mic, muted, events) => {
  const { Room, RoomEvent, ConnectionState, Track } = await import("livekit-client");
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const people = () => [...room.remoteParticipants.values()].map((p) => p.identity);
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Audio) events.onVoice(participant.identity, track.mediaStreamTrack);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Audio) events.onVoice(participant.identity, null);
  });
  room.on(RoomEvent.ParticipantConnected, () => events.onPeople(people()));
  room.on(RoomEvent.ParticipantDisconnected, () => events.onPeople(people()));
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => events.onSpeakers(speakers.map((p) => p.identity)));
  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (state === ConnectionState.Connected) events.onState("connected");
    else if (state === ConnectionState.Disconnected) events.onState("failed");
    else events.onState("connecting");
  });
  events.onState("connecting");
  await room.connect(access.url, access.token, { autoSubscribe: true });
  events.onPeople(people());
  const published = await room.localParticipant.publishTrack(mic, {
    source: Track.Source.Microphone,
    dtx: true,
    red: true,
  });
  if (muted) await published.mute();
  return {
    async setMuted(on) {
      if (on) await published.mute();
      else await published.unmute();
    },
    async replaceMic(track) {
      await published.audioTrack?.replaceTrack(track, { userProvidedTrack: true });
    },
    close() {
      room.disconnect().catch(() => {});
    },
  };
};

interface Voice {
  userId: string;
  audio: HTMLAudioElement | null;
  speaking: boolean;
}

/** Party voice through the server's media server, once a call has more voices than the mesh
 *  holds: the microphone goes up once, and everyone's voice comes down from the server. It has
 *  the same face as VoiceMesh, so the party page treats both alike; there is nothing to signal. */
export class VoiceRoom {
  readonly route = "sfu" as const;
  private stream: MediaStream | null;
  private voices = new Map<string, Voice>();
  private handle: VoiceRoomHandle | null = null;
  private connection: RTCPeerConnectionState = "new";
  private talking = false;
  private deafened = false;
  private closed = false;
  private context: AudioContext | null = null;
  private local: AnalyserNode | null = null;
  private level = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly options: {
      me: string;
      stream: MediaStream;
      access: SfuAccess;
      onChange: () => void;
      join?: JoinVoiceRoom;
    },
  ) {
    this.stream = options.stream;
    if (typeof AudioContext !== "undefined") {
      this.context = new AudioContext();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      this.context.createMediaStreamSource(options.stream).connect(analyser);
      this.local = analyser;
      this.timer = setInterval(() => this.measure(), 100);
    }
  }

  /** Into the room; the microphone starts as `talking` says. */
  async start() {
    const mic = this.stream?.getAudioTracks()[0];
    if (!mic) throw new Error("no microphone");
    const join = this.options.join ?? joinLiveKitVoice;
    const handle = await join(this.options.access, mic, !this.talking, {
      onVoice: (userId, track) => this.voice(userId, track),
      onSpeakers: (userIds) => {
        const now = new Set(userIds);
        for (const voice of this.voices.values()) voice.speaking = now.has(voice.userId);
        this.options.onChange();
      },
      onPeople: (userIds) => {
        const now = new Set(userIds.filter((id) => id !== this.options.me));
        for (const userId of [...this.voices.keys()]) if (!now.has(userId)) this.voice(userId, null, true);
        for (const userId of now)
          if (!this.voices.has(userId)) this.voices.set(userId, { userId, audio: null, speaking: false });
        this.options.onChange();
      },
      onState: (state) => {
        this.connection = state;
        this.options.onChange();
      },
    });
    if (this.closed) return handle.close();
    this.handle = handle;
    await handle.setMuted(!this.talking);
  }

  private voice(userId: string, track: MediaStreamTrack | null, gone = false) {
    if (userId === this.options.me) return;
    const known = this.voices.get(userId);
    if (known?.audio) {
      known.audio.srcObject = null;
      known.audio = null;
    }
    if (gone) {
      this.voices.delete(userId);
      this.options.onChange();
      return;
    }
    let audio: HTMLAudioElement | null = null;
    if (track) {
      audio = new Audio();
      audio.autoplay = true;
      audio.muted = this.deafened;
      audio.srcObject = new MediaStream([track]);
      audio.play().catch(() => {});
    }
    this.voices.set(userId, { userId, audio, speaking: known?.speaking ?? false });
    this.options.onChange();
  }

  /** Sends the microphone or not (muted, or push-to-talk not held). */
  setTalking(on: boolean) {
    this.talking = on;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = on;
    this.handle?.setMuted(!on).catch(() => {});
  }

  /** Hears no one, or everyone again. */
  setDeafened(on: boolean) {
    this.deafened = on;
    for (const voice of this.voices.values()) if (voice.audio) voice.audio.muted = on;
  }

  /** As VoiceMesh: the track changes its processing, or a new one takes its place. */
  async setNoiseSuppression(on: boolean) {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints(audioConstraints(on));
      if (processingMatches(track.getSettings(), on)) return;
    } catch {}
    const fresh = await VoiceMesh.microphone(on);
    const replacement = fresh.getAudioTracks()[0];
    if (!replacement || !this.stream) {
      for (const t of fresh.getTracks()) t.stop();
      return;
    }
    replacement.enabled = this.talking;
    await this.handle?.replaceMic(replacement);
    this.stream.removeTrack(track);
    this.stream.addTrack(replacement);
    track.stop();
  }

  // Nothing to do here: the media server connects everyone.
  async connectTo() {}
  async onSignal() {}
  drop() {}

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.handle?.close();
    this.handle = null;
    for (const voice of this.voices.values()) if (voice.audio) voice.audio.srcObject = null;
    this.voices.clear();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.context?.close().catch(() => {});
  }

  state(): VoiceState {
    return {
      peers: [...this.voices.values()].map((voice) => ({
        userId: voice.userId,
        state: this.connection,
        speaking: voice.speaking,
      })),
      speaking: this.talking && this.level > 0.02,
      level: this.level,
    };
  }

  private measure() {
    if (!this.local) return;
    const samples = new Float32Array(this.local.fftSize);
    this.local.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = this.talking ? Math.sqrt(sum / samples.length) : 0;
    if (Math.abs(level - this.level) > 0.004) {
      this.level = level;
      this.options.onChange();
    }
  }
}
