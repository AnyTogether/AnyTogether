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

/** What someone listens to now, as their launcher reads it from the system's media session and
 *  sends it in its heartbeat while the person shares it. It lives only with the live presence (the
 *  device's own, then the merged one): never in the database, gone with the heartbeat, and shown
 *  to friends only. */
export interface Listening {
  title: string;
  artist?: string;
}

/** The most characters of a title or an artist that are kept. */
export const listeningMaxLength = 120;

/** Control characters, line separators and the marks that turn the direction of the text after
 *  them: none of them belongs in a line shown beside someone's name. */
const unshown = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

function listeningText(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(unshown, "").trim();
  return [...clean].slice(0, listeningMaxLength).join("").trim();
}

/** What a client says it listens to, as it is kept: the title and the artist without control
 *  characters, trimmed, at most 120 characters each. Nothing (not listening) without a title.
 *  Reading what this returned gives the same again. */
export function listeningOf(value: unknown): Listening | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { title, artist } = value as Record<string, unknown>;
  const kept = listeningText(title);
  if (!kept) return undefined;
  const by = listeningText(artist);
  return by ? { title: kept, artist: by } : { title: kept };
}

/** A presence for someone who is not a friend: what is listened to is for friends only, whatever
 *  the privacy setting says about the rest of the presence. */
export function withoutListening<T>(presence: T): T {
  if (!presence || typeof presence !== "object" || !("listening" in presence)) return presence;
  return Object.fromEntries(Object.entries(presence).filter(([key]) => key !== "listening")) as unknown as T;
}

/** The devices' merged presence with the extras on top, always in the same key order, so the
 *  gateway and the API make the same string and a friend is told only of real changes. Clients
 *  can only set state, titleId, since and listening. While online, `status` says Online, Idle or Do Not
 *  Disturb; a picked Idle also shows as `away` to clients that know only the state (unless in a
 *  game, which stays in_game so the game still shows). What a device listens to stays while the
 *  person is not offline, after the extras. */
export function withExtras<T extends { state: string }>(
  base: T,
  extras: Record<string, string>,
): T & Partial<Record<PresenceExtra, unknown>> & { status?: ShownStatus; listening?: Listening } {
  const {
    state: own,
    titleId,
    since,
    listening: heard,
  } = base as { state: string; titleId?: string; since?: string; listening?: unknown };
  const picked = parseField(extras[presenceStatusField]);
  const state = picked === "idle" && (own === "online" || own === "away") ? "away" : own;
  const merged: Record<string, unknown> = { state };
  if (titleId !== undefined) merged.titleId = titleId;
  if (since !== undefined) merged.since = since;
  if (state !== "offline") {
    merged.status = shownStatus(picked, state);
    for (const field of presenceExtras)
      if (extras[field]) merged[field] = JSON.parse(extras[field] as string);
    const listening = listeningOf(heard);
    if (listening) merged.listening = listening;
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
