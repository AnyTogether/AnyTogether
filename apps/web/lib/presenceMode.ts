/** Whether the account appears offline after a gateway event: a presence.mode event (the choice made
 *  on this or another device) sets it; anything else leaves it as it was. */
export function appearOfflineAfter(current: boolean, event: { type: string; data: unknown }): boolean {
  if (event.type !== "presence.mode") return current;
  const value = (event.data as { appearOffline?: unknown } | null)?.appearOffline;
  return typeof value === "boolean" ? value : current;
}
