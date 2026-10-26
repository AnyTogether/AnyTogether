import { gameSessionInvites, gameSessionPlayers, gameSessions, games } from "@anytogether/db";
import {
  ErrorCode,
  type GamePresence,
  GameSessionEndReason,
  type GameSessionEnded,
  GameSessionInvite,
  GameSessionJoin,
  type GameSessionKind,
  type GameSessionLeft,
  type GameSessionMember,
  GameSessionMemberUpdate,
  GameSessionOpen,
  GameSessionUpdate,
  type GameSessionView,
  type GatewayEvent,
  JoinCodeIssue,
  type JoinCodeState,
  type PartyTogether,
  type VersionRule,
  deviceGameSessionsKey,
  devicePresenceKey,
  gameDeparturesKey,
  gameSessionKeepSeconds,
  gameSessionMembersKey,
  gameSessionPropertiesKey,
  joinRefusal,
} from "@anytogether/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { iceServers } from "./calls.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import { recordMeeting } from "./met.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import type { Notifier } from "./notifications.js";
import type { PartyService } from "./parties.js";
import { people } from "./people.js";
import { setPresenceExtra } from "./presence.js";
import { rateLimiter, strangerLimiter } from "./ratelimit.js";

type Session = typeof gameSessions.$inferSelect;

const noPublic = "Your family settings keep public parties, Find players and share plays off";

/** Joining a friend's game: a launcher opens a session for the title it runs, friends see it is
 *  joinable, invites go to friends, and a joiner with the same game version and engine build gets
 *  the details.
 *
 *  Play Together is a session of kind `lan`: it belongs to the host's party (and whoever holds its
 *  join code), the party hears it start, and it ends with its host: when they leave it, their game
 *  exits, they leave the party or their launcher goes away. A `local` session (one screen) only
 *  shows in presence. */
