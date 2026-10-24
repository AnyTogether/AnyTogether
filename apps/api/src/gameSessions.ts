import { gameSessionInvites, gameSessionPlayers, gameSessions, games } from "@anytogether/db";
import {
  ErrorCode,
  type GamePresence,
  GameSessionInvite,
  GameSessionJoin,
  type GameSessionMember,
  GameSessionMemberUpdate,
  GameSessionOpen,
  GameSessionUpdate,
  type GameSessionView,
  type GatewayEvent,
  gameSessionKeepSeconds,
  gameSessionMembersKey,
  gameSessionPropertiesKey,
} from "@anytogether/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { iceServers } from "./calls.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import { people } from "./people.js";
import { setPresenceExtra } from "./presence.js";
import { rateLimiter } from "./ratelimit.js";

type Session = typeof gameSessions.$inferSelect;

/** Joining a friend's game: a launcher opens a session for the title it runs, friends see it is
 *  joinable, invites go to friends, and a joiner with the same game version and engine build gets
 *  the details. */
export function gameSessionRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const limit = rateLimiter(deps.valkey, deps.limits);

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

  /** The players the gateway lets signal each other, kept a day past the last change or look. */
  const keepMembers = async (sessionId: string, players: string[]) => {
    const write = deps.valkey.multi().del(gameSessionMembersKey(sessionId));
    if (players.length) write.sadd(gameSessionMembersKey(sessionId), ...players);
    await write
      .expire(gameSessionMembersKey(sessionId), gameSessionKeepSeconds)
      .expire(gameSessionPropertiesKey(sessionId), gameSessionKeepSeconds)
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
      host: cards.get(session.hostId) ?? null,
      titleId: session.titleId,
      gameVersion: session.gameVersion,
      engineBuild: session.engineBuild,
      capacity: session.capacity,
      joinable: session.joinable,
      players: ids.flatMap((id) => cards.get(id) ?? []),
      ...(forPlayers ? { members: await members(session.id) } : {}),
      properties: session.properties,
      createdAt: session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }

  /** The host's presence: the game, and whether friends can walk in. */
  const showInPresence = async (session: Session, players: number) => {
    const value: GamePresence = {
      sessionId: session.id,
      titleId: session.titleId,
      joinable: session.joinable && players < session.capacity,
      players,
      capacity: session.capacity,
    };
    await setPresenceExtra(deps.valkey, session.hostId, "game", value);
  };

  /** Players hear the session as it is now; the host's presence follows. */
  const changed = async (session: Session) => {
    const players = await playerIds(session.id);
    await keepMembers(session.id, players);
    await tell(players, { type: "game_session.updated", data: await view(session, players, true) });
    await showInPresence(session, players.length);
  };

  async function end(session: Session) {
    const players = await playerIds(session.id);
    const invites = await db
      .delete(gameSessionInvites)
      .where(eq(gameSessionInvites.sessionId, session.id))
      .returning();
    await db.delete(gameSessionPlayers).where(eq(gameSessionPlayers.sessionId, session.id));
    await db.update(gameSessions).set({ endedAt: new Date() }).where(eq(gameSessions.id, session.id));
    await deps.valkey.del(gameSessionMembersKey(session.id), gameSessionPropertiesKey(session.id));
    await setPresenceExtra(deps.valkey, session.hostId, "game", null);
    await tell([...players, ...invites.map((i) => i.accountId)], {
      type: "game_session.ended",
      data: { sessionId: session.id },
    });
    for (const invite of invites) await notes.withdraw(invite.accountId, "game_invite", session.id);
  }

  /** Out of whatever session someone plays in: the host's ends, a player's goes on without them. */
  async function leaveCurrent(userId: string) {
    const [row] = await db
      .select({ session: gameSessions })
      .from(gameSessionPlayers)
      .innerJoin(gameSessions, eq(gameSessions.id, gameSessionPlayers.sessionId))
      .where(eq(gameSessionPlayers.accountId, userId));
    const hosted = (
      await db
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.hostId, userId), isNull(gameSessions.endedAt)))
    )[0];
    if (hosted) await end(hosted);
    if (!row || row.session.id === hosted?.id) return;
    await db
      .delete(gameSessionPlayers)
      .where(and(eq(gameSessionPlayers.sessionId, row.session.id), eq(gameSessionPlayers.accountId, userId)));
    await deps.valkey.hdel(gameSessionPropertiesKey(row.session.id), userId);
    await changed(row.session);
  }

  /** Players, invitees and, while it is joinable, the host's friends see it; others learn nothing. */
  const visible = async (sessionId: string, me: string) => {
    const session = await live(sessionId);
    if (session) {
      const players = await playerIds(session.id);
      if (
        players.includes(me) ||
        (await invitedTo(session.id, me)) ||
        (session.joinable && (await who.friends(me, session.hostId)))
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

  app.post("/game-sessions", async (c) => {
    const me = c.get("userId");
    const input = await body(c, GameSessionOpen);
    await limit("gameSession", me);
    await leaveCurrent(me);
    await db.insert(games).values({ titleId: input.titleId }).onConflictDoNothing();
    const session = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(gameSessions)
        .values({ id: uuidv7(), hostId: me, ...input })
        .returning();
      await tx.insert(gameSessionPlayers).values({ sessionId: (made as Session).id, accountId: me });
      return made as Session;
    });
    await keepMembers(session.id, [me]);
    await showInPresence(session, 1);
    return c.json(await view(session, [me], true), 201);
  });

  /** The session I play in, and invites waiting for me. */
  app.get("/me/game-session", async (c) => {
    const me = c.get("userId");
    const [row] = await db
      .select({ session: gameSessions })
      .from(gameSessionPlayers)
      .innerJoin(gameSessions, eq(gameSessions.id, gameSessionPlayers.sessionId))
      .where(eq(gameSessionPlayers.accountId, me));
    const invites = await db
      .select({ invite: gameSessionInvites, session: gameSessions })
      .from(gameSessionInvites)
      .innerJoin(gameSessions, eq(gameSessions.id, gameSessionInvites.sessionId))
      .where(and(eq(gameSessionInvites.accountId, me), isNull(gameSessions.endedAt)))
      .orderBy(asc(gameSessionInvites.createdAt));
    const cards = await who.cards(invites.flatMap((i) => (i.invite.invitedBy ? [i.invite.invitedBy] : [])));
    return c.json({
      session: row ? await view(row.session, undefined, true) : null,
      invites: invites.map(({ invite, session }) => ({
        sessionId: session.id,
        from: invite.invitedBy ? (cards.get(invite.invitedBy) ?? null) : null,
        titleId: session.titleId,
        gameVersion: session.gameVersion,
        engineBuild: session.engineBuild,
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

  app.delete("/game-sessions/:id", async (c) => {
    const { session } = await asHost(c.req.param("id"), c.get("userId"));
    await end(session);
    return c.body(null, 204);
  });

  app.post("/game-sessions/:id/invites", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    if (!players.includes(me)) throw new HttpError(403, ErrorCode.forbidden, "Join the game first");
    const { userIds } = await body(c, GameSessionInvite);
    const asked = [...new Set(userIds)].filter((id) => !players.includes(id));
    const friends = await who.friendsAmong(me, asked);
    if (asked.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only invite your friends");
    const fresh = asked.length
      ? await db
          .insert(gameSessionInvites)
          .values(asked.map((accountId) => ({ sessionId: session.id, accountId, invitedBy: me })))
          .onConflictDoNothing()
          .returning()
      : [];
    const from = await who.card(me);
    if (from)
      await tell(
        fresh.map((i) => i.accountId),
        {
          type: "game_session.invite",
          data: {
            sessionId: session.id,
            from,
            titleId: session.titleId,
            gameVersion: session.gameVersion,
            engineBuild: session.engineBuild,
          },
        },
      );
    if (fresh.length) {
      const [game] = await db
        .select({ names: games.names })
        .from(games)
        .where(eq(games.titleId, session.titleId));
      for (const invite of fresh)
        await notes.notify(invite.accountId, {
          kind: "game_invite",
          actorId: me,
          subjectId: session.id,
          data: { sessionId: session.id, titleId: session.titleId, gameNames: game?.names ?? {} },
        });
    }
    return c.json({ invited: fresh.map((i) => i.accountId) });
  });

  /** Accepting an invite, or walking into a friend's joinable game: the joiner gets the details. */
  app.post("/game-sessions/:id/join", async (c) => {
    const me = c.get("userId");
    const { session, players } = await visible(c.req.param("id"), me);
    if (players.includes(me)) return c.json(await view(session, players, true));
    const input = await body(c, GameSessionJoin);
    if (input.gameVersion !== session.gameVersion || input.engineBuild !== session.engineBuild)
      throw new HttpError(
        409,
        ErrorCode.versionMismatch,
        `This game needs version ${session.gameVersion} on engine build ${session.engineBuild}`,
      );
    if ((await who.blockedAmong(me, players)).size)
      throw new HttpError(403, ErrorCode.forbidden, "You cannot join this game");
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
    await changed(session);
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
    if (session.hostId === me) await end(session);
    else await leaveCurrent(me);
    return c.body(null, 204);
  });

  return app;
}
