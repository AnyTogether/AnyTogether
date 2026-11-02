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
