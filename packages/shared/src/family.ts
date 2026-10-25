import { z } from "zod";
import { AgeLevels, TitleId } from "./games.js";
import type { MemberView } from "./messages.js";

/** Families: a manager (an adult) makes one and brings people in; parents set what a child may do,
 *  answer the child's requests and see how they play. Families are opt-in: an account in none (or
 *  not a child in one) has no limits at all. The API enforces every social limit itself; the
 *  launchers enforce play time and age ratings from GET /me/family/restrictions. */

/** manager: everything, one per family; parent: limits, requests, activity; adult: a member;
 *  child: limited by the parents, cannot leave on their own. */
export const familyRoles = ["manager", "parent", "adult", "child"] as const;
export type FamilyRole = (typeof familyRoles)[number];
/** The roles that look after children. */
export const guardianRoles: readonly FamilyRole[] = ["manager", "parent"];
export const isGuardian = (role: FamilyRole | null | undefined) => role === "manager" || role === "parent";

/** People in one family, the manager included. */
export const maxFamilyMembers = 8;
/** A child link code works this long. */
export const familyCodeHours = 24;
/** A member invite waits this long for an answer. */
export const familyInviteDays = 7;

export const FamilyName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "a name").max(40, "at most 40 characters"));

export const FamilyCreate = z.object({ name: FamilyName });
export const FamilyUpdate = z.object({ name: FamilyName });
/** Inviting an existing account as a parent or another adult; they accept in a notification. */
export const FamilyInviteCreate = z.object({
  handle: z.string().trim().min(1).max(40),
  role: z.enum(["parent", "adult"]),
});
/** A new child account for an address that has none yet: the child signs in with it normally. */
export const FamilyChildCreate = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(40))
    .optional(),
  /** The child's clock for play time; UTC when left out. */
  timeZone: z.string().max(64).optional(),
});
/** The child confirms a link with the code the manager was shown. */
export const FamilyJoin = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^[A-Z2-9]{8}$/, "the 8-character code")),
  /** The child's clock for play time; UTC when left out. */
  timeZone: z.string().max(64).optional(),
});
/** A manager changes someone's role; giving "manager" hands the family over. */
export const FamilyRoleChange = z.object({ role: z.enum(["manager", "parent", "adult"]) });

// ---------------------------------------------------------------------------------------------
// What a child may do

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof weekdays)[number];

/** Who may send the child friend requests, and whom the child may ask: anyone, people who share a
 *  friend with the child, only people a parent approved, or nobody. */
export const friendRequestRules = ["everyone", "friends_of_friends", "approved", "nobody"] as const;
export type FriendRequestRule = (typeof friendRequestRules)[number];
/** Whom the child may message and call: friends (as everyone), approved friends only, nobody.
 *  Family members are always reachable. */
export const messageRules = ["friends", "approved", "nobody"] as const;
export type MessageRule = (typeof messageRules)[number];

/** "07:30": a time of day on the child's clock. */
const Clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "a time like 07:30");
export const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** One day of the week: how long the child may play (null: no limit) and between which times
 *  (null: any time). `until` is after `from` on the same day. */
export const DayPlan = z
  .object({
    limitMinutes: z.number().int().min(0).max(1440).nullable(),
    from: Clock.nullable(),
    until: Clock.nullable(),
  })
  .refine((day) => (day.from === null) === (day.until === null), "both from and until, or neither")
  .refine(
    (day) => day.from === null || day.until === null || clockMinutes(day.until) > clockMinutes(day.from),
    "until after from",
  );
export type DayPlan = z.infer<typeof DayPlan>;

const TimeZone = z
  .string()
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "an IANA time zone like Europe/Istanbul");

/** notify: the launcher warns and tells the parents but lets the child go on; close: it warns at 10
 *  and 1 minutes, shows a big notice, and closes the game after the grace period. */
export const limitActions = ["notify", "close"] as const;
export type LimitAction = (typeof limitActions)[number];

export const PlayTime = z.object({
  enabled: z.boolean(),
  days: z.object(
    Object.fromEntries(weekdays.map((day) => [day, DayPlan])) as Record<Weekday, typeof DayPlan>,
  ),
  /** The child's clock, for days and windows. */
  timeZone: TimeZone,
  whenLimitReached: z.enum(limitActions),
  /** Minutes between the big notice and the game closing, to save. */
  graceMinutes: z.number().int().min(0).max(30),
  /** Tell the parents when the limit is reached. */
  notifyParents: z.boolean(),
});
export type PlayTime = z.infer<typeof PlayTime>;

