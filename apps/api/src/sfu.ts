import {
  type MediaLimits,
  type SfuAccess,
  maxPartySize,
  maxSfuPartySize,
  maxSfuShareViewers,
  maxShareViewers,
  sfuTokenSeconds,
} from "@anytogether/shared";
import { SignJWT } from "jose";

/** The media server's settings (LIVEKIT_* and SFU_* in the environment). */
export interface SfuSettings {
  /** The WebSocket URL clients connect to (wss://…). */
  url: string;
  /** Where the API reaches LiveKit's server API (http://livekit:7880 in the Compose file); the
   *  client URL with http(s) in place of ws(s) when left empty. */
  apiUrl?: string;
  apiKey: string;
  apiSecret: string;
  maxShareViewers?: number;
  maxPartySize?: number;
  /** How LiveKit is asked (the tests answer themselves). */
  fetch?: typeof fetch;
}

/** What a token lets its holder do in the room. */
export interface SfuGrant {
  publish: boolean;
}

/** A limit from the environment, kept between the mesh's and the hard cap. */
const bounded = (value: number | undefined, mesh: number, cap: number, fallback: number) =>
  Number.isInteger(value) && (value as number) > mesh ? Math.min(value as number, cap) : fallback;

/** The media server (LiveKit): room tokens for the clients, and taking people out and closing rooms
 *  when the API says so. LiveKit makes a room when the first person joins it and closes it soon
 *  after the last one left; the API closes it at once when the share play or call ends. Nothing
 *  that fails here stops the share play or the call: the token's short life is the backstop. */
export function sfuService(settings: SfuSettings) {
  const secret = new TextEncoder().encode(settings.apiSecret);
  const apiUrl = (settings.apiUrl || settings.url.replace(/^ws(s?):/, "http$1:")).replace(/\/+$/, "");
  const ask = settings.fetch ?? fetch;
  const limits: MediaLimits = {
    sfu: true,
    maxShareViewers: bounded(settings.maxShareViewers, maxShareViewers, maxSfuShareViewers, 16),
    maxPartySize: bounded(settings.maxPartySize, maxPartySize, maxSfuPartySize, 24),
  };

  const sign = (claims: Record<string, unknown>, identity: string, seconds: number, now: number) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(settings.apiKey)
      .setSubject(identity)
      .setNotBefore(Math.floor(now / 1000) - 10)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + seconds)
      .sign(secret);

  /** A token for one room: everyone may watch and listen; only `publish` may send media. Nobody
   *  sends data through the media server (a viewer's pad goes straight to the host). */
  async function access(
    room: string,
    identity: string,
    grant: SfuGrant,
    now = Date.now(),
  ): Promise<SfuAccess> {
    const token = await sign(
      {
        video: {
          room,
          roomJoin: true,
          canSubscribe: true,
          canPublish: grant.publish,
          canPublishData: false,
          canUpdateOwnMetadata: false,
        },
      },
      identity,
      sfuTokenSeconds,
      now,
    );
    return {
      url: settings.url,
      token,
      room,
      identity,
      expiresAt: new Date(now + sfuTokenSeconds * 1000).toISOString(),
    };
  }

  /** One call to LiveKit's server API (Twirp, JSON); false when it did not take it. */
  async function service(method: string, body: Record<string, unknown>, room: string) {
    try {
      const token = await sign(
        { video: { room, roomAdmin: true, roomCreate: true } },
        "anytogether-api",
        60,
        Date.now(),
      );
      const response = await ask(`${apiUrl}/twirp/livekit.RoomService/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      // A room or person already gone is fine.
      if (!response.ok && response.status !== 404)
        console.warn(`media server: ${method} answered ${response.status}`);
      return response.ok;
    } catch (error) {
      console.warn(`media server: ${method} failed:`, (error as Error).message);
      return false;
    }
  }

  return {
    limits,
    access,
    /** Takes someone out of a room now (left, or taken out by the host). */
    remove: (room: string, identity: string) => service("RemoveParticipant", { room, identity }, room),
    /** Closes a room now: everyone in it is let go. */
    close: (room: string) => service("DeleteRoom", { room }, room),
  };
}

export type SfuService = ReturnType<typeof sfuService>;

/** What a server without a media server holds: the mesh limits. */
export const meshLimits: MediaLimits = { sfu: false, maxShareViewers, maxPartySize };

export const mediaLimits = (sfu: SfuService | undefined): MediaLimits => sfu?.limits ?? meshLimits;
