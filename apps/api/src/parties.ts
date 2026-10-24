import { parties, partyInvites, partyMembers } from "@anytogether/db";
import {
  ErrorCode,
  type GatewayEvent,
  PartyCreate,
  PartyInvite,
  type PartyPresence,
  PartyTarget,
  PartyUpdate,
  type PartyView,
  maxPartySize,
} from "@anytogether/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { people } from "./people.js";
import { setPresenceExtra } from "./presence.js";

type Party = typeof parties.$inferSelect;

/** The party pieces the call routes need too. */
export function partyService(deps: Pick<Deps, "db" | "valkey">) {
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

  async function view(party: Party): Promise<PartyView> {
    const members = await memberRows(party.id);
    const invites = await db.select().from(partyInvites).where(eq(partyInvites.partyId, party.id));
    const cards = await who.cards([...members.map((m) => m.accountId), ...invites.map((i) => i.accountId)]);
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
      createdAt: party.createdAt.toISOString(),
    };
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
        await tx.delete(partyInvites).where(eq(partyInvites.partyId, partyId));
        return { party: ended as Party, left: [] as string[], ended: true };
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
      return { party: current, left: left.map((m) => m.accountId), ended: false };
    });
    if (!result) return false;
    await setPresenceExtra(deps.valkey, userId, "party", null);
    for (const hook of leaveHooks) await hook(partyId, userId, result.ended);
    if (result.ended) {
      await tell([userId], { type: "party.ended", data: { partyId } });
      return true;
    }
    await tell([...result.left, userId], {
      type: "party.member_left",
      data: { partyId, userId, reason, leaderId: result.party.leaderId },
    });
    await showInPresence(result.party, result.left);
    return true;
  }

  return { live, partyOf, memberIds, view, announce, leave, showInPresence, tell, leaveHooks, callOf };
}

export type PartyService = ReturnType<typeof partyService>;

/** Parties: make one, invite friends, join and leave, a leader who may kick and hand over. */
export function partyRoutes(deps: Deps, service: PartyService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const { live, partyOf, memberIds, view, announce, leave, showInPresence, tell } = service;

  const invited = async (partyId: string, userId: string) =>
    (
      await db
        .select()
        .from(partyInvites)
        .where(and(eq(partyInvites.partyId, partyId), eq(partyInvites.accountId, userId)))
    )[0];

  /** May `me` walk in without an invite: the party is open and its leader is a friend. */
  const open = async (party: Party, me: string) =>
    party.privacy === "friends" && !!party.leaderId && (await who.friends(me, party.leaderId));

  /** Members, invitees and, for an open party, the leader's friends see it; others learn nothing. */
  const visible = async (partyId: string, me: string) => {
    const party = await live(partyId);
    if (party) {
      const members = await memberIds(party.id);
      if (members.includes(me) || (await invited(party.id, me)) || (await open(party, me)))
        return { party, members };
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

  app.post("/parties", async (c) => {
    const me = c.get("userId");
    const { privacy } = await body(c, PartyCreate);
    const current = await partyOf(me);
    if (current) await leave(current.id, me, "left");
    const id = uuidv7();
    const party = await db.transaction(async (tx) => {
      const [made] = await tx.insert(parties).values({ id, leaderId: me, privacy }).returning();
      await tx.insert(partyMembers).values({ partyId: id, accountId: me });
      return made as Party;
    });
    await showInPresence(party, [me]);
    return c.json(await view(party), 201);
  });

  /** The party I am in, and the invites waiting for me. */
  app.get("/me/party", async (c) => {
    const me = c.get("userId");
    const party = await partyOf(me);
    const invites = await db
      .select({ invite: partyInvites, party: parties })
      .from(partyInvites)
      .innerJoin(parties, eq(parties.id, partyInvites.partyId))
      .where(and(eq(partyInvites.accountId, me), isNull(parties.endedAt)))
      .orderBy(asc(partyInvites.createdAt));
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
    });
  });

  app.get("/parties/:id", async (c) => {
    const { party } = await visible(c.req.param("id"), c.get("userId"));
    return c.json(await view(party));
  });

  app.patch("/parties/:id", async (c) => {
    const me = c.get("userId");
    const { party, members } = await asLeader(c.req.param("id"), me);
    const { privacy } = await body(c, PartyUpdate);
    const [updated] = await db.update(parties).set({ privacy }).where(eq(parties.id, party.id)).returning();
    await showInPresence(updated as Party, members);
    return c.json(await announce(updated as Party));
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
    const fresh = await db
      .insert(partyInvites)
      .values(asked.map((accountId) => ({ partyId: party.id, accountId, invitedBy: me })))
      .onConflictDoNothing()
      .returning();
    const from = await who.card(me);
    if (from)
      await tell(
        fresh.map((i) => i.accountId),
        { type: "party.invite", data: { partyId: party.id, from, size: members.length } },
      );
    return c.json(await announce(party));
  });

  app.post("/parties/:id/join", async (c) => {
    const me = c.get("userId");
    const { party, members } = await visible(c.req.param("id"), me);
    if (members.includes(me)) return c.json(await view(party));
    if ((await who.blockedAmong(me, members)).size)
      throw new HttpError(403, ErrorCode.forbidden, "You cannot join this party");
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
      return "joined" as const;
    });
    if (joined === "ended") throw new HttpError(404, ErrorCode.notFound, "No such party");
    if (joined === "full")
      throw new HttpError(409, ErrorCode.full, `A party has at most ${maxPartySize} people`);
    const everyone = await memberIds(party.id);
    const member = await who.card(me);
    if (member)
      await tell(
        everyone.filter((id) => id !== me),
        { type: "party.member_joined", data: { partyId: party.id, member } },
      );
    await showInPresence(party, everyone);
    return c.json(await view(party));
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
    return c.json(await announce(updated as Party));
  });

  return app;
}
