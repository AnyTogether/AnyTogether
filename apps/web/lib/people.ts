/** People as the API shows them (no tokens or emails ever reach these). */
export interface Person {
  userId: string;
  handle: string;
  displayName: string;
  avatar: string | null;
}

export type PresenceState = "online" | "away" | "in_game" | "offline";

export interface Presence {
  state: PresenceState;
  titleId?: string;
  since?: string;
}

export interface Friend extends Person {
  presence: Presence;
}

export interface Requests {
  incoming: (Person & { askedAt: string })[];
  outgoing: (Person & { askedAt: string })[];
}

export type Friendship = "me" | "none" | "pending_out" | "pending_in" | "friends";

export interface Profile extends Person {
  bio: string | null;
  country: string | null;
  friendship: Friendship;
}

/** A user id as the API makes them, so nothing else reaches a path. */
export const isUserId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** "Request sent to @{handle}." with the blanks filled. */
export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

export const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase();

const rank: Record<PresenceState, number> = { in_game: 0, online: 1, away: 2, offline: 3 };

/** Playing first, then online, then away, then offline; each by name. */
export const byPresence = (x: Friend, y: Friend) =>
  (rank[x.presence.state] ?? 3) - (rank[y.presence.state] ?? 3) || x.displayName.localeCompare(y.displayName);

/** How long since a game started: "42 min", "1 h 12 min"; null when it just started or is unknown. */
export function playedFor(since: string | undefined, now: number, units: { minutes: string; hours: string }) {
  const started = since ? Date.parse(since) : Number.NaN;
  if (Number.isNaN(started)) return null;
  const minutes = Math.floor((now - started) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return fill(units.minutes, { m: minutes });
  return fill(units.hours, { h: Math.floor(minutes / 60), m: minutes % 60 });
}
