import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  type ClientFrame,
  type ServerFrame,
  callDepartureGraceMs,
  callDeparturesKey,
  callMembersKey,
  conversationMembersKey,
  deviceCallsKey,
  devicePresenceKey,
  friendsKey,
  presenceKey as mergedPresenceKey,
  presenceExtraKey,
  presenceHiddenKey,
  realtimeTicketKey,
  signalKinds,
  typingEveryMs,
  userChannel,
  userEvents,
  withExtras,
} from "@anytogether/shared";
import { Redis } from "ioredis";
import { type JWTVerifyGetKey, type KeyLike, jwtVerify } from "jose";
import { WebSocket, WebSocketServer } from "ws";

export interface GatewayOptions {
  /** The API's access-token key: its public key, or its JWKS. */
  keys: KeyLike | JWTVerifyGetKey;
  issuer: string;
  valkeyUrl: string;
  helloTimeoutMs?: number;
  heartbeatSeconds?: number;
}

/** Close codes the clients act on. */
export const CloseCode = { unauthorized: 4001, signedOut: 4003, idle: 4008, tooMany: 4029 } as const;
/** Frames one socket may send in ten seconds: a heartbeat every 25 s and one at each change of
 *  presence fit many times over. */
const framesPerWindow = 30;

interface Connection {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  lastHeard: number;
  /** Signals sent in the current window, and when it started. */
  signals: { count: number; since: number };
  /** When it last said it is typing, by conversation. */
  typing: Map<string, number>;
}

/** Enough for a full party's offers and ICE candidates at once, not for flooding a peer. */
const signalLimit = { count: 300, windowMs: 10_000 };

interface Presence {
  state: "online" | "away" | "in_game" | "offline";
  titleId?: string;
  since?: string;
}

/** One WebSocket per signed-in client: events the API publishes for its user reach it, a socket
 *  that reconnects gets what it missed in the last minutes, and a session signed out is dropped. */
