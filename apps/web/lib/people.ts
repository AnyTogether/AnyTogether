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
  /** While they share play the game they run (older API answers lack it). */
  share?: {
    sharePlayId: string;
    titleId: string;
    title: string | null;
    open: boolean;
    viewers: number;
    maxViewers: number;
  };
}

export interface Friend extends Person {
  presence: Presence;
}

/** The list with one friend's presence changed, as a presence.updated event from the gateway
 *  gives it ({userId, state, titleId, ...}); the same list when the event is not about a friend
 *  on it or makes no sense. */
export function withPresence(friends: Friend[], data: unknown): Friend[] {
  const { userId, ...presence } = (data && typeof data === "object" ? data : {}) as {
    userId?: unknown;
  } & Partial<Presence>;
  const states: PresenceState[] = ["online", "away", "in_game", "offline"];
  if (typeof userId !== "string" || !states.includes(presence.state as PresenceState)) return friends;
  if (!friends.some((f) => f.userId === userId)) return friends;
  return friends.map((f) => (f.userId === userId ? { ...f, presence: presence as Presence } : f));
}

export interface Requests {
  incoming: (Person & { askedAt: string })[];
  outgoing: (Person & { askedAt: string })[];
}

export type Friendship = "me" | "none" | "pending_out" | "pending_in" | "friends";

export type Section = "library" | "trophies" | "friends" | "presence";

/** Trophies earned by grade, and points: shown signed out when trophies are open to everyone. */
export interface TrophyCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  total: number;
  points: number;
}

/** A profile as anyone who is not signed in sees it: no user ID, never presence. */
export interface PublicProfile extends Omit<Profile, "userId"> {
  signedIn?: false;
  trophyCounts?: TrophyCounts;
}

export interface Profile extends Person {
  bio: string | null;
  country: string | null;
  friendship: Friendship;
  /** Which parts the viewer may open (older API answers lack it: then friends and self only). */
  visible?: Record<Section, boolean>;
  /** Only when the viewer may see it. */
  presence?: Presence;
}

export type Visibility = "everyone" | "friends" | "nobody";
export type PrivacySection = Section | "search" | "gallery";
export type Privacy = Record<PrivacySection, Visibility>;
export const privacySections: PrivacySection[] = ["library", "trophies", "friends", "presence", "search"];
/** With cloud storage on, the gallery's setting too. */
export const privacySectionsWithGallery: PrivacySection[] = [...privacySections, "gallery"];

/** The signed-in user's own account and profile, as GET /me gives them. */
export interface Own {
  account: { id: string; email: string | null; createdAt: string };
  profile: {
    handle: string;
    displayName: string;
    bio: string | null;
    avatar: string | null;
    country: string | null;
    handleChangeAt: string | null;
    privacy: Privacy;
  };
}

/** A signed-in launcher, phone or browser (GET /auth/sessions). */
export interface SignedIn {
  id: string;
  client: string;
  deviceName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  current: boolean;
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
