import type { Presence, PresenceState } from "./people";

/** The four statuses one picks, as Discord has them. Invisible is the old "appear offline". */
export const presenceStatuses = ["online", "idle", "dnd", "invisible"] as const;
export type PresenceStatus = (typeof presenceStatuses)[number];

const isStatus = (value: unknown): value is PresenceStatus =>
  typeof value === "string" && (presenceStatuses as readonly string[]).includes(value);

/** The account's status as /me gives it: presenceStatus, or from appearOffline on older answers. */
export function statusFrom(profile: { presenceStatus?: unknown; appearOffline?: unknown }): PresenceStatus {
  if (isStatus(profile.presenceStatus)) return profile.presenceStatus;
  return profile.appearOffline === true ? "invisible" : "online";
}

/** The status after a gateway event: a presence.mode event (the choice made on this or another
 *  device) sets it, from `status` or, from an older API, `appearOffline`; anything else leaves it. */
export function statusAfter(current: PresenceStatus, event: { type: string; data: unknown }): PresenceStatus {
  if (event.type !== "presence.mode") return current;
  const data = (event.data ?? {}) as { status?: unknown; appearOffline?: unknown };
  if (isStatus(data.status)) return data.status;
  if (typeof data.appearOffline !== "boolean") return current;
  if (data.appearOffline) return "invisible";
  return current === "invisible" ? "online" : current;
}

/** Whether the account appears offline after a gateway event (kept for the callers that ask only
 *  that). */
export function appearOfflineAfter(current: boolean, event: { type: string; data: unknown }): boolean {
  return statusAfter(current ? "invisible" : "online", event) === "invisible";
}

/** The presence the status line under a profile's name shows after a gateway event, worked out as
 *  the gateway does (withExtras in packages/shared):
 *  - presence.updated about this person (what their friends hear) replaces it;
 *  - on one's own profile, presence.mode (the status picked on this or another device, the
 *    launcher too) sets the status. Invisible shows as offline, as it does on a fresh load. This
 *    page is open, so the account is at least online, or still in its game.
 *  Any other event, or one that makes no sense, leaves it as it was. */
export function profilePresenceAfter(
  current: { presence: Presence; picked: PresenceStatus },
  event: { type: string; data: unknown },
  who: { userId: string; self: boolean },
): { presence: Presence; picked: PresenceStatus } {
  if (event.type === "presence.updated") {
    const { userId, ...next } = (event.data && typeof event.data === "object" ? event.data : {}) as {
      userId?: unknown;
    } & Partial<Presence>;
    const states: PresenceState[] = ["online", "away", "in_game", "offline"];
    if (userId !== who.userId || !states.includes(next.state as PresenceState)) return current;
    return { ...current, presence: next as Presence };
  }
  if (!who.self || event.type !== "presence.mode") return current;
  const picked = statusAfter(current.picked, event);
  if (picked === current.picked) return current;
  if (picked === "invisible") return { picked, presence: { state: "offline" } };
  const { status: _, ...base } = current.presence;
  const own = base.state === "in_game" ? "in_game" : "online";
  const state = picked === "idle" && own === "online" ? "away" : own;
  const status = picked === "idle" || picked === "dnd" ? picked : state === "away" ? "idle" : "online";
  return { picked, presence: { ...base, state, status } };
}