export { AgeLevels };

export const FamilyRestrictions = z.object({
  friendRequests: z.enum(friendRequestRules),
  messages: z.enum(messageRules),
  voiceChat: z.boolean(),
  /** Share play: hosting and watching. */
  sharePlay: z.boolean(),
  /** Public parties, the looking-for-group board ("Find players") and public share plays. */
  publicMatchmaking: z.boolean(),
  /** The most any part of the profile (library, trophies, friends, presence, search) may show. */
  profileVisibility: z.enum(["friends", "nobody"]),
  /** Shown in and browsing discovery (players of a game, suggestions, game hubs' players). */
  discovery: z.boolean(),
  communities: z.boolean(),
  /** Sharing screenshots and clips. */
  mediaSharing: z.boolean(),
  /** The highest age rating the child may play; null: any. */
  ageLimit: z.number().int().min(0).max(99).nullable(),
  /** A game whose rating is unknown. */
  unknownAge: z.enum(["allow", "block"]),
  /** Which region's rating counts ("TR", "US"); "default" is the game's own default. */
  ageRegion: z.string().regex(/^([A-Z]{2}|default)$/),
  /** Games a parent allowed whatever their rating (an approved request). */
  allowedTitles: z.array(TitleId).max(500),
  /** People a parent approved for friend requests and messages. */
  approvedContacts: z.array(z.string().uuid()).max(200),
  playTime: PlayTime,
});
export type FamilyRestrictions = z.infer<typeof FamilyRestrictions>;
export type FamilyFeature =
  | "friend_requests"
  | "messages"
  | "voice_chat"
  | "share_play"
  | "public_matchmaking"
  | "profile_visibility"
  | "discovery"
  | "communities"
  | "media_sharing"
  | "age_rating"
  | "family";

const anyDay: DayPlan = { limitMinutes: null, from: null, until: null };

/** A new child's limits: careful, the parent opens up what they want. */
export function defaultRestrictions(timeZone = "UTC"): FamilyRestrictions {
  return {
    friendRequests: "approved",
    messages: "friends",
    voiceChat: false,
    sharePlay: false,
    publicMatchmaking: false,
    profileVisibility: "friends",
    discovery: false,
    communities: false,
    mediaSharing: false,
    ageLimit: null,
    unknownAge: "allow",
    ageRegion: "default",
    allowedTitles: [],
    approvedContacts: [],
    playTime: {
      enabled: false,
      days: Object.fromEntries(weekdays.map((day) => [day, { ...anyDay }])) as Record<Weekday, DayPlan>,
      timeZone,
      whenLimitReached: "close",
      graceMinutes: 3,
      notifyParents: true,
    },
  };
}

