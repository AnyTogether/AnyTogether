import { z } from "zod";
import { TitleId } from "./games.js";
import type { MemberView } from "./messages.js";
import { hasLink } from "./profile.js";
import { IconPreset } from "./showcase.js";

/** Communities: a name, maybe a game, an icon from the presets, public (anyone joins) or by
 *  invite only; an owner, moderators and members, with a chat (a group conversation bound to the
 *  community) and events. */
export const maxCommunityMembers = 200;
/** Communities one person may own, and be in. */
export const maxOwnedCommunities = 5;
export const maxJoinedCommunities = 100;
export const communityVisibilities = ["public", "invite"] as const;
export type CommunityVisibility = (typeof communityVisibilities)[number];
export const communityRoles = ["owner", "moderator", "member"] as const;
export type CommunityRole = (typeof communityRoles)[number];

const plain = (max: number, min = 0) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().min(min).max(max))
    .refine((value) => !hasLink(value), "no links");

export const CommunityName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(3, "at least 3 characters").max(40, "at most 40 characters"))
  .refine((value) => !hasLink(value), "no links");

export const CommunityCreate = z.object({
  name: CommunityName,
  titleId: TitleId.nullable().optional(),
  description: plain(500).optional(),
  icon: IconPreset,
  visibility: z.enum(communityVisibilities).default("public"),
});

export const CommunityUpdate = z
  .object({
    name: CommunityName.optional(),
    titleId: TitleId.nullable().optional(),
    description: plain(500).nullable().optional(),
    icon: IconPreset.optional(),
    /** Only the owner changes it. */
    visibility: z.enum(communityVisibilities).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

export const CommunityInvite = z.object({ userIds: z.array(z.string().uuid()).min(1).max(20) });
export const CommunityRoleSet = z.object({ role: z.enum(["moderator", "member"]) });
export const CommunityOwner = z.object({ userId: z.string().uuid() });
export const CommunityBan = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

export interface CommunityCard {
  id: string;
  name: string;
  titleId: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  description: string | null;
  icon: string;
  iconUrl: string;
  visibility: CommunityVisibility;
  members: number;
  maxMembers: number;
  /** The reader's place: their role, invited, or nothing. */
  role: CommunityRole | null;
  invited: boolean;
  /** Upcoming events (not cancelled, not over). */
  upcomingEvents: number;
  createdAt: string;
}

/** A community as its page shows it: the card with its owner, moderators and chat. */
export interface CommunityView extends CommunityCard {
  owner: MemberView | null;
  moderators: MemberView[];
  /** The chat, for members only. */
  conversationId: string | null;
}

export interface CommunityMember extends MemberView {
  role: CommunityRole;
  joinedAt: string;
}

/** Events: a community member plans a time to play; others say going or maybe and are reminded
 *  15 minutes before. When it starts, the host links a party or share play. */
export const eventReminderMinutes = 15;
/** How far ahead an event may be planned, and how long one may last. */
export const maxEventDaysAhead = 90;
export const eventDurations = { min: 15, max: 720, standard: 60 } as const;
export const rsvpStatuses = ["going", "maybe"] as const;
export type RsvpStatus = (typeof rsvpStatuses)[number];
export const eventStatuses = ["scheduled", "cancelled"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const EventCreate = z.object({
  title: plain(80, 3),
  titleId: TitleId.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z
    .number()
    .int()
    .min(eventDurations.min)
    .max(eventDurations.max)
    .default(eventDurations.standard),
  description: plain(1000).optional(),
});

export const EventUpdate = z
  .object({
    title: plain(80, 3).optional(),
    titleId: TitleId.nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    durationMinutes: z.number().int().min(eventDurations.min).max(eventDurations.max).optional(),
    description: plain(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "nothing to change");

export const RsvpSet = z.object({ status: z.enum(rsvpStatuses) });
/** The host starts the event: into their party (a new one when they are in none) or the share
 *  play they host; everyone going or maybe is invited. */
export const EventStart = z.object({ kind: z.enum(["party", "share_play"]) });

export interface EventLink {
  kind: "party" | "share_play";
  id: string;
}

export interface EventView {
  id: string;
  communityId: string;
  community: { name: string; icon: string; iconUrl: string };
  host: MemberView | null;
  title: string;
  titleId: string | null;
  game: { names: Record<string, string>; iconUrl: string | null } | null;
  description: string | null;
  /** UTC; clients show it in the reader's time zone. */
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  /** Set once the host started it. */
  link: EventLink | null;
  startedAt: string | null;
  going: number;
  maybe: number;
  mine: RsvpStatus | null;
  /** The first people going (at most 12). */
  people: MemberView[];
  /** May the reader change or cancel it (host, moderators, owner). */
  canEdit: boolean;
  createdAt: string;
}

export type CommunityEvent =
  /** Its name, icon, roles or members changed: read it again. */
  | { type: "community.updated"; data: { communityId: string } }
  /** The reader is no longer in it. */
  | {
      type: "community.left";
      data: { communityId: string; reason: "left" | "kicked" | "banned" | "deleted" | "removed" };
    }
  | {
      type: "community.invite";
      data: { communityId: string; name: string; from: MemberView };
    }
  /** An event the reader is in (or of a community they are in) changed or was cancelled. */
  | { type: "event.updated"; data: EventView }
  /** Cancelled by its host, the community's moderators or the site's. */
  | { type: "event.cancelled"; data: { eventId: string; communityId: string; title: string } }
  /** The host started it: where to join. */
  | { type: "event.started"; data: { eventId: string; title: string; link: EventLink } };
