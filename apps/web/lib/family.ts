import type { Person } from "@/lib/people";

/** Families as the API shows them (the website keeps its own copy of the shapes, as for the rest
 *  of the API; packages/shared/src/family.ts is the source). */

export type FamilyRole = "manager" | "parent" | "adult" | "child";
export const isGuardian = (role: FamilyRole | null | undefined) => role === "manager" || role === "parent";

export interface FamilyMember extends Person {
  role: FamilyRole;
  joinedAt: string;
  confirmed: boolean;
}

export interface FamilyInvite {
  id: string;
  familyId: string;
  familyName: string;
  role: FamilyRole;
  from: Person | null;
  to: Person | null;
  expiresAt: string;
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  createdAt: string;
  members: FamilyMember[];
  role: FamilyRole;
  invites: FamilyInvite[];
}

export interface MyFamily {
  family: Family | null;
  invites: FamilyInvite[];
}

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof weekdays)[number];
export interface DayPlan {
  limitMinutes: number | null;
  from: string | null;
  until: string | null;
}

export type FriendRequestRule = "everyone" | "friends_of_friends" | "approved" | "nobody";
export type MessageRule = "friends" | "approved" | "nobody";
export const friendRequestRules: FriendRequestRule[] = [
  "everyone",
  "friends_of_friends",
  "approved",
  "nobody",
];
export const messageRules: MessageRule[] = ["friends", "approved", "nobody"];

export interface Restrictions {
  friendRequests: FriendRequestRule;
  messages: MessageRule;
  voiceChat: boolean;
  sharePlay: boolean;
  publicMatchmaking: boolean;
  profileVisibility: "friends" | "nobody";
  discovery: boolean;
  communities: boolean;
  mediaSharing: boolean;
  ageLimit: number | null;
  unknownAge: "allow" | "block";
  ageRegion: string;
  allowedTitles: string[];
  approvedContacts: string[];
  playTime: {
    enabled: boolean;
    days: Record<Weekday, DayPlan>;
    timeZone: string;
    whenLimitReached: "notify" | "close";
    graceMinutes: number;
    notifyParents: boolean;
  };
}

/** The switches a parent turns on and off, in the order the page lists them. */
export const featureSwitches = [
  "voiceChat",
  "sharePlay",
  "publicMatchmaking",
  "discovery",
  "communities",
  "mediaSharing",
] as const;
export type FeatureSwitch = (typeof featureSwitches)[number];

export interface Allowance {
  date: string;
  weekday: Weekday;
  limitMinutes: number | null;
  bonusMinutes: number;
  playedSeconds: number;
  from: string | null;
  until: string | null;
  remainingSeconds: number | null;
  allowed: boolean;
  reason: "limit" | "window" | null;
  /** Older servers leave it out. */
  utcOffsetMinutes?: number;
}

export interface ChildSettings {
  restrictions: Restrictions;
  approvedContacts: Person[];
  updatedAt: string | null;
  updatedBy: Person | null;
  today: Allowance | null;
}

export interface FamilyStatus {
  userId: string;
  restricted: boolean;
  familyId: string | null;
  role: FamilyRole | null;
  restrictions: Restrictions | null;
  today: Allowance | null;
  issuedAt: string;
}

export type RequestKind = "more_time" | "add_friend" | "play_game";
export interface FamilyRequest {
  id: string;
  kind: RequestKind;
  status: "pending" | "approved" | "declined";
  child: Person | null;
  minutes: number | null;
  grantedMinutes: number | null;
  person: Person | null;
  titleId: string | null;
  gameName: string | null;
  note: string | null;
  day: string | null;
  answeredBy: Person | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface Activity {
  child: Person;
  from: string;
  until: string;
  totalSeconds: number;
  days: { date: string; seconds: number }[];
  games: { titleId: string; names: Record<string, string>; seconds: number; lastPlayedAt: string }[];
  friendsAdded: (Person & { at: string })[];
  requests: number;
}

export interface LogEntry {
  id: string;
  action: string;
  actor: Person | null;
  subject: Person | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/** "1 h 20 min", "45 min", "1 sa 20 dk". */
export function duration(seconds: number, language: "en" | "tr") {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (language === "tr") return h ? (m ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** The family API through this website (see app/me/family-api). */
export async function familyApi<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; body: (T & { code?: string; feature?: string }) | null }> {
  const response = await fetch(`/me/family-api/${path}`, {
    method: init.method ?? "GET",
    ...(init.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  }).catch(() => undefined);
  if (!response) return { ok: false, status: 0, body: null };
  const text = await response.text().catch(() => "");
  let body: (T & { code?: string }) | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

/** The browser's own time zone, for a new child's play-time clock. */
export const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The family API paths the website may reach, by method; nothing else passes. */
export const familyPaths: Record<string, RegExp[]> = {
  GET: [
    /^me\/family$/,
    /^me\/family\/(requests|log|restrictions)$/,
    new RegExp(`^me/family/children/${id}/(restrictions|activity)$`),
  ],
  POST: [
    /^families$/,
    /^me\/family\/(invites|children|link-codes|join|confirm|not-mine|leave|requests)$/,
    new RegExp(`^family-invites/${id}/(accept|decline)$`),
    new RegExp(`^me/family/requests/${id}/(approve|decline)$`),
    new RegExp(`^me/family/children/${id}/time-grants$`),
  ],
  PATCH: [
    /^me\/family$/,
    new RegExp(`^me/family/members/${id}$`),
    new RegExp(`^me/family/children/${id}/restrictions$`),
  ],
  DELETE: [/^me\/family$/, new RegExp(`^me/family/(invites|members)/${id}$`)],
};
export const familyQueries = ["status", "days", "before"];

export const familyPathAllowed = (method: string, path: string) =>
  familyPaths[method]?.some((pattern) => pattern.test(path)) ?? false;

/** The words for a refusal by family settings: the reader's own limit, or the other person's; null
 *  for any other answer. */
export function familyRefusal(
  body: { code?: string; side?: string } | null | undefined,
  texts: { restrictedNotice: string; restrictedOther: string },
) {
  if (body?.code !== "restricted_by_family") return null;
  return body.side === "other" ? texts.restrictedOther : texts.restrictedNotice;
}