/** The stored limits over the defaults; anything unknown or invalid falls back to the default. */
export function restrictionsOf(stored: unknown): FamilyRestrictions {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const base = defaultRestrictions(
    typeof (saved.playTime as { timeZone?: unknown })?.timeZone === "string"
      ? ((saved.playTime as { timeZone: string }).timeZone as string)
      : "UTC",
  );
  const result: Record<string, unknown> = { ...base };
  const shape = FamilyRestrictions.shape;
  for (const key of Object.keys(shape) as (keyof FamilyRestrictions)[]) {
    if (key === "playTime") continue;
    const parsed = shape[key].safeParse(saved[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  const time = (saved.playTime && typeof saved.playTime === "object" ? saved.playTime : {}) as Record<
    string,
    unknown
  >;
  const playTime: Record<string, unknown> = { ...base.playTime };
  for (const key of ["enabled", "timeZone", "whenLimitReached", "graceMinutes", "notifyParents"] as const) {
    const parsed = PlayTime.shape[key].safeParse(time[key]);
    if (parsed.success) playTime[key] = parsed.data;
  }
  const days = (time.days && typeof time.days === "object" ? time.days : {}) as Record<string, unknown>;
  playTime.days = Object.fromEntries(
    weekdays.map((day) => {
      const parsed = DayPlan.safeParse(days[day]);
      return [day, parsed.success ? parsed.data : { ...anyDay }];
    }),
  );
  result.playTime = playTime;
  return result as FamilyRestrictions;
}

/** PATCH a child's limits: only what is sent changes; inside playTime too, and day by day. */
export const FamilyRestrictionsUpdate = FamilyRestrictions.omit({ playTime: true })
  .partial()
  .extend({
    playTime: PlayTime.omit({ days: true })
      .partial()
      .extend({
        days: z
          .object(
            Object.fromEntries(weekdays.map((day) => [day, DayPlan.optional()])) as Record<
              Weekday,
              z.ZodOptional<typeof DayPlan>
            >,
          )
          .optional(),
      })
      .optional(),
  })
  .strict();
export type FamilyRestrictionsUpdate = z.infer<typeof FamilyRestrictionsUpdate>;

/** The limits after an update. */
export function applyRestrictionsUpdate(
  current: FamilyRestrictions,
  update: FamilyRestrictionsUpdate,
): FamilyRestrictions {
  const { playTime, ...rest } = update;
  const next: FamilyRestrictions = { ...current, ...rest, playTime: { ...current.playTime } };
  if (playTime) {
    const { days, ...timeRest } = playTime;
    next.playTime = { ...next.playTime, ...timeRest, days: { ...current.playTime.days, ...(days ?? {}) } };
  }
  next.allowedTitles = [...new Set(next.allowedTitles)];
  next.approvedContacts = [...new Set(next.approvedContacts)];
  return next;
}

// ---------------------------------------------------------------------------------------------
// The policy, shared by the API and the website (the launchers carry the same rules)

/** The date, weekday and minute of the day on a clock. */
export function localClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const weekday = (parts.weekday ?? "Mon").slice(0, 3).toLowerCase() as Weekday;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

/** The rating that counts for a region: the region's own, else the game's default; null when the
 *  game has none. */
export function ageLevelFor(levels: Record<string, number> | null | undefined, region: string) {
  if (!levels) return null;
  const own = region !== "default" ? levels[region] : undefined;
  if (typeof own === "number") return own;
  return typeof levels.default === "number" ? levels.default : null;
}

/** Whether the child may play a game: allowed, too old a rating, or an unknown rating blocked. */
export function titleVerdict(
  rules: Pick<FamilyRestrictions, "ageLimit" | "unknownAge" | "ageRegion" | "allowedTitles">,
  titleId: string,
  levels: Record<string, number> | null | undefined,
): "allowed" | "age" | "unknown" {
  if (rules.allowedTitles.includes(titleId) || rules.ageLimit === null) return "allowed";
  const level = ageLevelFor(levels, rules.ageRegion);
  if (level === null) return rules.unknownAge === "allow" ? "allowed" : "unknown";
  return level <= rules.ageLimit ? "allowed" : "age";
}

export interface Allowance {
  date: string;
  weekday: Weekday;
  /** Today's limit with extra time granted today; null: no limit. */
  limitMinutes: number | null;
  bonusMinutes: number;
  playedSeconds: number;
  from: string | null;
  until: string | null;
  /** Seconds left before the limit or the window's end, whichever comes first; null: no end. */
  remainingSeconds: number | null;
  /** Whether the child may play now; `reason` says why not. */
  allowed: boolean;
  reason: "limit" | "window" | null;
}

/** How much the child may still play today. */
export function allowance(
  playTime: PlayTime,
  input: { now: Date; playedSeconds: number; bonusMinutes: number },
): Allowance {
  const clock = localClock(input.now, playTime.timeZone);
  const day = playTime.days[clock.weekday];
  const base = {
    date: clock.date,
    weekday: clock.weekday,
    bonusMinutes: input.bonusMinutes,
    playedSeconds: input.playedSeconds,
  };
  if (!playTime.enabled)
    return {
      ...base,
      limitMinutes: null,
      from: null,
      until: null,
      remainingSeconds: null,
      allowed: true,
      reason: null,
    };
  const limitMinutes = day.limitMinutes === null ? null : day.limitMinutes + input.bonusMinutes;
  const left = limitMinutes === null ? null : Math.max(0, limitMinutes * 60 - input.playedSeconds);
  let windowLeft: number | null = null;
  let inWindow = true;
  if (day.from !== null && day.until !== null) {
    const from = clockMinutes(day.from) * 60;
    const until = clockMinutes(day.until) * 60;
    inWindow = clock.seconds >= from && clock.seconds < until;
    windowLeft = inWindow ? until - clock.seconds : 0;
  }
  const remaining = left === null ? windowLeft : windowLeft === null ? left : Math.min(left, windowLeft);
  const reason = !inWindow ? "window" : left !== null && left <= 0 ? "limit" : null;
  return {
    ...base,
    limitMinutes,
    from: day.from,
    until: day.until,
    remainingSeconds: remaining,
    allowed: reason === null,
    reason,
  };
}

// ---------------------------------------------------------------------------------------------
// Views

export interface FamilyMemberView extends MemberView {
  role: FamilyRole;
  joinedAt: string;
  /** False for a child account the manager made that the child has not said yes to yet. */
  confirmed: boolean;
}

export interface FamilyInviteView {
  id: string;
  familyId: string;
  familyName: string;
  role: FamilyRole;
  from: MemberView | null;
  /** For the manager's list: who was invited. */
  to: MemberView | null;
  expiresAt: string;
  createdAt: string;
}

export interface FamilyView {
  id: string;
  name: string;
  createdAt: string;
  members: FamilyMemberView[];
  /** The asker's role. */
  role: FamilyRole;
  /** For the manager: member invites still waiting. */
  invites: FamilyInviteView[];
}

/** GET /me/family */
export interface MyFamilyView {
  family: FamilyView | null;
  /** Invites waiting for the asker. */
  invites: FamilyInviteView[];
}

/** What GET /me/family/restrictions answers and signs. */
export interface FamilyStatus {
  userId: string;
  /** Whether any limit applies (a child in a family). */
  restricted: boolean;
  familyId: string | null;
  role: FamilyRole | null;
  restrictions: FamilyRestrictions | null;
  /** Today on the child's clock: play time from synced sessions (other computers included). */
  today: Allowance | null;
  issuedAt: string;
}

/** The answer: the status, and the same status signed by the server (a compact JWS, EdDSA, with the
 *  key from /.well-known/jwks.json; audience "anytogether-family", the status in the `family`
 *  claim) for the launchers to keep offline without anyone changing it. */
export interface FamilyStatusResponse extends FamilyStatus {
  signed: string;
}
export const familyAudience = "anytogether-family";

export const familyRequestKinds = ["more_time", "add_friend", "play_game"] as const;
export type FamilyRequestKind = (typeof familyRequestKinds)[number];
export const familyRequestStatuses = ["pending", "approved", "declined"] as const;
export type FamilyRequestStatus = (typeof familyRequestStatuses)[number];

/** A child asks: for more time today, to add a friend (by handle), or to play a blocked game. */
export const FamilyRequestCreate = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("more_time"),
    minutes: z.number().int().min(5).max(240),
    titleId: TitleId.optional(),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("add_friend"),
    handle: z.string().trim().min(1).max(40),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("play_game"),
    titleId: TitleId,
    name: z.string().trim().max(200).optional(),
    note: z.string().trim().max(200).optional(),
  }),
]);
export type FamilyRequestCreate = z.infer<typeof FamilyRequestCreate>;
/** A parent's yes may give a different amount of time than asked. */
export const FamilyRequestAnswer = z.object({ minutes: z.number().int().min(1).max(600).optional() });
/** A parent gives extra time today without being asked. */
export const FamilyTimeGrant = z.object({ minutes: z.number().int().min(1).max(600) });
/** The launcher says the child reached today's limit (once a day tells the parents). */
export const FamilyLimitReached = z.object({ titleId: TitleId.optional() });

export interface FamilyRequestView {
  id: string;
  kind: FamilyRequestKind;
  status: FamilyRequestStatus;
  child: MemberView | null;
  /** more_time: minutes asked; add_friend: the person; play_game: the game. */
  minutes: number | null;
  grantedMinutes: number | null;
  person: MemberView | null;
  titleId: string | null;
  gameName: string | null;
  note: string | null;
  /** The child's date the extra time is for. */
  day: string | null;
  answeredBy: MemberView | null;
  answeredAt: string | null;
  createdAt: string;
}

/** A child's play over some days, for the parents. */
export interface FamilyActivityView {
  child: MemberView;
  from: string;
  until: string;
  totalSeconds: number;
  days: { date: string; seconds: number }[];
  games: { titleId: string; names: Record<string, string>; seconds: number; lastPlayedAt: string }[];
  friendsAdded: (MemberView & { at: string })[];
  requests: number;
}

export interface FamilyLogView {
  id: string;
  action: string;
  actor: MemberView | null;
  subject: MemberView | null;
  data: Record<string, unknown>;
  createdAt: string;
}
