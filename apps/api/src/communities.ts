import {
  type Database,
  accounts,
  communities,
  communityBans,
  communityEvents,
  communityInvites,
  communityMembers,
  conversationMembers,
  conversations,
  eventRsvps,
  games,
  profiles,
} from "@anytogether/db";
import {
  CommunityBan,
  type CommunityCard,
  CommunityCreate,
  CommunityInvite,
  type CommunityMember,
  CommunityOwner,
  type CommunityRole,
  CommunityRoleSet,
  CommunityUpdate,
  type CommunityView,
  ErrorCode,
  EventCreate,
  type EventLink,
  EventStart,
  EventUpdate,
  type EventView,
  type GatewayEvent,
  type LevelBadge,
  RsvpSet,
  type RsvpStatus,
  TitleId,
  conversationMembersKey,
  eventReminderMinutes,
  maxCommunityMembers,
  maxEventDaysAhead,
  maxJoinedCommunities,
  maxOwnedCommunities,
  maxPartySize,
} from "@anytogether/shared";
import { type SQL, and, asc, count, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { iconUrl } from "./art.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { levelsFor } from "./level.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import type { PartyService } from "./parties.js";
import { noBlockBetween, people } from "./people.js";
import { rateLimiter } from "./ratelimit.js";
import type { SharePlayService } from "./sharePlays.js";

type Community = typeof communities.$inferSelect;
type EventRow = typeof communityEvents.$inferSelect;
type Ctx = { db: Database; valkey: Redis };

const Id = z.string().uuid();
const isId = (value: string | undefined): value is string => Id.safeParse(value).success;
/** An event may be started this long before its time. */
const startEarlyMs = 30 * 60_000;
const rank: Record<CommunityRole, number> = { owner: 0, moderator: 1, member: 2 };

const tellAll = async (valkey: Redis, userIds: string[], event: GatewayEvent) => {
  for (const userId of new Set(userIds)) await publish(valkey, userId, event);
};

/** Members of a community, by ID. */
const memberIdsOf = async (db: Database, communityId: string) =>
  (
    await db
      .select({ id: communityMembers.accountId })
      .from(communityMembers)
      .where(eq(communityMembers.communityId, communityId))
  ).map((m) => m.id);

/** Whether `me` may see a community (for reports): a member, an invitee, or anyone not banned
 *  from a public one. */
export async function communityVisibleTo(db: Database, community: Community, me: string) {
  const [row] = await db.execute<{ member: boolean; invited: boolean; banned: boolean }>(sql`
    select exists (select 1 from community_members where community_id = ${community.id}::uuid and account_id = ${me}::uuid) member,
      exists (select 1 from community_invites where community_id = ${community.id}::uuid and account_id = ${me}::uuid) invited,
      exists (select 1 from community_bans where community_id = ${community.id}::uuid and account_id = ${me}::uuid) banned`);
  if (row?.member) return true;
  if (row?.banned) return false;
  return community.visibility === "public" || Boolean(row?.invited);
}

/** Deletes a community with its chat, events and invites: its members hear it is gone. Used by
 *  its owner and by the moderators of the site. */
export async function deleteCommunity(
  ctx: Ctx,
  notes: Notifier | undefined,
  community: Pick<Community, "id">,
  reason: "deleted" | "removed",
) {
  const members = await memberIdsOf(ctx.db, community.id);
  const invited = (
    await ctx.db
      .select({ id: communityInvites.accountId })
      .from(communityInvites)
      .where(eq(communityInvites.communityId, community.id))
  ).map((i) => i.id);
  const [chat] = await ctx.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.communityId, community.id));
  const events = await ctx.db
    .select({ id: communityEvents.id })
    .from(communityEvents)
    .where(eq(communityEvents.communityId, community.id));
  // The chat, its messages, the events and RSVPs go with the row.
  await ctx.db.delete(communities).where(eq(communities.id, community.id));
  if (chat) await ctx.valkey.del(conversationMembersKey(chat.id));
  for (const member of members) {
    await publish(ctx.valkey, member, {
      type: "community.left",
      data: { communityId: community.id, reason },
    });
    if (chat)
      await publish(ctx.valkey, member, {
        type: "conversation.updated",
        data: { conversationId: chat.id, removed: true },
      });
    for (const event of events) {
      await notes?.withdraw(member, "event_reminder", event.id);
      await notes?.withdraw(member, "event_started", event.id);
    }
  }
  for (const invitee of invited) await notes?.withdraw(invitee, "community_invite", community.id);
}

/** Cancels an event: the people going or maybe hear it, and an unread reminder is taken back. */
export async function cancelEvent(ctx: Ctx, notes: Notifier, eventId: string) {
  const [event] = await ctx.db
    .update(communityEvents)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(communityEvents.id, eventId), eq(communityEvents.status, "scheduled")))
    .returning();
  if (!event) return null;
  const rsvps = (
    await ctx.db.select({ id: eventRsvps.accountId }).from(eventRsvps).where(eq(eventRsvps.eventId, eventId))
  ).map((r) => r.id);
  for (const id of rsvps) {
    await notes.withdraw(id, "event_reminder", eventId);
    await notes.withdraw(id, "event_started", eventId);
  }
  await tellAll(ctx.valkey, [...rsvps, ...(await memberIdsOf(ctx.db, event.communityId))], {
    type: "event.cancelled",
    data: { eventId, communityId: event.communityId, title: event.title },
  });
  return { event, rsvps };
}

/** A community owner's account is going away: the longest-serving moderator (or member) takes
 *  over; a community with nobody else in it is deleted. */
