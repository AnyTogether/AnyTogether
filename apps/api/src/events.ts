import { type GatewayEvent, userChannel, userEvents } from "@anytogether/shared";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";

/** Sends an event to every gateway holding one of the user's sockets, and keeps it five minutes
 *  for a socket that reconnects. */
export async function publish(valkey: Redis, userId: string, event: GatewayEvent) {
  const id = uuidv7();
  const message = JSON.stringify({ id, ...event });
  await valkey
    .multi()
    .xadd(userEvents(userId), "MINID", "~", `${Date.now() - 5 * 60_000}`, "*", "event", message)
    .publish(userChannel(userId), message)
    .exec();
  return id;
}

/** Revoked sessions, kept as long as an access token of theirs could still be valid. */
export const revokedKey = (sessionId: string) => `revoked:${sessionId}`;
