/** What the realtime gateway pushes; the API publishes them for each recipient. */
export type GatewayEvent =
  | { type: "account.signed_out"; data: { sessionId: string } }
  | { type: "presence.updated"; data: { userId: string; state: PresenceState; titleId?: string; since?: string } }
  | { type: "auth.handoff"; data: { handoffId: string; deviceName: string; client: string } };

export type PresenceState = "online" | "away" | "in_game" | "offline";

/** Frames on the gateway socket. */
export type ClientFrame =
  | { op: "hello"; token: string; client?: string; resume?: string }
  | { op: "heartbeat"; presence?: { state: Exclude<PresenceState, "offline">; titleId?: string; since?: string } };

export type ServerFrame =
  | { op: "ready"; session: string; heartbeat: number }
  | { op: "event"; id: string; type: GatewayEvent["type"]; data: unknown }
  | { op: "error"; code: string; message: string };

export const userChannel = (userId: string) => `user:${userId}`;
export const userEvents = (userId: string) => `events:${userId}`;
