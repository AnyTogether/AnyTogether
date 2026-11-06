/** The optional media server (an SFU, LiveKit) for groups bigger than a peer-to-peer mesh holds.
 *
 *  Share play and party voice are a WebRTC mesh: the host uploads one stream per viewer, and every
 *  party voice talks to every other. That stays as it is for small groups. A server with a media
 *  server configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) also takes a share play
 *  with more than `maxShareViewers` viewers and a party voice call with more than `maxPartySize`
 *  voices: the host publishes once to the media server, which forwards to everyone. A server
 *  without one refuses those, as before. The API mints the tokens; the media never touches it. */

/** The most a share play may ever have with the media server; the server's own limit
 *  (SFU_MAX_SHARE_VIEWERS) may be lower. */
export const maxSfuShareViewers = 50;
/** The most a party may ever hold with the media server; the server's own limit
 *  (SFU_MAX_PARTY_SIZE) may be lower. */
export const maxSfuPartySize = 32;

/** How a share play or a call carries its media: peer to peer, or through the media server. A
 *  share play or call that moved to "sfu" stays there until it ends. */
export const mediaRouteNames = ["mesh", "sfu"] as const;
export type MediaRoute = (typeof mediaRouteNames)[number];

/** What a client connects to the media server with (LiveKit's URL and a token for one room). The
 *  token is short-lived: GET the share play's or the call's `/sfu` again for a fresh one. */
export interface SfuAccess {
  /** The LiveKit server's WebSocket URL (wss://…), as LiveKit's client SDKs take it. */
  url: string;
  token: string;
  /** The room: "share-<share play ID>" or "call-<call ID>". */
  room: string;
  /** This person's identity in the room: their user ID. */
  identity: string;
  expiresAt: string;
}

/** What this server holds (GET /api/v1/media-server): whether it has a media server, and the biggest
 *  share play and party it takes. Without one they are the mesh limits, 4 and 8. */
export interface MediaLimits {
  sfu: boolean;
  maxShareViewers: number;
  maxPartySize: number;
}

/** In the media server, the host's published game picture and sound carry these track names. */
export const sfuTrackNames = { video: "game", audio: "game-audio" } as const;

export const sfuShareRoom = (sharePlayId: string) => `share-${sharePlayId}`;
export const sfuCallRoom = (callId: string) => `call-${callId}`;

/** A call's media route while it is not the mesh ("sfu"); missing means mesh. */
export const callMediaKey = (callId: string) => `call:${callId}:media`;
/** How long a media server token works for joining; a connected client keeps its place. */
export const sfuTokenSeconds = 10 * 60;
