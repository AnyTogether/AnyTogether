/** What the API adds to a user's presence beside the devices' own state: the party they are in,
 *  the game session they host, the game they share. Kept in a Valkey hash, one JSON value per field. */
export const presenceExtras = ["party", "game", "share"] as const;
export type PresenceExtra = (typeof presenceExtras)[number];

export const presenceExtraKey = (userId: string) => `presence-extra:${userId}`;

/** The devices' merged presence with the extras on top, always in the same key order, so the
 *  gateway and the API make the same string and a friend is told only of real changes. Clients
 *  can only set state, titleId and since. */
export function withExtras<T extends { state: string }>(
  base: T,
  extras: Record<string, string>,
): T & Partial<Record<PresenceExtra, unknown>> {
  const { state, titleId, since } = base as { state: string; titleId?: string; since?: string };
  const merged: Record<string, unknown> = { state };
  if (titleId !== undefined) merged.titleId = titleId;
  if (since !== undefined) merged.since = since;
  if (state !== "offline")
    for (const field of presenceExtras)
      if (extras[field]) merged[field] = JSON.parse(extras[field] as string);
  return merged as T;
}