export function gameSessionRoutes(deps: Deps, notes: Notifier, parties: PartyService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const limit = rateLimiter(deps.valkey, deps.limits);
  const strangerLimit = strangerLimiter(deps);
  const family = familyGuard(db);
  const codes = parties.codes;

  const tell = async (userIds: string[], event: GatewayEvent) => {
    for (const userId of new Set(userIds)) await publish(deps.valkey, userId, event);
  };

  const playerIds = async (sessionId: string) =>
    (
      await db
        .select({ id: gameSessionPlayers.accountId })
        .from(gameSessionPlayers)
        .where(eq(gameSessionPlayers.sessionId, sessionId))
        .orderBy(asc(gameSessionPlayers.joinedAt))
    ).map((p) => p.id);

  const live = async (sessionId: string) => {
    if (!z.string().uuid().safeParse(sessionId).success) return undefined;
    return (
      await db
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.id, sessionId), isNull(gameSessions.endedAt)))
    )[0];
  };

  const invitedTo = async (sessionId: string, userId: string) =>
    (
      await db
        .select()
        .from(gameSessionInvites)
        .where(and(eq(gameSessionInvites.sessionId, sessionId), eq(gameSessionInvites.accountId, userId)))
    ).length > 0;

  /** The members of a lan session's party now (none for other kinds or when the party ended). */
  const partyMembers = async (session: Session) => {
    if (session.kind !== "lan" || !session.partyId) return [];
    return (await parties.live(session.partyId)) ? await parties.memberIds(session.partyId) : [];
  };

  /** The party of a lan session hears its view again (Play Together shows in it). */
  const reannounce = async (session: Session) => {
    if (session.kind !== "lan" || !session.partyId) return;
    const party = await parties.live(session.partyId);
    if (party) await parties.announce(party);
  };

  /** The players the gateway lets signal each other, kept a day past the last change or look. */
  const keepMembers = async (sessionId: string, players: string[]) => {
    const write = deps.valkey.multi().del(gameSessionMembersKey(sessionId));
    if (players.length) write.sadd(gameSessionMembersKey(sessionId), ...players);
    await write
      .expire(gameSessionMembersKey(sessionId), gameSessionKeepSeconds)
      .expire(gameSessionPropertiesKey(sessionId), gameSessionKeepSeconds)
      .exec();
  };

  /** A Play Together player's device: if its gateway socket goes and stays gone, it leaves (the
   *  host's ends the session). */
  const watchDevice = async (session: Session, device: string) => {
    if (session.kind !== "lan") return;
    await deps.valkey
      .multi()
      .sadd(deviceGameSessionsKey(device), session.id)
      .expire(deviceGameSessionsKey(device), gameSessionKeepSeconds)
      .exec();
  };

  /** Each player in join order with what they published. */
  const members = async (sessionId: string): Promise<GameSessionMember[]> => {
    const rows = await db
      .select({ id: gameSessionPlayers.accountId, joinedAt: gameSessionPlayers.joinedAt })
      .from(gameSessionPlayers)
      .where(eq(gameSessionPlayers.sessionId, sessionId))
      .orderBy(asc(gameSessionPlayers.joinedAt));
    const published = await deps.valkey.hgetall(gameSessionPropertiesKey(sessionId));
    return rows.map((row) => {
      let own: { device?: string; properties?: Record<string, unknown>; updatedAt?: string } = {};
      try {
        own = JSON.parse(published[row.id] ?? "{}");
      } catch {}
      return {
        userId: row.id,
        device: own.device ?? null,
        properties: own.properties ?? {},
        joinedAt: row.joinedAt.toISOString(),
        updatedAt: own.updatedAt ?? null,
      };
    });
  };

  /** The session; with every player's own properties when the one asking plays in it. */
  async function view(session: Session, players?: string[], forPlayers = false): Promise<GameSessionView> {
    const ids = players ?? (await playerIds(session.id));
    const cards = await who.cards([session.hostId, ...ids]);
    return {
      id: session.id,
      kind: session.kind as GameSessionKind,
      partyId: session.partyId,
      host: cards.get(session.hostId) ?? null,
      titleId: session.titleId,
      gameVersion: session.gameVersion,
      engineBuild: session.engineBuild,
      versionRule: session.versionRule as VersionRule,
      capacity: session.capacity,
      joinable: session.joinable,
      players: ids.flatMap((id) => cards.get(id) ?? []),
      ...(forPlayers
        ? { members: await members(session.id), joinCode: await codes.current("game_session", session.id) }
        : {}),
      properties: session.properties,
      createdAt: session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }

  /** The host's presence (every player's, for Play Together): the game, and whether friends can
   *  walk in (only into an online session; the party or a code gets into the others). */
  const showInPresence = async (session: Session, players: string[]) => {
    const value: GamePresence = {
      sessionId: session.id,
      titleId: session.titleId,
      kind: session.kind as GameSessionKind,
      hostId: session.hostId,
      joinable: session.kind === "online" && session.joinable && players.length < session.capacity,
      players: players.length,
      capacity: session.capacity,
    };
    const shown = session.kind === "lan" ? players : [session.hostId];
    for (const userId of shown) await setPresenceExtra(deps.valkey, userId, "game", value);
  };

  /** Players hear the session as it is now; presence and the party follow. */
  const changed = async (session: Session) => {
    const players = await playerIds(session.id);
    await keepMembers(session.id, players);
    await tell(players, { type: "game_session.updated", data: await view(session, players, true) });
    await showInPresence(session, players);
    await reannounce(session);
  };

  async function end(session: Session, reason: GameSessionEnded = "ended") {
    const players = await playerIds(session.id);
    const audience = await partyMembers(session);
    const invites = await db
      .delete(gameSessionInvites)
      .where(eq(gameSessionInvites.sessionId, session.id))
      .returning();
    await db.delete(gameSessionPlayers).where(eq(gameSessionPlayers.sessionId, session.id));
    const [ended] = await db
      .update(gameSessions)
      .set({ endedAt: new Date() })
      .where(and(eq(gameSessions.id, session.id), isNull(gameSessions.endedAt)))
      .returning();
    if (!ended) return;
    await deps.valkey.del(gameSessionMembersKey(session.id), gameSessionPropertiesKey(session.id));
    await codes.revoke("game_session", session.id);
    for (const userId of new Set([session.hostId, ...players]))
      await setPresenceExtra(deps.valkey, userId, "game", null);
    await tell([...players, ...invites.map((i) => i.accountId), ...audience], {
      type: "game_session.ended",
      data: { sessionId: session.id, reason },
    });
    for (const invite of invites) await notes.withdraw(invite.accountId, "game_invite", session.id);
    await reannounce(session);
  }

  /** A player (not the host) goes; the others hear it and the session goes on. */
  async function removePlayer(session: Session, userId: string, reason: GameSessionLeft) {
    const removed = await db
      .delete(gameSessionPlayers)
      .where(and(eq(gameSessionPlayers.sessionId, session.id), eq(gameSessionPlayers.accountId, userId)))
      .returning();
    if (!removed.length) return false;
    await deps.valkey.hdel(gameSessionPropertiesKey(session.id), userId);
    await setPresenceExtra(deps.valkey, userId, "game", null);
    const players = await playerIds(session.id);
    await tell([...players, userId], {
      type: "game_session.member_left",
      data: { sessionId: session.id, userId, reason },
    });
    await changed(session);
    return true;
  }

  /** The session someone plays in now, if any. */
  const playingIn = async (userId: string) =>
    (
      await db
        .select({ session: gameSessions })
        .from(gameSessionPlayers)
        .innerJoin(gameSessions, eq(gameSessions.id, gameSessionPlayers.sessionId))
        .where(eq(gameSessionPlayers.accountId, userId))
    )[0]?.session;

  /** Out of whatever session someone plays in: the host's ends, a player's goes on without them. */
  async function leaveCurrent(userId: string, hostReason: GameSessionEnded = "replaced") {
    const current = await playingIn(userId);
    const hosted = (
      await db
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.hostId, userId), isNull(gameSessions.endedAt)))
    )[0];
    if (hosted) await end(hosted, hostReason);
    if (!current || current.id === hosted?.id) return;
    await removePlayer(current, userId, "left");
  }

  /** Players, invitees and, while it is joinable, the host's friends see an online session; the
   *  party sees its Play Together; only players see a local one. Others learn nothing. */
  const visible = async (sessionId: string, me: string) => {
    const session = await live(sessionId);
    if (session) {
      const players = await playerIds(session.id);
      if (players.includes(me)) return { session, players };
      if (session.kind === "lan") {
        if ((await invitedTo(session.id, me)) || (await partyMembers(session)).includes(me))
          return { session, players };
      } else if (
        session.kind === "online" &&
        ((await invitedTo(session.id, me)) || (session.joinable && (await who.friends(me, session.hostId))))
      )
        return { session, players };
    }
    throw new HttpError(404, ErrorCode.notFound, "No such game session");
  };

  const asHost = async (sessionId: string, me: string) => {
    const found = await visible(sessionId, me);
    if (found.session.hostId !== me)
      throw new HttpError(403, ErrorCode.forbidden, "Only the host can do that");
    return found;
  };

  /** The Play Together session running in a party, if any. */
  const lanOfParty = async (partyId: string) =>
    (
      await db
        .select()
        .from(gameSessions)
        .where(
          and(eq(gameSessions.partyId, partyId), eq(gameSessions.kind, "lan"), isNull(gameSessions.endedAt)),
        )
    )[0];

  // The party view shows its Play Together game; leaving the party leaves it (the host's ends).
  parties.togetherOf.current = async (partyId): Promise<PartyTogether | null> => {
    const session = await lanOfParty(partyId);
    if (!session) return null;
    return {
      sessionId: session.id,
      hostId: session.hostId,
      titleId: session.titleId,
      gameVersion: session.gameVersion,
      engineBuild: session.engineBuild,
      versionRule: session.versionRule as VersionRule,
      players: await playerIds(session.id),
      capacity: session.capacity,
      startedAt: session.createdAt.toISOString(),
    };
  };
  parties.leaveHooks.push(async (partyId, userId) => {
    const session = await lanOfParty(partyId);
    if (!session) return;
    if (session.hostId === userId) return end(session, "host_left_party");
    await removePlayer(session, userId, "left_party");
  });

  app.post("/game-sessions", async (c) => {
    const me = c.get("userId");
    const input = await body(c, GameSessionOpen);
    await family.mayPlay(me, input.titleId);
    await limit("gameSession", me);
    const party = input.kind === "lan" ? await parties.partyOf(me) : undefined;
    if (party) {
      const running = await lanOfParty(party.id);
      if (running && running.hostId !== me)
        throw new HttpError(409, ErrorCode.conflict, "Your party is already playing together", {
          sessionId: running.id,
        });
    }
    await leaveCurrent(me);
    await db.insert(games).values({ titleId: input.titleId }).onConflictDoNothing();
    let session: Session;
    try {
      session = await db.transaction(async (tx) => {
        const [made] = await tx
          .insert(gameSessions)
          .values({ id: uuidv7(), hostId: me, ...input, partyId: party?.id ?? null })
          .returning();
        await tx.insert(gameSessionPlayers).values({ sessionId: (made as Session).id, accountId: me });
        return made as Session;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new HttpError(409, ErrorCode.conflict, "Your party is already playing together");
      throw error;
    }
    await keepMembers(session.id, [me]);
    await watchDevice(session, c.get("sessionId"));
    await showInPresence(session, [me]);
    if (party) {
      const others = (await parties.memberIds(party.id)).filter((id) => id !== me);
      await tell(others, {
        type: "game_session.started",
        data: { partyId: party.id, session: await view(session, [me]) },
      });
      await reannounce(session);
    }
    return c.json(await view(session, [me], true), 201);
  });

  /** The session I play in, and invites waiting for me. */
  app.get("/me/game-session", async (c) => {
    const me = c.get("userId");
    const current = await playingIn(me);
    const invites = await db
      .select({ invite: gameSessionInvites, session: gameSessions })
      .from(gameSessionInvites)
      .innerJoin(gameSessions, eq(gameSessions.id, gameSessionInvites.sessionId))
      .where(and(eq(gameSessionInvites.accountId, me), isNull(gameSessions.endedAt)))
      .orderBy(asc(gameSessionInvites.createdAt));
    const cards = await who.cards(invites.flatMap((i) => (i.invite.invitedBy ? [i.invite.invitedBy] : [])));
    return c.json({
      session: current ? await view(current, undefined, true) : null,
      invites: invites.map(({ invite, session }) => ({
        sessionId: session.id,
        kind: session.kind,
        from: invite.invitedBy ? (cards.get(invite.invitedBy) ?? null) : null,
        titleId: session.titleId,
        gameVersion: session.gameVersion,
        engineBuild: session.engineBuild,
        versionRule: session.versionRule,
        invitedAt: invite.createdAt.toISOString(),
      })),
    });
  });

  app.get("/game-sessions/:id", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    const playing = players.includes(me);
    if (playing) await keepMembers(session.id, players);
    return c.json(await view(session, players, playing));
  });

  /** A player in it, or 403 for someone who may only look. */
  const asPlayer = async (sessionId: string, me: string) => {
    const found = await visible(sessionId, me);
    if (!found.players.includes(me)) throw new HttpError(403, ErrorCode.forbidden, "Join the game first");
    return found;
  };

  /** A player publishes their own properties (where their launcher takes packets, a public key),
   *  replacing what they had; the other players get the session as it is now. */
  app.put("/game-sessions/:id/members/me", async (c) => {
    const me = c.get("userId");
    const { session } = await asPlayer(c.req.param("id"), me);
    const { properties } = await body(c, GameSessionMemberUpdate);
    await deps.valkey.hset(
      gameSessionPropertiesKey(session.id),
      me,
      JSON.stringify({ device: c.get("sessionId"), properties, updatedAt: new Date().toISOString() }),
    );
    await watchDevice(session, c.get("sessionId"));
    await changed(session);
    return c.json(await view(session, undefined, true));
  });

  /** STUN and TURN for the players' own connections, as calls get them; asking again renews them. */
  app.get("/game-sessions/:id/ice-servers", async (c) => {
    const me = c.get("userId");
    const { session, players } = await asPlayer(c.req.param("id"), me);
    await keepMembers(session.id, players);
    return c.json(iceServers(deps.turn, me));
  });

  app.patch("/game-sessions/:id", async (c) => {
    const me = c.get("userId");
    const { session, players } = await asHost(c.req.param("id"), me);
    const input = await body(c, GameSessionUpdate);
    if (input.capacity !== undefined && input.capacity < players.length)
      throw new HttpError(409, ErrorCode.conflict, "More players are in it already");
    const [updated] = await db
      .update(gameSessions)
      .set(input)
      .where(eq(gameSessions.id, session.id))
      .returning();
    await changed(updated as Session);
    return c.json(await view(updated as Session, undefined, true));
  });

  /** The host ends it; `?reason=game_exited` when their game exited. */
  app.delete("/game-sessions/:id", async (c) => {
    const { session } = await asHost(c.req.param("id"), c.get("userId"));
    const reason = GameSessionEndReason.safeParse(c.req.query("reason"));
    await end(session, reason.success ? reason.data : "ended");
    return c.body(null, 204);
  });

  app.post("/game-sessions/:id/invites", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    if (!players.includes(me)) throw new HttpError(403, ErrorCode.forbidden, "Join the game first");
    if (session.kind === "local")
      throw new HttpError(409, ErrorCode.conflict, "Nobody joins a game on one screen");
    const { userIds } = await body(c, GameSessionInvite);
    const asked = [...new Set(userIds)].filter((id) => !players.includes(id));
    const friends = await who.friendsAmong(me, asked);
    if (asked.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only invite your friends");
    if (session.kind === "lan") {
      const party = await partyMembers(session);
      if (asked.some((id) => !party.includes(id)))
        throw new HttpError(
          403,
          ErrorCode.forbidden,
          "Play Together is for your party; give them the join code",
        );
    }
    const fresh = asked.length
      ? await db
          .insert(gameSessionInvites)
          .values(asked.map((accountId) => ({ sessionId: session.id, accountId, invitedBy: me })))
          .onConflictDoNothing()
          .returning()
      : [];
    await announceInvites(
      session,
      me,
      fresh.map((i) => i.accountId),
    );
    return c.json({ invited: fresh.map((i) => i.accountId) });
  });

  /** The invited hear it and get a notification. */
  async function announceInvites(session: Session, from: string, invited: string[]) {
    const card = await who.card(from);
    if (card)
      await tell(invited, {
        type: "game_session.invite",
        data: {
          sessionId: session.id,
          from: card,
          titleId: session.titleId,
          gameVersion: session.gameVersion,
          engineBuild: session.engineBuild,
        },
      });
    if (!invited.length) return;
    const [game] = await db
      .select({ names: games.names })
      .from(games)
      .where(eq(games.titleId, session.titleId));
    for (const accountId of invited)
      await notes.notify(accountId, {
        kind: "game_invite",
        actorId: from,
        subjectId: session.id,
        data: { sessionId: session.id, titleId: session.titleId, gameNames: game?.names ?? {} },
      });
  }

  /** Accepting an invite, walking into a friend's joinable game, or joining the party's Play
   *  Together: the joiner gets the details. A different game version or engine build is refused
   *  with the reason (`game_version` or `engine`), both versions, and who should update. */
  app.post("/game-sessions/:id/join", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    if (players.includes(me)) return c.json(await view(session, players, true));
    const input = await body(c, GameSessionJoin);
    const refusal = joinRefusal(
      {
        gameVersion: session.gameVersion,
        engineBuild: session.engineBuild,
        versionRule: session.versionRule as VersionRule,
      },
      input,
    );
    if (refusal)
      throw new HttpError(
        409,
        ErrorCode.versionMismatch,
        refusal.reason === "engine"
          ? `This game needs engine build ${session.engineBuild}`
          : `This game needs version ${session.gameVersion}`,
        { ...refusal },
      );
    if ((await who.blockedAmong(me, players)).size)
      throw new HttpError(403, ErrorCode.forbidden, "You cannot join this game");
    await family.mayPlay(me, session.titleId);
    await leaveCurrent(me);
    const joined = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(gameSessions)
        .where(eq(gameSessions.id, session.id))
        .for("update");
      if (!locked || locked.endedAt) return "ended" as const;
      const now = await tx
        .select()
        .from(gameSessionPlayers)
        .where(eq(gameSessionPlayers.sessionId, session.id));
      if (now.length >= locked.capacity) return "full" as const;
      await tx.insert(gameSessionPlayers).values({ sessionId: session.id, accountId: me });
      await tx
        .delete(gameSessionInvites)
        .where(and(eq(gameSessionInvites.sessionId, session.id), eq(gameSessionInvites.accountId, me)));
      return "joined" as const;
    });
    if (joined === "ended") throw new HttpError(404, ErrorCode.notFound, "No such game session");
    if (joined === "full") throw new HttpError(409, ErrorCode.full, "This game is full");
    await notes.settle(me, "game_invite", session.id);
    await watchDevice(session, c.get("sessionId"));
    const member = await who.card(me);
    if (member)
      await tell(players, { type: "game_session.member_joined", data: { sessionId: session.id, member } });
    await changed(session);
    await recordMeeting(deps, me, players, "game_session", session.titleId);
    return c.json(await view(session, undefined, true));
  });

  app.post("/game-sessions/:id/decline", async (c) => {
    const session = await live(c.req.param("id"));
    const removed = session
      ? await db
          .delete(gameSessionInvites)
          .where(
            and(
              eq(gameSessionInvites.sessionId, session.id),
              eq(gameSessionInvites.accountId, c.get("userId")),
            ),
          )
          .returning()
      : [];
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    await notes.settle(c.get("userId"), "game_invite", session?.id ?? "");
    return c.body(null, 204);
  });

  app.post("/game-sessions/:id/leave", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    if (!players.includes(me)) throw new HttpError(404, ErrorCode.notFound, "Not in this game");
    if (session.hostId === me) await end(session, "host_left");
    else await removePlayer(session, me, "left");
    return c.body(null, 204);
  });

  /** The host hands out a join code (in place of the one before): whoever holds it may join. */
  app.post("/game-sessions/:id/code", async (c) => {
    const me = c.get("userId");
    const { session } = await asHost(c.req.param("id"), me);
    if (session.kind === "local")
      throw new HttpError(409, ErrorCode.conflict, "Nobody joins a game on one screen");
    const { hours } = await body(c, JoinCodeIssue);
    await assertNotMuted(db, me);
    return c.json(await codes.issue("game_session", session.id, me, hours), 201);
  });

  app.delete("/game-sessions/:id/code", async (c) => {
    const { session } = await asHost(c.req.param("id"), c.get("userId"));
    await codes.revoke("game_session", session.id);
    return c.body(null, 204);
  });

  /** What a session's join code opens, as `me` (or anyone, signed out) sees it; nothing for
   *  someone with a block either way with a player, or for a local session. */
  async function codeTarget(sessionId: string, me?: string) {
    const session = await live(sessionId);
    if (!session || session.kind === "local") return undefined;
    const players = await playerIds(session.id);
    if (me && (await who.blockedAmong(me, players)).size) return undefined;
    const [game] = await db.select().from(games).where(eq(games.titleId, session.titleId));
    const state: JoinCodeState | undefined = !me
      ? undefined
      : players.includes(me)
        ? "member"
        : (await invitedTo(session.id, me))
          ? "invited"
          : "none";
    return {
      host: await who.card(session.hostId),
      game: {
        titleId: session.titleId,
        title: null,
        names: game?.names ?? {},
        iconUrl: game?.iconUrl ?? null,
      },
      size: players.length,
      max: session.capacity,
      state,
    };
  }

  /** Redeeming a session's code: the holder is invited at once (a child follows their family's
   *  rules for a stranger's game). */
  async function askWithCode(sessionId: string, me: string) {
    const session = await live(sessionId);
    if (!session || session.kind === "local")
      throw new HttpError(404, ErrorCode.notFound, "No such game session");
    const players = await playerIds(session.id);
    if (players.includes(me)) throw new HttpError(409, ErrorCode.conflict, "You are in this game");
    if ((await who.blockedAmong(me, players)).size)
      throw new HttpError(404, ErrorCode.notFound, "No such game session");
    const friend = await who.friends(me, session.hostId);
    if (!friend) await family.need(me, "public_matchmaking", noPublic);
    await family.mayMessage(me, players);
    if (await invitedTo(session.id, me)) return { state: "invited" as const, made: false };
    if (players.length >= session.capacity) throw new HttpError(409, ErrorCode.full, "This game is full");
    if (!friend) await strangerLimit("joinRequest", me);
    const fresh = await db
      .insert(gameSessionInvites)
      .values({ sessionId: session.id, accountId: me, invitedBy: session.hostId })
      .onConflictDoNothing()
      .returning();
    await announceInvites(session, session.hostId, fresh.length ? [me] : []);
    return { state: "invited" as const, made: fresh.length > 0 };
  }

  /** Devices whose gateway socket closed and did not come back within the grace: a Play Together
   *  player leaves, a host's session ends. Run every few seconds; returns how many devices went. */
  async function sweepDepartures(now = Date.now()) {
    const due = await deps.valkey.zrangebyscore(gameDeparturesKey, 0, now, "LIMIT", 0, 100);
    let gone = 0;
    for (const entry of due) {
      if (!(await deps.valkey.zrem(gameDeparturesKey, entry))) continue;
      const [userId, device] = entry.split(":") as [string, string];
      if (!userId || !device || (await deps.valkey.exists(devicePresenceKey(userId, device)))) continue;
      for (const id of await deps.valkey.smembers(deviceGameSessionsKey(device))) {
        const session = await live(id);
        if (!session) continue;
        if (session.hostId === userId) await end(session, "host_gone");
        else await removePlayer(session, userId, "gone");
      }
      await deps.valkey.del(deviceGameSessionsKey(device));
      gone++;
    }
    return gone;
  }

  return Object.assign(app, { codeTarget, askWithCode, sweepDepartures });
}

export type GameSessionService = ReturnType<typeof gameSessionRoutes>;
