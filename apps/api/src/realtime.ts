import { realtimeTicketKey, realtimeTicketSeconds } from "@anytogether/shared";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";
import { hash, secret } from "./tokens.js";

/** A one-time ticket for the gateway's hello, for the website: its browser never holds an access
 *  token (those stay in HttpOnly cookies), so its server asks for a ticket that opens one socket
 *  within 30 seconds and can do nothing else. */
export function realtimeRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const limit = rateLimiter(deps.valkey, deps.limits);

  app.post("/realtime/ticket", async (c) => {
    await limit("realtimeTicket", c.get("userId"));
    const ticket = secret(24);
    await deps.valkey.set(
      realtimeTicketKey(hash(ticket).toString("hex")),
      JSON.stringify({ userId: c.get("userId"), sessionId: c.get("sessionId") }),
      "EX",
      realtimeTicketSeconds,
    );
    return c.json({ ticket, expiresIn: realtimeTicketSeconds }, 201);
  });

  return app;
}
