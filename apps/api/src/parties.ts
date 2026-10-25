import { accounts, games, parties, partyInvites, partyMembers, partyRequests } from "@anytogether/db";
import {
  ErrorCode,
  type GatewayEvent,
  LanguageCode,
  PartyCreate,
  PartyInvite,
  type PartyListing,
  type PartyPresence,
  PartyTarget,
  PartyUpdate,
  type PartyView,
  type PublicPartyView,
  TitleId,
  maxPartySize,
} from "@anytogether/shared";
import { type SQL, and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { broadcast, publish, topicsFor } from "./events.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import { noBlockBetween, people } from "./people.js";
import { setPresenceExtra } from "./presence.js";
import { strangerLimiter } from "./ratelimit.js";

type Party = typeof parties.$inferSelect;
type Listing = z.infer<typeof PartyListing>;

/** The columns a public listing sets, or clears. */
const listingColumns = (listing: Listing | null | undefined, before?: Party) =>
  listing
    ? {
        publicJoin: listing.join,
        titleId: listing.titleId === undefined ? (before?.titleId ?? null) : listing.titleId,
        language: listing.language === undefined ? (before?.language ?? null) : listing.language,
        listedAt: before?.publicJoin ? before.listedAt : new Date(),
      }
    : { publicJoin: null, titleId: null, language: null, listedAt: null };

/** The party pieces the call routes need too. */
export function partyService(deps: Pick<Deps, "db" | "valkey">, notes: Notifier) {
  const { db } = deps;
  const who = people(db);

  const memberRows = (partyId: string) =>
    db
      .select()
      .from(partyMembers)
      .where(eq(partyMembers.partyId, partyId))
      .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.accountId));
  const memberIds = async (partyId: string) => (await memberRows(partyId)).map((m) => m.accountId);

  const live = async (partyId: string) => {
    if (!z.string().uuid().safeParse(partyId).success) return undefined;
    return (
      await db
        .select()
        .from(parties)
        .where(and(eq(parties.id, partyId), isNull(parties.endedAt)))
    )[0];
  };

  /** The party someone is in now, if any. */
  const partyOf = async (userId: string) => {
    const [row] = await db
      .select({ party: parties })
      .from(partyMembers)
      .innerJoin(parties, eq(parties.id, partyMembers.partyId))
      .where(and(eq(partyMembers.accountId, userId), isNull(parties.endedAt)));
    return row?.party;
  };

  const tell = async (userIds: string[], event: GatewayEvent) => {
    for (const userId of new Set(userIds)) await publish(deps.valkey, userId, event);
  };

  /** The public lists hear that a listed party came, changed or went. */
  const relist = async (party: Pick<Party, "id" | "titleId">, change: "listed" | "updated" | "unlisted") =>
    broadcast(deps.valkey, topicsFor("discover", party.titleId), {
      type: "discover.changed",
      data: { kind: "party", id: party.id, titleId: party.titleId, change },
    });

  /** Who asked to join, oldest first. */
  const requestRows = (partyId: string) =>
    db
      .select()
      .from(partyRequests)
      .where(eq(partyRequests.partyId, partyId))
      .orderBy(asc(partyRequests.createdAt));

  /** Drops every request to join (the party left the list or ended); the askers hear no. */
  const dropRequests = async (partyId: string) => {
    const dropped = await db.delete(partyRequests).where(eq(partyRequests.partyId, partyId)).returning();
    for (const request of dropped)
      await tell([request.accountId], {
        type: "party.request_answered",
        data: { partyId, answer: "declined" },
      });
  };

  /** Each member's presence shows the party's size and whether friends may walk in. */
  const showInPresence = async (party: Party, members: string[]) => {
    const value: PartyPresence = {
      id: party.id,
      size: members.length,
      max: maxPartySize,
      open: party.privacy === "friends",
    };
    for (const member of members) await setPresenceExtra(deps.valkey, member, "party", value);
  };

  /** Hooks the call routes register, run when someone leaves a party (to leave its call too). */
  const leaveHooks: ((partyId: string, userId: string, ended: boolean) => Promise<void>)[] = [];
  const callOf: { current: (partyId: string) => Promise<PartyView["call"]> } = {
    current: async () => null,
  };

  /** The party as a member sees it; anyone else (a public party's visitor) sees no invites or
   *  requests. */
  async function view(party: Party, forMember = true): Promise<PartyView> {
    const members = await memberRows(party.id);
    const invites = forMember
      ? await db.select().from(partyInvites).where(eq(partyInvites.partyId, party.id))
      : [];
    const requests = forMember && party.publicJoin ? await requestRows(party.id) : [];
    const cards = await who.cards([
      ...members.map((m) => m.accountId),
      ...invites.map((i) => i.accountId),
      ...requests.map((r) => r.accountId),
    ]);
    return {
      id: party.id,
      leaderId: party.leaderId ?? members[0]?.accountId ?? "",
      privacy: party.privacy as PartyView["privacy"],
      members: members.flatMap((m) => {
        const card = cards.get(m.accountId);
        return card ? [{ ...card, joinedAt: m.joinedAt.toISOString() }] : [];
      }),
      invited: invites.flatMap((i) => cards.get(i.accountId) ?? []),
      call: await callOf.current(party.id),
      public: party.publicJoin
        ? {
            join: party.publicJoin as "request" | "open",
            titleId: party.titleId,
            language: party.language,
          }
        : null,
      ...(forMember ? { requests: requests.flatMap((r) => cards.get(r.accountId) ?? []) } : {}),
      createdAt: party.createdAt.toISOString(),
    };
  }

  /** Invites people to the party: they hear it (and get a notification unless `quiet`, for
   *  invites that answer something they asked for and are told about otherwise). Who may be
   *  invited is the caller's to check. Returns who was invited now. */
  async function inviteTo(party: Party, from: string, userIds: string[], options: { quiet?: boolean } = {}) {
    if (!userIds.length) return [];
    const size = (await memberIds(party.id)).length;
    const fresh = await db
      .insert(partyInvites)
      .values(userIds.map((accountId) => ({ partyId: party.id, accountId, invitedBy: from })))
      .onConflictDoNothing()
      .returning();
    const card = await who.card(from);
    if (card)
      await tell(
        fresh.map((i) => i.accountId),
        { type: "party.invite", data: { partyId: party.id, from: card, size } },
      );
    if (!options.quiet)
      for (const invite of fresh)
        await notes.notify(invite.accountId, {
          kind: "party_invite",
          actorId: from,
          subjectId: party.id,
          data: { partyId: party.id, size },
        });
    return fresh.map((i) => i.accountId);
  }

  /** A new party led by `me`, who leaves the one they were in. */
  async function create(me: string, privacy: Party["privacy"], listing?: Listing | null) {
    const current = await partyOf(me);
    if (current) await leave(current.id, me, "left");
    const id = uuidv7();
    const party = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(parties)
        .values({ id, leaderId: me, privacy, ...listingColumns(listing) })
        .returning();
      await tx.insert(partyMembers).values({ partyId: id, accountId: me });
      return made as Party;
    });
    await showInPresence(party, [me]);
    if (party.publicJoin) await relist(party, "listed");
    return party;
  }

  const announce = async (party: Party) => {
    const current = await view(party);
    await tell(
      current.members.map((m) => m.userId),
      { type: "party.updated", data: current },
    );
    return current;
  };

  /** Someone leaves (or is kicked): the earliest member left leads; the last one out ends it. */
  async function leave(partyId: string, userId: string, reason: "left" | "kicked") {
    const result = await db.transaction(async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, partyId)).for("update");
      const removed = await tx
        .delete(partyMembers)
        .where(and(eq(partyMembers.partyId, partyId), eq(partyMembers.accountId, userId)))
        .returning();
      if (!party || !removed.length) return null;
      const left = await tx
        .select()
        .from(partyMembers)
        .where(eq(partyMembers.partyId, partyId))
        .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.accountId));
      if (!left.length) {
        const [ended] = await tx
          .update(parties)
          .set({ endedAt: new Date() })
          .where(eq(parties.id, partyId))
          .returning();
        const invited = await tx.delete(partyInvites).where(eq(partyInvites.partyId, partyId)).returning();
        return {
          party: ended as Party,
          left: [] as string[],
          ended: true,
          invited: invited.map((i) => i.accountId),
        };
      }
      let current = party;
      if (party.leaderId === userId || !party.leaderId) {
        const [moved] = await tx
          .update(parties)
          .set({ leaderId: left[0]?.accountId })
          .where(eq(parties.id, partyId))
          .returning();
        current = moved as Party;
      }
      return { party: current, left: left.map((m) => m.accountId), ended: false, invited: [] as string[] };
    });
    if (!result) return false;
    await setPresenceExtra(deps.valkey, userId, "party", null);
    for (const hook of leaveHooks) await hook(partyId, userId, result.ended);
    if (result.ended) {
      await tell([userId], { type: "party.ended", data: { partyId } });
      if (result.party.publicJoin) {
        await dropRequests(partyId);
        await relist(result.party, "unlisted");
      }
      // An invite to a party that is over is no longer news.
      for (const invitee of result.invited) await notes.withdraw(invitee, "party_invite", partyId);
      return true;
    }
    await tell([...result.left, userId], {
      type: "party.member_left",
      data: { partyId, userId, reason, leaderId: result.party.leaderId },
    });
    await showInPresence(result.party, result.left);
    if (result.party.publicJoin) await relist(result.party, "updated");
    return true;
  }

  /** Parties listed in public that `me` may see: none with a member who blocked them or whom they
   *  blocked, none of a banned leader; newest listing first. */
  async function publicParties(me: string, filter: { titleId?: string; language?: string; limit?: number }) {
    const where: SQL[] = [
      isNotNull(parties.publicJoin),
      isNull(parties.endedAt),
      eq(accounts.status, "active"),
      sql`not exists (select 1 from party_members pm where pm.party_id = ${parties.id}
        and not (${noBlockBetween(me, sql`pm.account_id`)}))`,
    ];
    if (filter.titleId) where.push(eq(parties.titleId, filter.titleId));
    if (filter.language) where.push(eq(parties.language, filter.language));
    const rows = await db
      .select({ party: parties, game: games })
      .from(parties)
      .innerJoin(accounts, eq(accounts.id, parties.leaderId))
      .leftJoin(games, eq(games.titleId, parties.titleId))
      .where(and(...where))
      .orderBy(desc(parties.listedAt), desc(parties.id))
      .limit(filter.limit ?? 50);
    const ids = rows.map((r) => r.party.id);
    const sizes = new Map(
      ids.length
        ? (
            await db
              .select({ partyId: partyMembers.partyId, n: count() })
              .from(partyMembers)
              .where(inArray(partyMembers.partyId, ids))
              .groupBy(partyMembers.partyId)
          ).map((r) => [r.partyId, r.n])
        : [],
    );
    const asked = new Set(
      ids.length
        ? (
            await db
              .select({ partyId: partyRequests.partyId })
              .from(partyRequests)
              .where(and(eq(partyRequests.accountId, me), inArray(partyRequests.partyId, ids)))
          ).map((r) => r.partyId)
        : [],
    );
    const cards = await who.cards(rows.flatMap((r) => (r.party.leaderId ? [r.party.leaderId] : [])));
    return rows.map(
      ({ party, game }): PublicPartyView => ({
        id: party.id,
        host: party.leaderId ? (cards.get(party.leaderId) ?? null) : null,
        titleId: party.titleId,
        game: game ? { names: game.names, iconUrl: game.iconUrl } : null,
        language: party.language,
        join: party.publicJoin as "request" | "open",
        size: sizes.get(party.id) ?? 0,
        max: maxPartySize,
        requested: asked.has(party.id),
        listedAt: (party.listedAt ?? party.createdAt).toISOString(),
      }),
    );
  }

  return {
    live,
    partyOf,
    memberIds,
    view,
    announce,
    leave,
    showInPresence,
    tell,
    leaveHooks,
    callOf,
    notes,
    inviteTo,
    create,
    relist,
    requestRows,
    dropRequests,
    publicParties,
  };
}