export async function handOverCommunities(ctx: Ctx, notes: Notifier | undefined, accountId: string) {
  const owned = await ctx.db.select().from(communities).where(eq(communities.ownerId, accountId));
  for (const community of owned) {
    const [next] = await ctx.db
      .select({ id: communityMembers.accountId })
      .from(communityMembers)
      .innerJoin(accounts, and(eq(accounts.id, communityMembers.accountId), eq(accounts.status, "active")))
      .where(
        and(
          eq(communityMembers.communityId, community.id),
          sql`${communityMembers.accountId} <> ${accountId}`,
        ),
      )
      .orderBy(
        sql`case ${communityMembers.role} when 'moderator' then 0 else 1 end`,
        asc(communityMembers.joinedAt),
      )
      .limit(1);
    if (!next) {
      await deleteCommunity(ctx, notes, community, "deleted");
      continue;
    }
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(communityMembers)
        .set({ role: "owner" })
        .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, next.id)));
      await tx
        .update(communityMembers)
        .set({ role: "member" })
        .where(
          and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, accountId)),
        );
      await tx.update(communities).set({ ownerId: next.id }).where(eq(communities.id, community.id));
    });
  }
}

/** Communities and their events: making, finding and joining them, roles and moderation, the
 *  chat kept in step with the members, RSVPs, reminders and starting an event. */
