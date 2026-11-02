/** What the API adds to a user's presence beside the devices' own state: the party they are in,
 *  the game session they host, the game they share. Kept in a Valkey hash, one JSON value per field. */
export const presenceExtras = ["party", "game", "share"] as const;
export type PresenceExtra = (typeof presenceExtras)[number];

export const presenceExtraKey = (userId: string) => `presence-extra:${userId}`;

/** The status a person picks, as Discord has them: Online, Idle, Do Not Disturb and Invisible.
 *  Invisible is the old "appear offline": everyone else sees the person as offline, so it is never
 *  sent to anyone but the person. */
export const presenceStatuses = ["online", "idle", "dnd", "invisible"] as const;
export type PresenceStatus = (typeof presenceStatuses)[number];
/** What others may see: invisible is shown as offline, with no status at all. */
export type ShownStatus = Exclude<PresenceStatus, "invisible">;

/** The extras' field that holds the picked status while it is idle or dnd (online keeps none,
 *  invisible hides the presence altogether). */
export const presenceStatusField = "status";

/** The status a picked one and the devices' state show: a picked Idle or Do Not Disturb wins; else
 *  a device left idle (away) shows Idle, as Discord does after a while. */
export function shownStatus(picked: unknown, state: string): ShownStatus {
  if (picked === "idle" || picked === "dnd") return picked;
  return state === "away" ? "idle" : "online";
}

/** The devices' merged presence with the extras on top, always in the same key order, so the
 *  gateway and the API make the same string and a friend is told only of real changes. Clients
 *  can only set state, titleId and since. While online, `status` says Online, Idle or Do Not
 *  Disturb; a picked Idle also shows as `away` to clients that know only the state (unless in a
 *  game, which stays in_game so the game still shows). */
export function withExtras<T extends { state: string }>(
  base: T,
  extras: Record<string, string>,
): T & Partial<Record<PresenceExtra, unknown>> & { status?: ShownStatus } {
  const { state: own, titleId, since } = base as { state: string; titleId?: string; since?: string };
  const picked = parseField(extras[presenceStatusField]);
  const state = picked === "idle" && (own === "online" || own === "away") ? "away" : own;
  const merged: Record<string, unknown> = { state };
  if (titleId !== undefined) merged.titleId = titleId;
  if (since !== undefined) merged.since = since;
  if (state !== "offline") {
    merged.status = shownStatus(picked, state);
    for (const field of presenceExtras)
      if (extras[field]) merged[field] = JSON.parse(extras[field] as string);
  }
  return merged as T;
}

function parseField(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