export type PartyService = ReturnType<typeof partyService>;

/** Parties: make one, invite friends, join and leave, a leader who may kick and hand over; and, when
 *  the leader lists it in public, strangers who ask to join or walk in. */
export function partyRoutes(deps: Deps, service: PartyService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const strangerLimit = strangerLimiter(deps);
  const family = familyGuard(db);
  const {
    live,
    partyOf,
    memberIds,
    view,
    announce,
    leave,
    showInPresence,
    tell,
    notes,
    inviteTo,
    create,
    relist,
    dropRequests,
    publicParties,
  } = service;

  const invited = async (partyId: string, userId: string) =>
    (
      await db
        .select()
        .from(partyInvites)
        .where(and(eq(partyInvites.partyId, partyId), eq(partyInvites.accountId, userId)))
    )[0];

  /** May `me` walk in without an invite because the party is open to the leader's friends. */
  const openToFriend = async (party: Party, me: string) =>
    party.privacy === "friends" && !!party.leaderId && (await who.friends(me, party.leaderId));

  /** Members, invitees and, for an open party, the leader's friends see it; a public one anyone
   *  sees who has no block with a member; others learn nothing. */
  const visible = async (partyId: string, me: string) => {
    const party = await live(partyId);
    if (party) {
      const members = await memberIds(party.id);
      if (members.includes(me) || (await invited(party.id, me)) || (await openToFriend(party, me)))
        return { party, members };
      if (party.publicJoin && !(await who.blockedAmong(me, members)).size) return { party, members };
    }
    throw new HttpError(404, ErrorCode.notFound, "No such party");
  };

  const asMember = async (partyId: string, me: string) => {
    const found = await visible(partyId, me);
    if (!found.members.includes(me)) throw new HttpError(403, ErrorCode.forbidden, "Join the party first");
    return found;
  };

  const asLeader = async (partyId: string, me: string) => {
    const found = await asMember(partyId, me);
    if (found.party.leaderId !== me)
      throw new HttpError(403, ErrorCode.forbidden, "Only the party leader can do that");
    return found;
  };

  /** A listing's game becomes a catalogue row (a stub until a launcher teaches it). */
  const knowGame = async (titleId: string | null | undefined) => {
    if (titleId) await db.insert(games).values({ titleId }).onConflictDoNothing();
  };

  app.post("/parties", async (c) => {
    const me = c.get("userId");
    const input = await body(c, PartyCreate);
    if (input.public)
      await family.need(
        me,
        "public_matchmaking",
        "Your family settings keep public parties, Find players and share plays off",
      );
    await knowGame(input.public?.titleId);
    const party = await create(me, input.privacy, input.public);
    return c.json(await view(party), 201);
  });

  /** The party I am in, the invites waiting for me, and the public parties I asked to join. */
  app.get("/me/party", async (c) => {
    const me = c.get("userId");
    const party = await partyOf(me);
    const invites = await db
      .select({ invite: partyInvites, party: parties })
      .from(partyInvites)
      .innerJoin(parties, eq(parties.id, partyInvites.partyId))
      .where(and(eq(partyInvites.accountId, me), isNull(parties.endedAt)))
      .orderBy(asc(partyInvites.createdAt));
    const asked = await db
      .select({ partyId: partyRequests.partyId, at: partyRequests.createdAt })
      .from(partyRequests)
      .innerJoin(parties, eq(parties.id, partyRequests.partyId))
      .where(and(eq(partyRequests.accountId, me), isNull(parties.endedAt)))
      .orderBy(asc(partyRequests.createdAt));
    const cards = await who.cards(invites.flatMap((i) => (i.invite.invitedBy ? [i.invite.invitedBy] : [])));
    return c.json({
      party: party ? await view(party) : null,
      invites: await Promise.all(
        invites.map(async ({ invite, party: p }) => ({
          partyId: p.id,
          from: invite.invitedBy ? (cards.get(invite.invitedBy) ?? null) : null,
          size: (await memberIds(p.id)).length,
          invitedAt: invite.createdAt.toISOString(),
        })),
      ),
      requests: asked.map((r) => ({ partyId: r.partyId, askedAt: r.at.toISOString() })),
    });
  });

  /** Parties listed in public, newest first; by game and language. */
  app.get("/parties/public", async (c) => {
    const titleId = c.req.query("titleId");
    const language = c.req.query("language");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    if (language !== undefined && !LanguageCode.safeParse(language).success)
      throw new HttpError(400, ErrorCode.badRequest, "language: a language like en or tr");
    await family.need(
      c.get("userId"),
      "public_matchmaking",
      "Your family settings keep public parties, Find players and share plays off",
    );
    return c.json({ parties: await publicParties(c.get("userId"), { titleId, language }) });
  });

  app.get("/parties/:id", async (c) => {
    const me = c.get("userId");
    const { party, members } = await visible(c.req.param("id"), me);
    return c.json(await view(party, members.includes(me)));
  });

  app.patch("/parties/:id", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asLeader(c.req.param("id"), me);
    const input = await body(c, PartyUpdate);
    if (input.public)
      await family.need(
        me,
        "public_matchmaking",
        "Your family settings keep public parties, Find players and share plays off",
      );
    await knowGame(input.public?.titleId);
    const [updated] = (await db
      .update(parties)
      .set({
        ...(input.privacy ? { privacy: input.privacy } : {}),
        ...(input.public !== undefined ? listingColumns(input.public, party) : {}),
      })
      .where(eq(parties.id, party.id))
      .returning()) as [Party];
    await showInPresence(updated, members);
    if (party.publicJoin && !updated.publicJoin) {
      await dropRequests(party.id);
      await relist(party, "unlisted");
    } else if (!party.publicJoin && updated.publicJoin) await relist(updated, "listed");
    else if (updated.publicJoin) {
      if (party.titleId !== updated.titleId) await relist(party, "unlisted");
      await relist(updated, party.titleId !== updated.titleId ? "listed" : "updated");
    }
    return c.json(await announce(updated));
  });

  app.post("/parties/:id/invites", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asMember(c.req.param("id"), me);
    const { userIds } = await body(c, PartyInvite);
    const asked = [...new Set(userIds)].filter((id) => !members.includes(id));
    const friends = await who.friendsAmong(me, asked);
    if (asked.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only invite your friends");
    if (!asked.length) return c.json(await view(party));
    await inviteTo(party, me, asked);
    return c.json(await announce(party));
  });

  app.post("/parties/:id/join", async (c) => {
    const me = c.get("userId");
    const { party, members } = await visible(c.req.param("id"), me);
    if (members.includes(me)) return c.json(await view(party));
    if ((await who.blockedAmong(me, members)).size)
      throw new HttpError(403, ErrorCode.forbidden, "You cannot join this party");
    if (!(await invited(party.id, me)) && !(await openToFriend(party, me))) {
      if (party.publicJoin !== "open")
        throw new HttpError(403, ErrorCode.forbidden, "Ask the leader to let you in", {
          join: party.publicJoin,
        });
      await family.need(
        me,
        "public_matchmaking",
        "Your family settings keep public parties, Find players and share plays off",
      );
      // Walking into a stranger's party counts like asking to.
      await strangerLimit("joinRequest", me);
    }
    const current = await partyOf(me);
    if (current) await leave(current.id, me, "left");
    const joined = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(parties).where(eq(parties.id, party.id)).for("update");
      if (!locked || locked.endedAt) return "ended" as const;
      const now = await tx.select().from(partyMembers).where(eq(partyMembers.partyId, party.id));
      if (now.length >= maxPartySize) return "full" as const;
      await tx.insert(partyMembers).values({ partyId: party.id, accountId: me });
      await tx
        .delete(partyInvites)
        .where(and(eq(partyInvites.partyId, party.id), eq(partyInvites.accountId, me)));
      await tx
        .delete(partyRequests)
        .where(and(eq(partyRequests.partyId, party.id), eq(partyRequests.accountId, me)));
      return "joined" as const;
    });
    if (joined === "ended") throw new HttpError(404, ErrorCode.notFound, "No such party");
    if (joined === "full")
      throw new HttpError(409, ErrorCode.full, `A party has at most ${maxPartySize} people`);
    await notes.settle(me, "party_invite", party.id);
    const everyone = await memberIds(party.id);
    const member = await who.card(me);
    if (member)
      await tell(
        everyone.filter((id) => id !== me),
        { type: "party.member_joined", data: { partyId: party.id, member } },
      );
    await showInPresence(party, everyone);
    if (party.publicJoin) await relist(party, "updated");
    return c.json(await view(party));
  });

  /** Asks to join a party listed in public; the leader hears it and lets them in with an invite. */
  app.post("/parties/:id/requests", async (c) => {
    const me = c.get("userId");
    const { party, members } = await visible(c.req.param("id"), me);
    if (members.includes(me)) throw new HttpError(409, ErrorCode.conflict, "You are in this party");
    if (!party.publicJoin) throw new HttpError(403, ErrorCode.forbidden, "This party takes no requests");
    await family.need(
      me,
      "public_matchmaking",
      "Your family settings keep public parties, Find players and share plays off",
    );
    if (members.length >= maxPartySize)
      throw new HttpError(409, ErrorCode.full, `A party has at most ${maxPartySize} people`);
    await strangerLimit("joinRequest", me);
    const [made] = await db
      .insert(partyRequests)
      .values({ partyId: party.id, accountId: me })
      .onConflictDoNothing()
      .returning();
    if (made) {
      const from = await who.card(me);
      if (from && party.leaderId)
        await tell([party.leaderId], { type: "party.request", data: { partyId: party.id, from } });
      await announce(party);
    }
    return c.json({ requested: true }, made ? 201 : 200);
  });

  app.delete("/parties/:id/requests/me", async (c) => {
    const me = c.get("userId");
    const party = await live(c.req.param("id"));
    const removed = party
      ? await db
          .delete(partyRequests)
          .where(and(eq(partyRequests.partyId, party.id), eq(partyRequests.accountId, me)))
          .returning()
      : [];
    if (!party || !removed.length) throw new HttpError(404, ErrorCode.notFound, "No such request");
    if (party.leaderId)
      await tell([party.leaderId], {
        type: "party.request_cancelled",
        data: { partyId: party.id, userId: me },
      });
    await announce(party);
    return c.body(null, 204);
  });

  /** The leader answers a request: yes is an invite, which the asker hears and joins with. */
  app.post("/parties/:id/requests/:userId/:answer{accept|decline}", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asLeader(c.req.param("id"), me);
    const userId = c.req.param("userId");
    const accept = c.req.param("answer") === "accept";
    if (accept && members.length >= maxPartySize)
      throw new HttpError(409, ErrorCode.full, `A party has at most ${maxPartySize} people`);
    const removed = z.string().uuid().safeParse(userId).success
      ? await db
          .delete(partyRequests)
          .where(and(eq(partyRequests.partyId, party.id), eq(partyRequests.accountId, userId)))
          .returning()
      : [];
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "No such request");
    if (accept && !(await who.blocked(me, userId))) await inviteTo(party, me, [userId]);
    await tell([userId], {
      type: "party.request_answered",
      data: { partyId: party.id, answer: accept ? "accepted" : "declined" },
    });
    return c.json(await announce(party));
  });

  app.post("/parties/:id/decline", async (c) => {
    const me = c.get("userId");
    const party = await live(c.req.param("id"));
    const removed = party
      ? await db
          .delete(partyInvites)
          .where(and(eq(partyInvites.partyId, party.id), eq(partyInvites.accountId, me)))
          .returning()
      : [];
    if (!party || !removed.length) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    await notes.settle(me, "party_invite", party.id);
    await announce(party);
    return c.body(null, 204);
  });

  app.post("/parties/:id/leave", async (c) => {
    const me = c.get("userId");
    const { party } = await asMember(c.req.param("id"), me);
    await leave(party.id, me, "left");
    return c.body(null, 204);
  });

  app.post("/parties/:id/kick", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asLeader(c.req.param("id"), me);
    const { userId } = await body(c, PartyTarget);
    if (userId === me) throw new HttpError(400, ErrorCode.badRequest, "Leave the party instead");
    if (!members.includes(userId)) throw new HttpError(404, ErrorCode.notFound, "Not in this party");
    await leave(party.id, userId, "kicked");
    return c.body(null, 204);
  });

  app.post("/parties/:id/leader", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asLeader(c.req.param("id"), me);
    const { userId } = await body(c, PartyTarget);
    if (!members.includes(userId)) throw new HttpError(404, ErrorCode.notFound, "Not in this party");
    const [updated] = await db
      .update(parties)
      .set({ leaderId: userId })
      .where(eq(parties.id, party.id))
      .returning();
    if (updated?.publicJoin) await relist(updated, "updated");
    return c.json(await announce(updated as Party));
  });

  return app;
}