export function communityRoutes(
  deps: Deps,
  notes: Notifier,
  parties: PartyService,
  shares: SharePlayService,
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const ctx: Ctx = { db, valkey };
  const who = people(db);
  const limit = rateLimiter(valkey, deps.limits);

  const notFound = () => new HttpError(404, ErrorCode.notFound, "No such community");

  const load = async (id: string) => {
    if (!isId(id)) return undefined;
    return (await db.select().from(communities).where(eq(communities.id, id)))[0];
  };
  const roleOf = async (communityId: string, me: string) =>
    (
      await db
        .select({ role: communityMembers.role })
        .from(communityMembers)
        .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.accountId, me)))
    )[0]?.role as CommunityRole | undefined;
  const invitedTo = async (communityId: string, me: string) =>
    (
      await db
        .select()
        .from(communityInvites)
        .where(and(eq(communityInvites.communityId, communityId), eq(communityInvites.accountId, me)))
    )[0];
  const banned = async (communityId: string, me: string) =>
    (
      await db
        .select({ id: communityBans.accountId })
        .from(communityBans)
        .where(and(eq(communityBans.communityId, communityId), eq(communityBans.accountId, me)))
    ).length > 0;

  /** The community, if `me` may see it: anyone not banned sees a public one; members and invitees
   *  see one by invite. Others learn nothing. */
  const visible = async (id: string, me: string) => {
    const community = await load(id);
    if (!community) throw notFound();
    const role = await roleOf(community.id, me);
    if (role) return { community, role };
    if (await banned(community.id, me)) throw notFound();
    if (community.visibility === "invite" && !(await invitedTo(community.id, me))) throw notFound();
    return { community, role: undefined };
  };
  const asMember = async (id: string, me: string) => {
    const found = await visible(id, me);
    if (!found.role) throw new HttpError(403, ErrorCode.forbidden, "Join the community first");
    return { community: found.community, role: found.role };
  };
  const asModerator = async (id: string, me: string) => {
    const found = await asMember(id, me);
    if (found.role === "member")
      throw new HttpError(403, ErrorCode.forbidden, "Only its moderators can do that");
    return found;
  };

  const recount = (communityId: string) =>
    db
      .update(communities)
      .set({
        memberCount: sql`(select count(*) from community_members m where m.community_id = ${communityId}::uuid)::int`,
      })
      .where(eq(communities.id, communityId));

  const chatOf = async (communityId: string) =>
    (await db.select().from(conversations).where(eq(conversations.communityId, communityId)))[0];

  /** Puts someone into the community's chat (muted: a busy community would ring all day), or out. */
  const intoChat = async (communityId: string, userId: string) => {
    const chat = await chatOf(communityId);
    if (!chat) return;
    await db
      .insert(conversationMembers)
      .values({ conversationId: chat.id, accountId: userId, readSeq: chat.lastSeq, muted: true })
      .onConflictDoNothing();
    await valkey.del(conversationMembersKey(chat.id));
    await publish(valkey, userId, { type: "conversation.updated", data: { conversationId: chat.id } });
  };
  const outOfChat = async (communityId: string, userId: string) => {
    const chat = await chatOf(communityId);
    if (!chat) return;
    await db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, chat.id), eq(conversationMembers.accountId, userId)));
    await valkey.del(conversationMembersKey(chat.id));
    await publish(valkey, userId, {
      type: "conversation.updated",
      data: { conversationId: chat.id, removed: true },
    });
  };

  /** Everyone in it hears that something changed. */
  const changed = async (communityId: string) =>
    tellAll(valkey, await memberIdsOf(db, communityId), { type: "community.updated", data: { communityId } });

  const cards = async (rows: Community[], me: string): Promise<CommunityCard[]> => {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const titleIds = [...new Set(rows.flatMap((r) => (r.titleId ? [r.titleId] : [])))];
    const gameRows = titleIds.length
      ? await db.select().from(games).where(inArray(games.titleId, titleIds))
      : [];
    const gameOf = new Map(gameRows.map((g) => [g.titleId, g]));
    const mine = new Map(
      (
        await db
          .select({ id: communityMembers.communityId, role: communityMembers.role })
          .from(communityMembers)
          .where(and(eq(communityMembers.accountId, me), inArray(communityMembers.communityId, ids)))
      ).map((m) => [m.id, m.role as CommunityRole]),
    );
    const invites = new Set(
      (
        await db
          .select({ id: communityInvites.communityId })
          .from(communityInvites)
          .where(and(eq(communityInvites.accountId, me), inArray(communityInvites.communityId, ids)))
      ).map((i) => i.id),
    );
    const upcoming = new Map(
      (
        await db
          .select({ id: communityEvents.communityId, n: count() })
          .from(communityEvents)
          .where(
            and(
              inArray(communityEvents.communityId, ids),
              eq(communityEvents.status, "scheduled"),
              gt(communityEvents.endsAt, new Date()),
            ),
          )
          .groupBy(communityEvents.communityId)
      ).map((r) => [r.id, r.n]),
    );
    return rows.map((r) => {
      const game = r.titleId ? gameOf.get(r.titleId) : undefined;
      return {
        id: r.id,
        name: r.name,
        titleId: r.titleId,
        game: game ? { names: game.names, iconUrl: game.iconUrl } : null,
        description: r.description,
        icon: r.icon,
        iconUrl: iconUrl(deps.publicUrl, r.icon),
        visibility: r.visibility as CommunityCard["visibility"],
        members: r.memberCount,
        maxMembers: maxCommunityMembers,
        role: mine.get(r.id) ?? null,
        invited: invites.has(r.id),
        upcomingEvents: upcoming.get(r.id) ?? 0,
        createdAt: r.createdAt.toISOString(),
      };
    });
  };

  const viewOf = async (community: Community, me: string): Promise<CommunityView> => {
    const [card] = (await cards([community], me)) as [CommunityCard];
    const staff = await db
      .select({ id: communityMembers.accountId, role: communityMembers.role })
      .from(communityMembers)
      .innerJoin(accounts, and(eq(accounts.id, communityMembers.accountId), eq(accounts.status, "active")))
      .where(
        and(
          eq(communityMembers.communityId, community.id),
          inArray(communityMembers.role, ["owner", "moderator"]),
        ),
      )
      .orderBy(asc(communityMembers.joinedAt));
    const byId = await who.cards(staff.map((s) => s.id));
    const chat = card.role ? await chatOf(community.id) : undefined;
    return {
      ...card,
      owner: community.ownerId ? (byId.get(community.ownerId) ?? null) : null,
      moderators: staff.filter((s) => s.role === "moderator").flatMap((s) => byId.get(s.id) ?? []),
      conversationId: chat?.id ?? null,
    };
  };

  /** A game a community or event is about becomes a catalogue row (a stub until taught). */
  const knowGame = async (titleId: string | null | undefined) => {
    if (titleId) await db.insert(games).values({ titleId }).onConflictDoNothing();
  };

  const joinedCount = async (me: string) =>
    (await db.select({ n: count() }).from(communityMembers).where(eq(communityMembers.accountId, me)))[0]
      ?.n ?? 0;

  app.post("/communities", async (c) => {
    const me = c.get("userId");
    const input = await body(c, CommunityCreate);
    const [owned] = await db.select({ n: count() }).from(communities).where(eq(communities.ownerId, me));
    if ((owned?.n ?? 0) >= maxOwnedCommunities)
      throw new HttpError(409, ErrorCode.full, `You can own at most ${maxOwnedCommunities} communities`);
    if ((await joinedCount(me)) >= maxJoinedCommunities)
      throw new HttpError(409, ErrorCode.full, `You can be in at most ${maxJoinedCommunities} communities`);
    await limit("communityCreate", me);
    await knowGame(input.titleId);
    const id = uuidv7();
    const community = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(communities)
        .values({
          id,
          name: input.name,
          titleId: input.titleId ?? null,
          description: input.description || null,
          icon: input.icon,
          visibility: input.visibility,
          ownerId: me,
          memberCount: 1,
        })
        .returning();
      await tx.insert(communityMembers).values({ communityId: id, accountId: me, role: "owner" });
      const chat = uuidv7();
      await tx
        .insert(conversations)
        .values({ id: chat, kind: "group", title: input.name, createdBy: me, communityId: id });
      await tx.insert(conversationMembers).values({ conversationId: chat, accountId: me });
      return made as Community;
    });
    return c.json(await viewOf(community, me), 201);
  });

  /** Public communities, the biggest first; by game, and by a word of the name. */
  app.get("/communities", async (c) => {
    const me = c.get("userId");
    const titleId = c.req.query("titleId");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    const q = (c.req.query("q") ?? "")
      .trim()
      .replace(/[%_\\]/g, "")
      .slice(0, 40);
    const rawLimit = Number(c.req.query("limit") ?? 30);
    const size = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 30;
    const where: SQL[] = [
      eq(communities.visibility, "public"),
      sql`not exists (select 1 from community_bans b where b.community_id = ${communities.id} and b.account_id = ${me}::uuid)`,
    ];
    if (titleId) where.push(eq(communities.titleId, titleId));
    if (q.length >= 2) where.push(ilike(communities.name, `%${q}%`));
    const rows = await db
      .select()
      .from(communities)
      .where(and(...where))
      .orderBy(desc(communities.memberCount), desc(communities.id))
      .limit(size);
    return c.json({ communities: await cards(rows, me) });
  });

  /** The communities I am in, and the invites waiting for me. */
  app.get("/me/communities", async (c) => {
    const me = c.get("userId");
    const joined = await db
      .select({ community: communities })
      .from(communityMembers)
      .innerJoin(communities, eq(communities.id, communityMembers.communityId))
      .where(eq(communityMembers.accountId, me))
      .orderBy(asc(communities.name));
    const invited = await db
      .select({ community: communities, invite: communityInvites })
      .from(communityInvites)
      .innerJoin(communities, eq(communities.id, communityInvites.communityId))
      .where(eq(communityInvites.accountId, me))
      .orderBy(desc(communityInvites.createdAt));
    const inviters = await who.cards(
      invited.flatMap((i) => (i.invite.invitedBy ? [i.invite.invitedBy] : [])),
    );
    const invitedCards = await cards(
      invited.map((i) => i.community),
      me,
    );
    return c.json({
      communities: await cards(
        joined.map((j) => j.community),
        me,
      ),
      invites: invited.map((i, index) => ({
        community: invitedCards[index],
        from: i.invite.invitedBy ? (inviters.get(i.invite.invitedBy) ?? null) : null,
        invitedAt: i.invite.createdAt.toISOString(),
      })),
    });
  });

  app.get("/communities/:id", async (c) => {
    const me = c.get("userId");
    const { community } = await visible(c.req.param("id"), me);
    return c.json(await viewOf(community, me));
  });

  app.patch("/communities/:id", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asModerator(c.req.param("id"), me);
    const input = await body(c, CommunityUpdate);
    if (input.visibility !== undefined && role !== "owner")
      throw new HttpError(403, ErrorCode.forbidden, "Only the owner can change who may join");
    await limit("community", me);
    await knowGame(input.titleId);
    const [updated] = await db
      .update(communities)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.titleId !== undefined ? { titleId: input.titleId } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(communities.id, community.id))
      .returning();
    if (input.name !== undefined) {
      const chat = await chatOf(community.id);
      if (chat) {
        await db.update(conversations).set({ title: input.name }).where(eq(conversations.id, chat.id));
        await tellAll(valkey, await memberIdsOf(db, community.id), {
          type: "conversation.updated",
          data: { conversationId: chat.id },
        });
      }
    }
    await changed(community.id);
    return c.json(await viewOf(updated as Community, me));
  });

  app.delete("/communities/:id", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asMember(c.req.param("id"), me);
    if (role !== "owner") throw new HttpError(403, ErrorCode.forbidden, "Only the owner can delete it");
    await deleteCommunity(ctx, notes, community, "deleted");
    return c.body(null, 204);
  });

  app.post("/communities/:id/join", async (c) => {
    const me = c.get("userId");
    const { community, role } = await visible(c.req.param("id"), me);
    if (role) return c.json(await viewOf(community, me));
    const invite = await invitedTo(community.id, me);
    if (community.visibility === "invite" && !invite)
      throw new HttpError(403, ErrorCode.forbidden, "This community is by invite only");
    if ((await joinedCount(me)) >= maxJoinedCommunities)
      throw new HttpError(409, ErrorCode.full, `You can be in at most ${maxJoinedCommunities} communities`);
    await limit("community", me);
    const joined = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(communities)
        .where(eq(communities.id, community.id))
        .for("update");
      if (!locked) return "gone" as const;
      const [now] = await tx
        .select({ n: count() })
        .from(communityMembers)
        .where(eq(communityMembers.communityId, community.id));
      if ((now?.n ?? 0) >= maxCommunityMembers) return "full" as const;
      await tx
        .insert(communityMembers)
        .values({ communityId: community.id, accountId: me })
        .onConflictDoNothing();
      await tx
        .delete(communityInvites)
        .where(and(eq(communityInvites.communityId, community.id), eq(communityInvites.accountId, me)));
      return "joined" as const;
    });
    if (joined === "gone") throw notFound();
    if (joined === "full")
      throw new HttpError(409, ErrorCode.full, `A community has at most ${maxCommunityMembers} members`);
    await recount(community.id);
    await intoChat(community.id, me);
    await notes.settle(me, "community_invite", community.id);
    await changed(community.id);
    return c.json(await viewOf((await load(community.id)) as Community, me));
  });

  /** Leaving: the owner hands the community over (or deletes it) first. */
  app.post("/communities/:id/leave", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asMember(c.req.param("id"), me);
    if (role === "owner")
      throw new HttpError(409, ErrorCode.conflict, "Hand the community to someone else or delete it first");
    await removeMember(community, me, "left");
    return c.body(null, 204);
  });

  async function removeMember(community: Community, userId: string, reason: "left" | "kicked" | "banned") {
    await db
      .delete(communityMembers)
      .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, userId)));
    // Going or maybe on its events no longer: they are not in it.
    await db.execute(sql`delete from event_rsvps r using community_events e
      where r.event_id = e.id and e.community_id = ${community.id}::uuid and r.account_id = ${userId}::uuid
        and e.ends_at > now()`);
    await recount(community.id);
    await outOfChat(community.id, userId);
    await publish(valkey, userId, { type: "community.left", data: { communityId: community.id, reason } });
    await changed(community.id);
  }

  app.get("/communities/:id/members", async (c) => {
    const me = c.get("userId");
    const { community, role } = await visible(c.req.param("id"), me);
    if (community.visibility === "invite" && !role)
      throw new HttpError(403, ErrorCode.forbidden, "Join the community first");
    const rows = await db
      .select({ member: communityMembers, profile: profiles })
      .from(communityMembers)
      .innerJoin(profiles, eq(profiles.accountId, communityMembers.accountId))
      .innerJoin(accounts, and(eq(accounts.id, communityMembers.accountId), eq(accounts.status, "active")))
      .where(
        and(
          eq(communityMembers.communityId, community.id),
          sql`(${communityMembers.accountId} = ${me}::uuid or ${noBlockBetween(me, communityMembers.accountId)})`,
        ),
      );
    const levels = await levelsFor(
      db,
      me,
      rows.map((r) => r.member.accountId),
    );
    const members = rows
      .map(({ member, profile }): CommunityMember & { level: LevelBadge | null } => ({
        userId: profile.accountId,
        handle: profile.handle,
        displayName: profile.displayName,
        avatar: profile.avatarUrl,
        role: member.role as CommunityRole,
        joinedAt: member.joinedAt.toISOString(),
        level: levels.get(profile.accountId) ?? null,
      }))
      .sort((x, y) => rank[x.role] - rank[y.role] || x.displayName.localeCompare(y.displayName));
    return c.json({ members });
  });

  /** Members invite friends; to a community by invite only, its moderators do. */
  app.post("/communities/:id/invites", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asMember(c.req.param("id"), me);
    if (community.visibility === "invite" && role === "member")
      throw new HttpError(403, ErrorCode.forbidden, "Only its moderators invite people");
    const { userIds } = await body(c, CommunityInvite);
    await limit("community", me);
    const asked = [...new Set(userIds)].filter((id) => id !== me);
    const friends = await who.friendsAmong(me, asked);
    if (asked.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only invite your friends");
    const members = new Set(await memberIdsOf(db, community.id));
    const bannedIds = new Set(
      asked.length
        ? (
            await db
              .select({ id: communityBans.accountId })
              .from(communityBans)
              .where(
                and(eq(communityBans.communityId, community.id), inArray(communityBans.accountId, asked)),
              )
          ).map((b) => b.id)
        : [],
    );
    const fresh = asked.filter((id) => !members.has(id) && !bannedIds.has(id));
    const made = fresh.length
      ? await db
          .insert(communityInvites)
          .values(fresh.map((accountId) => ({ communityId: community.id, accountId, invitedBy: me })))
          .onConflictDoNothing()
          .returning()
      : [];
    const from = await who.card(me);
    for (const invite of made) {
      if (from)
        await publish(valkey, invite.accountId, {
          type: "community.invite",
          data: { communityId: community.id, name: community.name, from },
        });
      await notes.notify(invite.accountId, {
        kind: "community_invite",
        actorId: me,
        subjectId: community.id,
        data: { communityId: community.id, name: community.name, icon: community.icon },
      });
    }
    return c.json({ invited: made.map((i) => i.accountId) });
  });

  app.post("/communities/:id/decline", async (c) => {
    const me = c.get("userId");
    const removed = isId(c.req.param("id"))
      ? await db
          .delete(communityInvites)
          .where(and(eq(communityInvites.communityId, c.req.param("id")), eq(communityInvites.accountId, me)))
          .returning()
      : [];
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    await notes.settle(me, "community_invite", c.req.param("id"));
    return c.body(null, 204);
  });

  /** The target, a member, and that `role` may act on them: moderators on members, the owner on
   *  anyone but themself. */
  const target = async (community: Community, role: CommunityRole, me: string, userId: string) => {
    if (userId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
    const theirs = await roleOf(community.id, userId);
    if (theirs && rank[theirs] <= rank[role])
      throw new HttpError(403, ErrorCode.forbidden, "Only the owner can do that to a moderator");
    return theirs;
  };

  app.put("/communities/:id/members/:userId/role", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asMember(c.req.param("id"), me);
    if (role !== "owner") throw new HttpError(403, ErrorCode.forbidden, "Only the owner names moderators");
    const userId = c.req.param("userId");
    const { role: next } = await body(c, CommunityRoleSet);
    if (!isId(userId) || !(await target(community, role, me, userId)))
      throw new HttpError(404, ErrorCode.notFound, "Not in this community");
    await db
      .update(communityMembers)
      .set({ role: next })
      .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, userId)));
    await changed(community.id);
    return c.json(await viewOf(community, me));
  });

  app.post("/communities/:id/owner", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asMember(c.req.param("id"), me);
    if (role !== "owner") throw new HttpError(403, ErrorCode.forbidden, "Only the owner can hand it over");
    const { userId } = await body(c, CommunityOwner);
    if (userId === me || !(await roleOf(community.id, userId)))
      throw new HttpError(404, ErrorCode.notFound, "Not in this community");
    const [owned] = await db.select({ n: count() }).from(communities).where(eq(communities.ownerId, userId));
    if ((owned?.n ?? 0) >= maxOwnedCommunities)
      throw new HttpError(409, ErrorCode.full, `They own ${maxOwnedCommunities} communities already`);
    await db.transaction(async (tx) => {
      await tx
        .update(communityMembers)
        .set({ role: "owner" })
        .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, userId)));
      await tx
        .update(communityMembers)
        .set({ role: "moderator" })
        .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.accountId, me)));
      await tx
        .update(communities)
        .set({ ownerId: userId, updatedAt: new Date() })
        .where(eq(communities.id, community.id));
    });
    await changed(community.id);
    return c.json(await viewOf((await load(community.id)) as Community, me));
  });

  app.delete("/communities/:id/members/:userId", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asModerator(c.req.param("id"), me);
    const userId = c.req.param("userId");
    if (!isId(userId) || !(await target(community, role, me, userId)))
      throw new HttpError(404, ErrorCode.notFound, "Not in this community");
    await limit("community", me);
    await removeMember(community, userId, "kicked");
    return c.body(null, 204);
  });

  /** Bans someone (a member is put out at once, an invite is taken back); they cannot join again
   *  until unbanned. */
  app.post("/communities/:id/bans", async (c) => {
    const me = c.get("userId");
    const { community, role } = await asModerator(c.req.param("id"), me);
    const { userId, reason } = await body(c, CommunityBan);
    const theirs = await target(community, role, me, userId);
    const [exists] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, userId));
    if (!exists) throw new HttpError(404, ErrorCode.notFound, "No such user");
    await limit("community", me);
    await db
      .insert(communityBans)
      .values({ communityId: community.id, accountId: userId, bannedBy: me, reason: reason || null })
      .onConflictDoNothing();
    const invites = await db
      .delete(communityInvites)
      .where(and(eq(communityInvites.communityId, community.id), eq(communityInvites.accountId, userId)))
      .returning();
    if (invites.length) await notes.withdraw(userId, "community_invite", community.id);
    if (theirs) await removeMember(community, userId, "banned");
    return c.body(null, 204);
  });

  app.get("/communities/:id/bans", async (c) => {
    const me = c.get("userId");
    const { community } = await asModerator(c.req.param("id"), me);
    const rows = await db
      .select()
      .from(communityBans)
      .where(eq(communityBans.communityId, community.id))
      .orderBy(desc(communityBans.createdAt));
    const byId = await who.cards(rows.flatMap((r) => [r.accountId, ...(r.bannedBy ? [r.bannedBy] : [])]));
    return c.json({
      bans: rows.flatMap((r) => {
        const user = byId.get(r.accountId);
        return user
          ? [
              {
                user,
                reason: r.reason,
                by: r.bannedBy ? (byId.get(r.bannedBy) ?? null) : null,
                createdAt: r.createdAt.toISOString(),
              },
            ]
          : [];
      }),
    });
  });

  app.delete("/communities/:id/bans/:userId", async (c) => {
    const me = c.get("userId");
    const { community } = await asModerator(c.req.param("id"), me);
    const userId = c.req.param("userId");
    const removed = isId(userId)
      ? await db
          .delete(communityBans)
          .where(and(eq(communityBans.communityId, community.id), eq(communityBans.accountId, userId)))
          .returning()
      : [];
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "Not banned");
    return c.body(null, 204);
  });

  // Events.

  const eventNotFound = () => new HttpError(404, ErrorCode.notFound, "No such event");

  const eventViews = async (rows: EventRow[], me: string): Promise<EventView[]> => {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const communityRows = await db
      .select()
      .from(communities)
      .where(inArray(communities.id, [...new Set(rows.map((r) => r.communityId))]));
    const communityOf = new Map(communityRows.map((r) => [r.id, r]));
    const titleIds = [...new Set(rows.flatMap((r) => (r.titleId ? [r.titleId] : [])))];
    const gameRows = titleIds.length
      ? await db.select().from(games).where(inArray(games.titleId, titleIds))
      : [];
    const gameOf = new Map(gameRows.map((g) => [g.titleId, g]));
    const rsvps = await db
      .select({ rsvp: eventRsvps })
      .from(eventRsvps)
      .innerJoin(accounts, and(eq(accounts.id, eventRsvps.accountId), eq(accounts.status, "active")))
      .where(inArray(eventRsvps.eventId, ids))
      .orderBy(asc(eventRsvps.createdAt));
    const roles = new Map(
      (
        await db
          .select({ id: communityMembers.communityId, role: communityMembers.role })
          .from(communityMembers)
          .where(
            and(
              eq(communityMembers.accountId, me),
              inArray(communityMembers.communityId, [...communityOf.keys()]),
            ),
          )
      ).map((r) => [r.id, r.role as CommunityRole]),
    );
    const blocked = await who.blockedAmong(
      me,
      rsvps.map((r) => r.rsvp.accountId),
    );
    const cardsById = await who.cards([
      ...rows.flatMap((r) => (r.hostId ? [r.hostId] : [])),
      ...rsvps.map((r) => r.rsvp.accountId),
    ]);
    return rows.map((r) => {
      const community = communityOf.get(r.communityId) as Community;
      const game = r.titleId ? gameOf.get(r.titleId) : undefined;
      const ofEvent = rsvps.filter((x) => x.rsvp.eventId === r.id).map((x) => x.rsvp);
      const role = roles.get(r.communityId);
      return {
        id: r.id,
        communityId: r.communityId,
        community: {
          name: community.name,
          icon: community.icon,
          iconUrl: iconUrl(deps.publicUrl, community.icon),
        },
        host: r.hostId ? (cardsById.get(r.hostId) ?? null) : null,
        title: r.title,
        titleId: r.titleId,
        game: game ? { names: game.names, iconUrl: game.iconUrl } : null,
        description: r.description,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        status: r.status as EventView["status"],
        link: r.link ?? null,
        startedAt: r.startedAt?.toISOString() ?? null,
        going: ofEvent.filter((x) => x.status === "going").length,
        maybe: ofEvent.filter((x) => x.status === "maybe").length,
        mine: (ofEvent.find((x) => x.accountId === me)?.status as RsvpStatus | undefined) ?? null,
        people: ofEvent
          .filter((x) => x.status === "going" && !blocked.has(x.accountId))
          .slice(0, 12)
          .flatMap((x) => cardsById.get(x.accountId) ?? []),
        canEdit: r.hostId === me || role === "owner" || role === "moderator",
        createdAt: r.createdAt.toISOString(),
      };
    });
  };

  /** The event, if `me` may see its community. */
  const visibleEvent = async (id: string, me: string) => {
    if (!isId(id)) throw eventNotFound();
    const [event] = await db.select().from(communityEvents).where(eq(communityEvents.id, id));
    if (!event) throw eventNotFound();
    const found = await visible(event.communityId, me).catch(() => {
      throw eventNotFound();
    });
    return { event, ...found };
  };
  const editable = async (id: string, me: string) => {
    const found = await visibleEvent(id, me);
    if (found.event.hostId !== me && found.role !== "owner" && found.role !== "moderator")
      throw new HttpError(
        403,
        ErrorCode.forbidden,
        "Only its host and the community's moderators can change it",
      );
    if (found.event.status === "cancelled")
      throw new HttpError(409, ErrorCode.conflict, "This event was cancelled");
    return found;
  };

  const rsvpIds = async (eventId: string) =>
    (
      await db.select({ id: eventRsvps.accountId }).from(eventRsvps).where(eq(eventRsvps.eventId, eventId))
    ).map((r) => r.id);
  /** The people going or maybe, the host and the community's members hear about a change. */
  const eventChanged = async (event: EventRow) => {
    const listeners = [...(await rsvpIds(event.id)), ...(await memberIdsOf(db, event.communityId))];
    for (const userId of new Set(listeners)) {
      const [view] = await eventViews([event], userId);
      if (view) await publish(valkey, userId, { type: "event.updated", data: view });
    }
  };

  const checkTimes = (startsAt: Date, endsAt: Date, startedAlready = false) => {
    const now = Date.now();
    if (!startedAlready && startsAt.getTime() < now - 5 * 60_000)
      throw new HttpError(400, ErrorCode.badRequest, "startsAt: a time ahead");
    if (startsAt.getTime() > now + maxEventDaysAhead * 86_400_000)
      throw new HttpError(400, ErrorCode.badRequest, `startsAt: at most ${maxEventDaysAhead} days ahead`);
    if (endsAt <= startsAt) throw new HttpError(400, ErrorCode.badRequest, "The end comes after the start");
  };

  app.post("/communities/:id/events", async (c) => {
    const me = c.get("userId");
    const { community } = await asMember(c.req.param("id"), me);
    const input = await body(c, EventCreate);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    checkTimes(startsAt, endsAt);
    await limit("event", me);
    await knowGame(input.titleId);
    const [event] = await db
      .insert(communityEvents)
      .values({
        id: uuidv7(),
        communityId: community.id,
        hostId: me,
        title: input.title,
        titleId: input.titleId ?? null,
        description: input.description || null,
        startsAt,
        endsAt,
      })
      .returning();
    const made = event as EventRow;
    await db.insert(eventRsvps).values({ eventId: made.id, accountId: me, status: "going" });
    await eventChanged(made);
    return c.json((await eventViews([made], me))[0], 201);
  });

  /** A community's events: coming (the default, soonest first) or past (latest first). */
  app.get("/communities/:id/events", async (c) => {
    const me = c.get("userId");
    const { community } = await visible(c.req.param("id"), me);
    const past = c.req.query("when") === "past";
    const rows = await db
      .select()
      .from(communityEvents)
      .where(
        and(
          eq(communityEvents.communityId, community.id),
          eq(communityEvents.status, "scheduled"),
          past ? lte(communityEvents.endsAt, new Date()) : gt(communityEvents.endsAt, new Date()),
        ),
      )
      .orderBy(past ? desc(communityEvents.startsAt) : asc(communityEvents.startsAt))
      .limit(past ? 20 : 50);
    return c.json({ events: await eventViews(rows, me) });
  });

  /** What is coming up for me: the events of my communities and the ones I said I would go to,
   *  soonest first (a calendar groups them by day in the reader's time zone). */
  app.get("/me/events", async (c) => {
    const me = c.get("userId");
    const rows = await db
      .select()
      .from(communityEvents)
      .where(
        and(
          eq(communityEvents.status, "scheduled"),
          gt(communityEvents.endsAt, new Date()),
          or(
            sql`${communityEvents.communityId} in (select community_id from community_members where account_id = ${me}::uuid)`,
            sql`${communityEvents.id} in (select event_id from event_rsvps where account_id = ${me}::uuid)`,
          ),
        ),
      )
      .orderBy(asc(communityEvents.startsAt))
      .limit(100);
    // An event of a community by invite that I left drops out with it.
    const views = await eventViews(rows, me);
    const allowed = new Set<string>();
    for (const id of new Set(rows.map((r) => r.communityId)))
      if (
        await visible(id, me).then(
          () => true,
          () => false,
        )
      )
        allowed.add(id);
    return c.json({ events: views.filter((v) => allowed.has(v.communityId)) });
  });

  app.get("/events/:id", async (c) => {
    const me = c.get("userId");
    const { event } = await visibleEvent(c.req.param("id"), me);
    return c.json((await eventViews([event], me))[0]);
  });

  app.patch("/events/:id", async (c) => {
    const me = c.get("userId");
    const { event } = await editable(c.req.param("id"), me);
    const input = await body(c, EventUpdate);
    const startsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt;
    const duration = input.durationMinutes ?? (event.endsAt.getTime() - event.startsAt.getTime()) / 60_000;
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    if (input.startsAt || input.durationMinutes) checkTimes(startsAt, endsAt, !input.startsAt);
    await knowGame(input.titleId);
    const moved = startsAt.getTime() !== event.startsAt.getTime();
    const [updated] = await db
      .update(communityEvents)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.titleId !== undefined ? { titleId: input.titleId } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        startsAt,
        endsAt,
        // A new time gets its own reminder.
        ...(moved ? { remindedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(communityEvents.id, event.id))
      .returning();
    await eventChanged(updated as EventRow);
    return c.json((await eventViews([updated as EventRow], me))[0]);
  });

  /** Cancels it (the host or the community's moderators). */
  app.delete("/events/:id", async (c) => {
    const me = c.get("userId");
    const { event } = await editable(c.req.param("id"), me);
    await cancelEvent(ctx, notes, event.id);
    return c.body(null, 204);
  });

  app.put("/events/:id/rsvp", async (c) => {
    const me = c.get("userId");
    const { event, role } = await visibleEvent(c.req.param("id"), me);
    if (!role) throw new HttpError(403, ErrorCode.forbidden, "Join the community first");
    if (event.status === "cancelled")
      throw new HttpError(409, ErrorCode.conflict, "This event was cancelled");
    if (event.endsAt.getTime() <= Date.now())
      throw new HttpError(409, ErrorCode.conflict, "This event is over");
    const { status } = await body(c, RsvpSet);
    await limit("rsvp", me);
    await db
      .insert(eventRsvps)
      .values({ eventId: event.id, accountId: me, status })
      .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.accountId], set: { status } });
    return c.json((await eventViews([event], me))[0]);
  });

  app.delete("/events/:id/rsvp", async (c) => {
    const me = c.get("userId");
    const { event } = await visibleEvent(c.req.param("id"), me);
    await db.delete(eventRsvps).where(and(eq(eventRsvps.eventId, event.id), eq(eventRsvps.accountId, me)));
    await notes.withdraw(me, "event_reminder", event.id);
    return c.json((await eventViews([event], me))[0]);
  });

  /** The host starts it: into their party (a new one when they are in none) or the share play
   *  they host; everyone going or maybe is invited and told where to go. */
  app.post("/events/:id/start", async (c) => {
    const me = c.get("userId");
    const { event } = await visibleEvent(c.req.param("id"), me);
    if (event.hostId !== me) throw new HttpError(403, ErrorCode.forbidden, "Only its host starts it");
    if (event.status === "cancelled")
      throw new HttpError(409, ErrorCode.conflict, "This event was cancelled");
    const now = Date.now();
    if (now < event.startsAt.getTime() - startEarlyMs)
      throw new HttpError(409, ErrorCode.conflict, "It can start 30 minutes before its time");
    if (now >= event.endsAt.getTime()) throw new HttpError(409, ErrorCode.conflict, "This event is over");
    const { kind } = await body(c, EventStart);
    const invitees = (await rsvpIds(event.id)).filter((id) => id !== me);
    const blocked = await who.blockedAmong(me, invitees);
    const guests = invitees.filter((id) => !blocked.has(id));
    let link: EventLink;
    if (kind === "share_play") {
      const share = await shares.hostedBy(me);
      if (!share) throw new HttpError(409, ErrorCode.conflict, "Start a share play in the launcher first");
      if (guests.length) await shares.inviteTo(share, guests);
      link = { kind, id: share.id };
    } else {
      const current = await parties.partyOf(me);
      const party = current ?? (await parties.create(me, "invite"));
      const members = await parties.memberIds(party.id);
      if (current && (party.leaderId ?? members[0]) !== me)
        throw new HttpError(403, ErrorCode.notPartyLeader, "Only your party's leader can bring people in");
      const outside = guests.filter((id) => !members.includes(id)).slice(0, maxPartySize * 4);
      if (outside.length) {
        await parties.inviteTo(party, me, outside, { quiet: true });
        await parties.announce(party);
      }
      link = { kind, id: party.id };
    }
    const [updated] = await db
      .update(communityEvents)
      .set({ link, startedAt: event.startedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(communityEvents.id, event.id))
      .returning();
    const [game] = event.titleId ? await db.select().from(games).where(eq(games.titleId, event.titleId)) : [];
    const [community] = await db.select().from(communities).where(eq(communities.id, event.communityId));
    for (const guest of guests) {
      await publish(valkey, guest, {
        type: "event.started",
        data: { eventId: event.id, title: event.title, link },
      });
      await notes.settle(guest, "event_reminder", event.id);
      await notes.notify(guest, {
        kind: "event_started",
        actorId: me,
        subjectId: event.id,
        data: {
          eventId: event.id,
          communityId: event.communityId,
          community: community?.name ?? "",
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          titleId: event.titleId,
          gameNames: game?.names ?? {},
          link,
        },
      });
    }
    await eventChanged(updated as EventRow);
    return c.json((await eventViews([updated as EventRow], me))[0]);
  });

  /** Reminds everyone going or maybe 15 minutes before an event starts, once per start time.
   *  Returns how many events were reminded. */
  async function sweep(now = Date.now()) {
    const due = await db
      .update(communityEvents)
      .set({ remindedAt: new Date(now) })
      .where(
        and(
          eq(communityEvents.status, "scheduled"),
          isNull(communityEvents.remindedAt),
          lte(communityEvents.startsAt, new Date(now + eventReminderMinutes * 60_000)),
          gt(communityEvents.startsAt, new Date(now - 5 * 60_000)),
        ),
      )
      .returning();
    for (const event of due) {
      const [game] = event.titleId
        ? await db.select().from(games).where(eq(games.titleId, event.titleId))
        : [];
      const [community] = await db.select().from(communities).where(eq(communities.id, event.communityId));
      for (const userId of await rsvpIds(event.id))
        await notes.notify(userId, {
          kind: "event_reminder",
          actorId: event.hostId,
          subjectId: event.id,
          data: {
            eventId: event.id,
            communityId: event.communityId,
            community: community?.name ?? "",
            title: event.title,
            startsAt: event.startsAt.toISOString(),
            titleId: event.titleId,
            gameNames: game?.names ?? {},
          },
        });
    }
    return due.length;
  }

  /** Public communities of a game, for its hub. */
  const ofGame = async (me: string, titleId: string, size = 6) =>
    cards(
      await db
        .select()
        .from(communities)
        .where(
          and(
            eq(communities.visibility, "public"),
            eq(communities.titleId, titleId),
            sql`not exists (select 1 from community_bans b where b.community_id = ${communities.id} and b.account_id = ${me}::uuid)`,
          ),
        )
        .orderBy(desc(communities.memberCount), desc(communities.id))
        .limit(size),
      me,
    );

  return Object.assign(app, { sweepEvents: sweep, communitiesOfGame: ofGame });
}

export type CommunityRoutes = ReturnType<typeof communityRoutes>;
