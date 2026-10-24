import { createHmac } from "node:crypto";
import { calls } from "@anytogether/db";
import {
  CallCreate,
  type CallJoin,
  CallMute,
  type CallPeer,
  type CallView,
  ErrorCode,
  type GatewayEvent,
  type IceServer,
  callDeparturesKey,
  callInKey,
  callMembersKey,
  callMutedKey,
  deviceCallsKey,
  devicePresenceKey,
  turnCredentialSeconds,
} from "@anytogether/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { PartyService } from "./parties.js";
import { people } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

type Call = typeof calls.$inferSelect;

/** STUN as configured, and TURN with REST credentials: username "expiry:userId", password the
 *  base64 HMAC-SHA1 of it with the secret the relay shares. Nothing configured gives nothing; no
 *  public fallback is ever added. */
export function iceServers(turn: Deps["turn"], userId: string, now = Date.now()) {
  const urls = turn?.urls ?? [];
  const stun = urls.filter((url) => url.startsWith("stun:"));
  const relays = urls.filter((url) => /^turns?:/.test(url));
  const servers: IceServer[] = [];
  if (stun.length) servers.push({ urls: stun });
  let expiresAt: string | null = null;
  if (relays.length && turn?.secret) {
    const expiry = Math.floor(now / 1000) + turnCredentialSeconds;
    const username = `${expiry}:${userId}`;
    const credential = createHmac("sha1", turn.secret).update(username).digest("base64");
    servers.push({ urls: relays, username, credential });
    expiresAt = new Date(expiry * 1000).toISOString();
  }
  return { iceServers: servers, expiresAt };
}

/** Calls: a friend, or the party's voice. The API checks who may be called and hands out relay
 *  credentials; the gateway relays the signalling only between the call's members. */
