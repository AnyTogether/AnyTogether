import {
  type PresenceExtra,
  friendsKey,
  presenceExtraKey,
  presenceKey,
  withExtras,
} from "@anytogether/shared";
import type { Redis } from "ioredis";
import { publish } from "./events.js";

/** Sets or clears what the API adds to a user's presence (their party, the game they host). When
 *  they are online, the merged presence the gateway keeps is rewritten and friends are told; when
 *  they are offline the gateway adds it as soon as they come back. */
export async function setPresenceExtra(
  valkey: Redis,
  userId: string,
  field: PresenceExtra,
  value: object | null,
) {
  const key = presenceExtraKey(userId);
  if (value) await valkey.hset(key, field, JSON.stringify(value));
  else await valkey.hdel(key, field);
  const stored = await valkey.get(presenceKey(userId));
  if (!stored) return;
  const next = JSON.stringify(withExtras(JSON.parse(stored), await valkey.hgetall(key)));
  if (next === stored) return;
  await valkey.set(presenceKey(userId), next, "KEEPTTL");
  for (const friend of await valkey.smembers(friendsKey(userId)))
    await publish(valkey, friend, { type: "presence.updated", data: { userId, ...JSON.parse(next) } });
}
