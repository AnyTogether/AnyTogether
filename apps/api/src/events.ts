import { type GatewayEvent, topicChannel, userChannel, userEvents } from "@anytogether/shared";
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

/** Tells every socket watching a public topic (the board, the public lists); nothing is kept for
 *  a socket that reconnects, which reads the list again anyway. */
export async function broadcast(valkey: Redis, topics: string[], event: GatewayEvent) {
  const message = JSON.stringify({ id: uuidv7(), ...event });
  const write = valkey.multi();
  for (const topic of new Set(topics)) write.publish(topicChannel(topic), message);
  await write.exec();
}

/** A board or list topic, and the same for one game. */
export const topicsFor = (topic: "lfg" | "discover", titleId: string | null | undefined) =>
  titleId ? [topic, `${topic}:${titleId}`] : [topic];