export function callRoutes(deps: Deps, parties: PartyService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const who = people(db);
  const keep = turnCredentialSeconds;
  const limit = rateLimiter(valkey, deps.limits);

  const tell = async (userIds: string[], event: GatewayEvent) => {
    for (const userId of new Set(userIds)) await publish(valkey, userId, event);
  };

  const peers = async (callId: string): Promise<CallPeer[]> => {
    const [[, inCall], [, muted]] = (await valkey
      .multi()
      .hgetall(callInKey(callId))
      .smembers(callMutedKey(callId))
      .exec()) as [[null, Record<string, string>], [null, string[]]];
    return Object.entries(inCall).map(([userId, device]) => ({
      userId,
      device,
      muted: muted.includes(userId),
    }));
  };

  const view = async (call: Call): Promise<CallView> => ({
    id: call.id,
    kind: call.partyId || !call.calleeId ? "party" : "direct",
    partyId: call.partyId,
    startedBy: call.startedBy,
    calleeId: call.calleeId,
    in: call.endedAt ? [] : await peers(call.id),
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
  });

  const joined = async (call: Call, me: string): Promise<CallJoin> => ({
    call: await view(call),
    ...iceServers(deps.turn, me),
  });

  /** May signal in it, and is in it now on `device` (which, when its socket goes, leaves it). */
  const enter = async (callId: string, userIds: string[], me: string, device: string) => {
    await valkey
      .multi()
      .sadd(callMembersKey(callId), ...userIds)
      .hset(callInKey(callId), me, device)
      .sadd(deviceCallsKey(device), callId)
      .expire(callMembersKey(callId), keep)
      .expire(callInKey(callId), keep)
      .expire(deviceCallsKey(device), keep)
      .exec();
  };

  const live = async (callId: string) => {
    if (!z.string().uuid().safeParse(callId).success) return undefined;
    return (
      await db
        .select()
        .from(calls)
        .where(and(eq(calls.id, callId), isNull(calls.endedAt)))
    )[0];
  };

  const asMember = async (callId: string, me: string) => {
    const call = await live(callId);
    if (!call || !(await valkey.sismember(callMembersKey(call.id), me)))
      throw new HttpError(404, ErrorCode.notFound, "No such call");
    return call;
  };

  /** Ends the call for everyone; a direct call that nobody answered, ended by anyone but the
   *  callee (`by`), is a missed call for the callee. */
  async function end(call: Call, reason: "ended" | "declined" | "party_ended", by?: string) {
    const [ended] = await db
      .update(calls)
      .set({ endedAt: new Date() })
      .where(and(eq(calls.id, call.id), isNull(calls.endedAt)))
      .returning();
    if (!ended) return;
    const members = await valkey.smembers(callMembersKey(call.id));
    const devices = Object.values(await valkey.hgetall(callInKey(call.id)));
    const cleanup = valkey.multi().del(callMembersKey(call.id), callInKey(call.id), callMutedKey(call.id));
    for (const device of devices) cleanup.srem(deviceCallsKey(device), call.id);
    await cleanup.exec();
    await tell(members, { type: "call.ended", data: { callId: call.id, partyId: call.partyId, reason } });
    if (!ended.partyId && ended.calleeId && !ended.answeredAt && reason === "ended" && by !== ended.calleeId)
      await parties.notes.notify(ended.calleeId, {
        kind: "missed_call",
        actorId: ended.startedBy,
        subjectId: ended.id,
        data: { callId: ended.id },
      });
  }

  /** Out of the call: a direct call ends; a party call ends when its last voice leaves. */
  async function leaveCall(call: Call, me: string, stillMember: boolean) {
    const device = await valkey.hget(callInKey(call.id), me);
    const removed = await valkey.hdel(callInKey(call.id), me);
    await valkey.srem(callMutedKey(call.id), me);
    if (device) await valkey.srem(deviceCallsKey(device), call.id);
    if (!stillMember) await valkey.srem(callMembersKey(call.id), me);
    if (!call.partyId) return end(call, "ended", me);
    if (removed)
      await tell([...(await valkey.smembers(callMembersKey(call.id))), me], {
        type: "call.left",
        data: { callId: call.id, partyId: call.partyId, userId: me },
      });
    if (!(await valkey.hlen(callInKey(call.id)))) return end(call, "ended");
  }

  const partyCall = async (partyId: string) =>
    (
      await db
        .select()
        .from(calls)
        .where(and(eq(calls.partyId, partyId), isNull(calls.endedAt)))
    )[0];

  // The party view shows its call; leaving the party leaves its call.
  parties.callOf.current = async (partyId) => {
    const call = await partyCall(partyId);
    if (!call) return null;
    const now = await peers(call.id);
    return {
      id: call.id,
      in: now.map((p) => p.userId),
      muted: now.filter((p) => p.muted).map((p) => p.userId),
    };
  };
  parties.leaveHooks.push(async (partyId, userId, ended) => {
    const call = await partyCall(partyId);
    if (!call) return;
    if (ended) return end(call, "party_ended");
    await leaveCall(call, userId, false);
  });

  app.post("/calls", async (c) => {
    const me = c.get("userId");
    const device = c.get("sessionId");
    const parsed = CallCreate.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "partyId or userId");
    const { partyId, userId } = parsed.data;
    await limit("call", me);

    if (userId) {
      if (userId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
      if (!(await who.friends(me, userId)))
        throw new HttpError(403, ErrorCode.forbidden, "You can only call your friends");
      const [call] = await db
        .insert(calls)
        .values({ id: uuidv7(), startedBy: me, calleeId: userId })
        .returning();
      if (!call) throw new HttpError(409, ErrorCode.conflict, "Try again");
      await enter(call.id, [me, userId], me, device);
      const from = await who.card(me);
      if (from) await tell([userId], { type: "call.ringing", data: { callId: call.id, from, device } });
      return c.json(await joined(call, me), 201);
    }

    const party = await parties.live(partyId as string);
    const members = party ? await parties.memberIds(party.id) : [];
    if (!party || !members.includes(me)) throw new HttpError(404, ErrorCode.notFound, "No such party");
    await db.insert(calls).values({ id: uuidv7(), partyId: party.id, startedBy: me }).onConflictDoNothing();
    const call = await partyCall(party.id);
    if (!call) throw new HttpError(409, ErrorCode.conflict, "Try again");
    const fresh = !(await valkey.hexists(callInKey(call.id), me));
    await enter(call.id, [me], me, device);
    if (fresh) {
      await tell(
        members.filter((id) => id !== me),
        { type: "call.joined", data: { callId: call.id, partyId: party.id, userId: me, device } },
      );
      await parties.announce(party);
    }
    return c.json(await joined(call, me), fresh ? 201 : 200);
  });

  app.get("/calls/:id", async (c) => c.json(await view(await asMember(c.req.param("id"), c.get("userId")))));

  /** Answered on this device: the caller is told which device, and the callee's others stop ringing. */
  app.post("/calls/:id/answer", async (c) => {
    const me = c.get("userId");
    const device = c.get("sessionId");
    const call = await asMember(c.req.param("id"), me);
    if (call.calleeId !== me) throw new HttpError(400, ErrorCode.badRequest, "Not a call to you");
    const [answered] = await db
      .update(calls)
      .set({ answeredAt: new Date() })
      .where(and(eq(calls.id, call.id), isNull(calls.answeredAt), isNull(calls.endedAt)))
      .returning();
    if (!answered) throw new HttpError(409, ErrorCode.conflict, "Answered on another device");
    await enter(call.id, [me], me, device);
    await tell([me, call.startedBy ?? me], {
      type: "call.answered",
      data: { callId: call.id, userId: me, device },
    });
    return c.json(await joined(answered, me));
  });

  app.post("/calls/:id/decline", async (c) => {
    const me = c.get("userId");
    const call = await asMember(c.req.param("id"), me);
    if (call.calleeId !== me || call.answeredAt)
      throw new HttpError(400, ErrorCode.badRequest, "Nothing to decline");
    await end(call, "declined");
    return c.body(null, 204);
  });

  /** Out of a call by choice or because the device went away; the party shows it. */
  async function leaveAndShow(call: Call, me: string) {
    await leaveCall(call, me, true);
    if (call.partyId) {
      const party = await parties.live(call.partyId);
      if (party) await parties.announce(party);
    }
  }

  app.post("/calls/:id/leave", async (c) => {
    const me = c.get("userId");
    const call = await asMember(c.req.param("id"), me);
    await leaveAndShow(call, me);
    return c.body(null, 204);
  });

  /** Muted or not: every member hears it, and the party view shows it. */
  app.post("/calls/:id/mute", async (c) => {
    const me = c.get("userId");
    const call = await asMember(c.req.param("id"), me);
    const { muted } = await body(c, CallMute);
    if (!(await valkey.hexists(callInKey(call.id), me)))
      throw new HttpError(409, ErrorCode.conflict, "Join the call first");
    const changed = muted
      ? await valkey.sadd(callMutedKey(call.id), me)
      : await valkey.srem(callMutedKey(call.id), me);
    await valkey.expire(callMutedKey(call.id), keep);
    if (changed) {
      await tell(await valkey.smembers(callMembersKey(call.id)), {
        type: "call.updated",
        data: { callId: call.id, partyId: call.partyId, userId: me, muted },
      });
      if (call.partyId) {
        const party = await parties.live(call.partyId);
        if (party) await parties.announce(party);
      }
    }
    return c.json(await view(call));
  });

  /** Fresh relay credentials for a call that outlives them. */
  app.get("/ice-servers", (c) => c.json(iceServers(deps.turn, c.get("userId"))));

  /** Devices whose gateway socket closed (the gateway notes them) and did not come back within
   *  the grace are taken out of the calls they were in: the others hear `call.left`, and a call
   *  with nobody left ends. Run every few seconds; returns how many devices it took out. */
  async function sweepDepartures(now = Date.now()) {
    const due = await valkey.zrangebyscore(callDeparturesKey, 0, now, "LIMIT", 0, 100);
    let gone = 0;
    for (const entry of due) {
      // Another API process may have taken it already.
      if (!(await valkey.zrem(callDeparturesKey, entry))) continue;
      const [userId, device] = entry.split(":") as [string, string];
      if (!userId || !device || (await valkey.exists(devicePresenceKey(userId, device)))) continue;
      for (const callId of await valkey.smembers(deviceCallsKey(device))) {
        const call = await live(callId);
        if (call && (await valkey.hget(callInKey(call.id), userId)) === device)
          await leaveAndShow(call, userId);
        else await valkey.srem(deviceCallsKey(device), callId);
      }
      gone++;
    }
    return gone;
  }

  return Object.assign(app, { sweepDepartures });
}
