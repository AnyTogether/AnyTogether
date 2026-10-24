import type { Person } from "@/lib/people";

/** Looking for group, public parties and share plays, and people to meet, as the API shows them
 *  (the website keeps its own copy of the shapes). */
export const purposes = ["coop", "online", "party", "trophies"] as const;
export type Purpose = (typeof purposes)[number];
export const regions = ["eu", "na", "sa", "asia", "oceania", "africa", "me"] as const;
export type Region = (typeof regions)[number];
export type JoinMode = "request" | "open";

/** Languages offered in pickers; the names come from the browser in the reader's language. */
export const pickLanguages = [
  "en",
  "tr",
  "de",
  "fr",
  "es",
  "pt",
  "it",
  "nl",
  "pl",
  "ru",
  "uk",
  "ar",
  "ja",
  "ko",
  "zh",
  "sv",
  "no",
  "da",
  "fi",
  "cs",
  "el",
  "hu",
  "ro",
  "hi",
  "id",
  "th",
  "vi",
] as const;

/** At most this many slots: co-op over share play has pads 2-4, a party holds eight. */
export const maxCoopSlots = 3;
export const maxSlots = 7;
export const maxNote = 140;

export interface GameInfo {
  names: Record<string, string>;
  iconUrl: string | null;
}

export interface LfgInvite {
  kind: "party" | "share_play";
  id: string;
}

export interface LfgRequest {
  user: Person;
  status: "pending" | "accepted" | "declined";
  invite: LfgInvite | null;
  createdAt: string;
}

export interface LfgPost {
  id: string;
  author: Person;
  titleId: string;
  game: GameInfo | null;
  purpose: Purpose;
  startsAt: string | null;
  languages: string[];
  region: Region | null;
  slots: number;
  filled: number;
  note: string | null;
  expiresAt: string;
  status: "open" | "full" | "closed" | "expired" | "removed";
  createdAt: string;
  mine: boolean;
  myRequest: { status: LfgRequest["status"]; invite: LfgInvite | null } | null;
  requests?: LfgRequest[];
}

export interface LfgPage {
  posts: LfgPost[];
  more: boolean;
}

export interface LfgGame extends GameInfo {
  titleId: string;
  posts: number;
}

export interface PublicParty {
  id: string;
  host: Person | null;
  titleId: string | null;
  game: GameInfo | null;
  language: string | null;
  join: JoinMode;
  size: number;
  max: number;
  requested: boolean;
  listedAt: string;
}

export interface PublicShare {
  id: string;
  host: Person | null;
  titleId: string;
  title: string | null;
  game: GameInfo | null;
  language: string | null;
  join: JoinMode;
  live: boolean;
  viewers: number;
  maxViewers: number;
  requested: boolean;
  startedAt: string;
}

export type Reason =
  | { kind: "game"; titleId: string; names: Record<string, string> }
  | { kind: "friends"; count: number }
  | { kind: "language"; language: string };

export interface PersonCard {
  user: Person;
  friendship: "none" | "friends" | "pending_out" | "pending_in";
  presence?: { state: string; titleId?: string };
  lastPlayedAt?: string | null;
  reasons?: Reason[];
}

export interface Discovery {
  discoverable: boolean;
  chosen: boolean | null;
  languages: string[];
}

export interface Hub {
  game: GameInfo & { titleId: string };
  players: number;
  playing: { total: number; people: { user: Person; since: string | null }[] };
  lfg: LfgPost[];
  parties: PublicParty[];
  sharePlays: PublicShare[];
  recentPlayers: PersonCard[];
}

/** A language's name in the reader's language ("Turkish", "Türkçe"), or its code. */
export function languageName(code: string, language: string) {
  try {
    const name = new Intl.DisplayNames([language], { type: "language" }).of(code);
    return name && name !== code
      ? name.charAt(0).toLocaleUpperCase(language) + name.slice(1)
      : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** When a post starts: null for now, else "21:30" today or "Sat 21:30". */
export function startTime(iso: string, language: string, now = Date.now()) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  return new Date(now).toDateString() === date.toDateString()
    ? time
    : `${date.toLocaleDateString(language, { weekday: "short" })} ${time}`;
}

/** "in 2 hr", "in 25 min": how long until a time, short. */
export function untilShort(iso: string, language: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  const format = new Intl.RelativeTimeFormat(language, { numeric: "always", style: "short" });
  return minutes < 60 ? format.format(minutes, "minute") : format.format(Math.round(minutes / 60), "hour");
}

/** Whether a post is meant for now (no start, or within half an hour). */
export const startsNow = (post: Pick<LfgPost, "startsAt">, now = Date.now()) =>
  !post.startsAt || Date.parse(post.startsAt) <= now + 30 * 60_000;

export const isPostId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
