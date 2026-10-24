import { createServer } from "node:http";
import { type ClientFrame, type ServerFrame, userChannel, userEvents } from "@anytogether/shared";
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
export const CloseCode = { unauthorized: 4001, signedOut: 4003, idle: 4008 } as const;

interface Connection {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  lastHeard: number;
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
    const { id, type, data } = JSON.parse(message) as {
      id: string;
      type: string;
      data: { sessionId?: string };
    };
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
    await store.del(presenceKey(connection));
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
    const helloTimer = setTimeout(
      () => socket.close(CloseCode.unauthorized, "say hello first"),
      helloTimeout,
    );

    socket.on("message", async (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return socket.close(1003, "not JSON");
      }
      if (frame.op === "hello" && !connection) {
        clearTimeout(helloTimer);
        try {
          const { payload } = await jwtVerify(frame.token, options.keys as KeyLike, {
            issuer: options.issuer,
            audience: "anytogether",
            algorithms: ["EdDSA"],
          });
          if (!payload.sub || typeof payload.sid !== "string") throw new Error("incomplete");
          if (await store.exists(`revoked:${payload.sid}`))
            return socket.close(CloseCode.signedOut, "signed out");
          connection = { socket, userId: payload.sub, sessionId: payload.sid, lastHeard: Date.now() };
          await join(connection);
          send(socket, { op: "ready", session: payload.sid, heartbeat });
          if (frame.resume) await replay(connection, frame.resume);
        } catch {
          socket.close(CloseCode.unauthorized, "bad token");
        }
        return;
      }
      if (!connection) return socket.close(CloseCode.unauthorized, "say hello first");
      if (frame.op === "heartbeat") {
        connection.lastHeard = Date.now();
        if (frame.presence) {
          await store.set(presenceKey(connection), JSON.stringify(frame.presence), "EX", 60);
        }
      }
    });

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

const presenceKey = (connection: Connection) => `presence:${connection.userId}:${connection.sessionId}`;