export async function createGateway(options: GatewayOptions) {
  const heartbeat = options.heartbeatSeconds ?? 25;
  const helloTimeout = options.helloTimeoutMs ?? 10_000;
  const store = new Redis(options.valkeyUrl);
  const subscriber = new Redis(options.valkeyUrl);
  const byUser = new Map<string, Set<Connection>>();
  let closing = false;

  subscriber.on("message", (channel: string, message: string) => {
    const userId = channel.slice("user:".length);
    for (const connection of byUser.get(userId) ?? []) deliver(connection, message);
  });

  function send(socket: WebSocket, frame: ServerFrame) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  function deliver(connection: Connection, message: string) {
    const { id, type, data, device } = JSON.parse(message) as {
      id: string;
      type: string;
      data: { sessionId?: string };
      device?: string;
    };
    // A signal for one device of the user reaches only that socket.
    if (device && device !== connection.sessionId) return;
    send(connection.socket, { op: "event", id, type: type as never, data });
    if (type === "account.signed_out" && data?.sessionId === connection.sessionId) {
      connection.socket.close(CloseCode.signedOut, "signed out");
    }
  }

  async function join(connection: Connection) {
    let set = byUser.get(connection.userId);
    if (!set) {
      set = new Set();
      byUser.set(connection.userId, set);
      await subscriber.subscribe(userChannel(connection.userId));
    }
    set.add(connection);
  }

  async function leave(connection: Connection) {
    if (closing) return;
    const set = byUser.get(connection.userId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) {
      byUser.delete(connection.userId);
      await subscriber.unsubscribe(userChannel(connection.userId));
    }
    // Another socket of the same session (a second browser tab) keeps the device here.
    if ([...set].some((other) => other.sessionId === connection.sessionId)) return;
    await store.del(presenceKey(connection));
    await announce(connection.userId);
    // In a call: unless the device is back by then, the API takes it out of its calls.
    if (await store.exists(deviceCallsKey(connection.sessionId)))
      await store.zadd(
        callDeparturesKey,
        Date.now() + callDepartureGraceMs,
        `${connection.userId}:${connection.sessionId}`,
      );
  }

  /** The user's presence over all their devices (in a game > online > away), kept and, when it
   *  changed, sent to every friend; unless they hide it, when nothing is kept or sent. */
  async function announce(userId: string) {
    if (await store.exists(presenceHiddenKey(userId))) {
      await store.del(mergedPresenceKey(userId));
      return;
    }
    const keys = await store.keys(`presence:${userId}:*`);
    const devices = (keys.length ? await store.mget(...keys) : [])
      .filter(Boolean)
      .map((value) => JSON.parse(value as string) as Presence);
    const rank = { in_game: 0, online: 1, away: 2, offline: 3 };
    const merged: Presence = withExtras(
      devices.sort((a, b) => (rank[a.state] ?? 3) - (rank[b.state] ?? 3))[0] ?? { state: "offline" },
      await store.hgetall(presenceExtraKey(userId)),
    );
    const before = await store.get(mergedPresenceKey(userId));
    const now = JSON.stringify(merged);
    if (merged.state === "offline") await store.del(mergedPresenceKey(userId));
    else await store.set(mergedPresenceKey(userId), now, "EX", 70);
    if (before === now || (before === null && merged.state === "offline")) return;
    const friends = await store.smembers(friendsKey(userId));
    const message = (id: string) =>
      JSON.stringify({ id, type: "presence.updated", data: { userId, ...merged } });
    for (const friend of friends) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await store.publish(userChannel(friend), message(id));
    }
  }

  /** Who says hello: an access token (launchers, the phone), or a one-time ticket the API gave the
   *  website's server for its browser, used up here. */
  async function identify(frame: Extract<ClientFrame, { op: "hello" }>) {
    if (typeof frame.ticket === "string" && frame.ticket.length >= 20 && frame.ticket.length <= 100) {
      const hash = createHash("sha256").update(frame.ticket).digest("hex");
      const stored = await store.getdel(realtimeTicketKey(hash));
      if (!stored) throw new Error("unknown ticket");
      const { userId, sessionId } = JSON.parse(stored) as { userId: string; sessionId: string };
      return { userId, sessionId };
    }
    if (typeof frame.token !== "string") throw new Error("no token");
    const { payload } = await jwtVerify(frame.token, options.keys as KeyLike, {
      issuer: options.issuer,
      audience: "anytogether",
      algorithms: ["EdDSA"],
    });
    if (!payload.sub || typeof payload.sid !== "string") throw new Error("incomplete");
    return { userId: payload.sub, sessionId: payload.sid };
  }

  /** WebRTC signalling between two members of the same call, as the API set it up; passed on
   *  through the peer's channel and never stored. */
  async function relaySignal(connection: Connection, frame: Extract<ClientFrame, { op: "signal" }>) {
    const { to, call, kind, device } = frame;
    if (
      typeof to !== "string" ||
      typeof call !== "string" ||
      !signalKinds.includes(kind) ||
      (device !== undefined && typeof device !== "string")
    )
      return send(connection.socket, { op: "error", code: "bad_signal", message: "to, call and kind" });
    const now = Date.now();
    if (now - connection.signals.since > signalLimit.windowMs) connection.signals = { count: 0, since: now };
    if (++connection.signals.count > signalLimit.count)
      return connection.socket.close(CloseCode.tooMany, "too many signals");
    const members = callMembersKey(call);
    const [[, from], [, peer]] = (await store
      .multi()
      .sismember(members, connection.userId)
      .sismember(members, to)
      .exec()) as [[null, number], [null, number]];
    if (!from || !peer || to === connection.userId)
      return send(connection.socket, { op: "error", code: "not_in_call", message: "not in that call" });
    const message = JSON.stringify({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: "signal",
      data: { call, from: connection.userId, device: connection.sessionId, kind, data: frame.data ?? null },
      ...(device && device !== "*" ? { device } : {}),
    });
    await store.publish(userChannel(to), message);
  }

  /** "I am typing" to the conversation's other members: only from a member, at most every two
   *  seconds per conversation (more is dropped quietly), passed on and never kept. */
  async function relayTyping(connection: Connection, frame: Extract<ClientFrame, { op: "typing" }>) {
    const { conversation } = frame;
    if (typeof conversation !== "string" || conversation.length > 64)
      return send(connection.socket, { op: "error", code: "bad_typing", message: "conversation" });
    const now = Date.now();
    if (now - (connection.typing.get(conversation) ?? 0) < typingEveryMs) return;
    if (connection.typing.size > 50)
      for (const [id, at] of connection.typing) if (now - at >= typingEveryMs) connection.typing.delete(id);
    connection.typing.set(conversation, now);
    const members = await store.smembers(conversationMembersKey(conversation));
    if (!members.includes(connection.userId))
      return send(connection.socket, {
        op: "error",
        code: "not_in_conversation",
        message: "open the conversation first",
      });
    const message = JSON.stringify({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: "typing",
      data: { conversationId: conversation, userId: connection.userId },
    });
    for (const member of members)
      if (member !== connection.userId) await store.publish(userChannel(member), message);
  }

  /** The events after `resume` still kept for the user (the API keeps five minutes of them). */
  async function replay(connection: Connection, resume: string) {
    const entries = await store.xrange(userEvents(connection.userId), "-", "+");
    const messages = entries.map(([, fields]) => fields[1] ?? "");
    const index = messages.findIndex((message) => message.includes(`"id":"${resume}"`));
    if (index < 0) return;
    for (const message of messages.slice(index + 1)) deliver(connection, message);
  }

  const server = createServer((request, response) => {
    if (request.url === "/health")
      return response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    response.writeHead(426, { "content-type": "text/plain" }).end("WebSocket only");
  });
  const wss = new WebSocketServer({ server, path: "/rt", maxPayload: 64 * 1024 });

  wss.on("connection", (socket) => {
    let connection: Connection | undefined;
    let window = 0;
    let frames = 0;
    const helloTimer = setTimeout(
      () => socket.close(CloseCode.unauthorized, "say hello first"),
      helloTimeout,
    );

    // A frame that fails (Valkey gone for a moment) ends this socket, never the process.
    socket.on("message", (raw) => {
      onFrame(raw).catch(() => socket.close(1011, "try again"));
    });

    async function onFrame(raw: unknown) {
      const now = Math.floor(Date.now() / 10_000);
      if (now !== window) {
        window = now;
        frames = 0;
      }
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return socket.close(1003, "not JSON");
      }
      // Signals have a budget of their own (a voice call's setup sends dozens at once).
      const signalling = frame.op === "signal" && connection !== undefined;
      if (!signalling && ++frames > framesPerWindow)
        return socket.close(CloseCode.tooMany, "too many frames");
      if (frame.op === "hello" && !connection) {
        clearTimeout(helloTimer);
        try {
          const { userId, sessionId } = await identify(frame);
          if (await store.exists(`revoked:${sessionId}`))
            return socket.close(CloseCode.signedOut, "signed out");
          connection = {
            socket,
            userId,
            sessionId,
            lastHeard: Date.now(),
            signals: { count: 0, since: Date.now() },
            typing: new Map(),
          };
          await join(connection);
          send(socket, { op: "ready", session: sessionId, heartbeat });
          await store.set(presenceKey(connection), JSON.stringify({ state: "online" }), "EX", 60);
          await announce(connection.userId);
          if (frame.resume) await replay(connection, frame.resume);
        } catch {
          socket.close(CloseCode.unauthorized, "bad token");
        }
        return;
      }
      if (!connection) return socket.close(CloseCode.unauthorized, "say hello first");
      if (frame.op === "heartbeat") {
        connection.lastHeard = Date.now();
        await store.set(presenceKey(connection), JSON.stringify(devicePresence(frame.presence)), "EX", 60);
        await announce(connection.userId);
        return;
      }
      if (frame.op === "signal") await relaySignal(connection, frame);
      else if (frame.op === "typing") await relayTyping(connection, frame);
    }

    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (connection) leave(connection).catch(() => {});
    });
  });

  // A socket silent for two heartbeats is gone.
  const sweeper = setInterval(() => {
    const limit = Date.now() - heartbeat * 2400;
    for (const set of byUser.values())
      for (const connection of set)
        if (connection.lastHeard < limit) connection.socket.close(CloseCode.idle, "no heartbeat");
  }, heartbeat * 1000);

  return {
    server,
    async close() {
      closing = true;
      clearInterval(sweeper);
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      await new Promise((resolve) => server.close(resolve));
      store.disconnect();
      subscriber.disconnect();
    },
  };
}

/** What a device may say about itself: its state, and the game and since when while playing. */
function devicePresence(presence: unknown): Presence {
  const { state, titleId, since } = (presence ?? {}) as Record<string, unknown>;
  if (state !== "online" && state !== "away" && state !== "in_game") return { state: "online" };
  return {
    state,
    ...(typeof titleId === "string" ? { titleId: titleId.slice(0, 32) } : {}),
    ...(typeof since === "string" ? { since: since.slice(0, 40) } : {}),
  };
}

const presenceKey = (connection: Connection) => devicePresenceKey(connection.userId, connection.sessionId);
