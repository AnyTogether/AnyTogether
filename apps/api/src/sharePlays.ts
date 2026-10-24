import {
  ErrorCode,
  type GatewayEvent,
  type MemberView,
  type SharePadSlot,
  SharePlayInvite,
  type SharePlayInviteView,
  type SharePlayJoin,
  SharePlaySlot,
  SharePlayStart,
  SharePlayUpdate,
  type SharePlayView,
  type SharePresence,
  devicePresenceKey,
  deviceSharePlaysKey,
  hostSharePlayKey,
  shareDeparturesKey,
  sharePlayInvitesKey,
  sharePlayKeepSeconds,
  sharePlayKey,
  sharePlayMembersKey,
  sharePlayRemovedKey,
  sharePlayViewersKey,
  userShareInvitesKey,
  watchSharePlayKey,
} from "@anytogether/shared";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { iceServers } from "./calls.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { people } from "./people.js";
import { setPresenceExtra } from "./presence.js";
import { rateLimiter } from "./ratelimit.js";

/** What Valkey keeps of a share play. */
interface Share {
  id: string;
  hostId: string;
  hostDevice: string;
  titleId: string;
  title: string | null;
  open: boolean;
  maxViewers: number;
  startedAt: string;
}

interface Seat {
  device: string;
  slot: SharePadSlot | null;
  joinedAt: string;
}

/** Takes a seat unless the share play is full (a viewer already in keeps theirs, on the new device). */
const takeSeat = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 or redis.call('HLEN', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  return 1
end
return 0`;

/** Share play: a host streams the game they run to friends, who watch and, when the host hands
 *  them a pad, play as player 2-4. The API says who may watch and who holds which pad; the
 *  gateway relays the host's and the viewers' signalling; the media go between them directly. */
export function sharePlayRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { valkey } = deps;
  const who = people(deps.db);
  const limit = rateLimiter(valkey, deps.limits);
  const keep = sharePlayKeepSeconds;

  const tell = async (userIds: string[], event: GatewayEvent) => {
    for (const userId of new Set(userIds)) await publish(valkey, userId, event);
  };

  const load = async (id: string) => {
    if (!z.string().uuid().safeParse(id).success) return undefined;
    const stored = await valkey.get(sharePlayKey(id));
    return stored ? (JSON.parse(stored) as Share) : undefined;
  };

  const seats = async (id: string) => {
    const raw = await valkey.hgetall(sharePlayViewersKey(id));
    return new Map(Object.entries(raw).map(([userId, value]) => [userId, JSON.parse(value) as Seat]));
  };

  /** Everything about it lives as long as the latest touch. */
  const touch = async (share: Share, devices: string[] = []) => {
    const write = valkey.multi();
    for (const key of [
      sharePlayKey(share.id),
      sharePlayViewersKey(share.id),
      sharePlayMembersKey(share.id),
      sharePlayInvitesKey(share.id),
      sharePlayRemovedKey(share.id),
      hostSharePlayKey(share.hostId),
    ])
      write.expire(key, keep);
    for (const device of devices)
      write.sadd(deviceSharePlaysKey(device), share.id).expire(deviceSharePlaysKey(device), keep);
    await write.exec();
  };

  async function view(share: Share, forHost = false): Promise<SharePlayView> {
    const sat = [...(await seats(share.id))].sort((a, b) => a[1].joinedAt.localeCompare(b[1].joinedAt));
    const invited = forHost ? Object.keys(await valkey.hgetall(sharePlayInvitesKey(share.id))) : [];
    const cards = await who.cards([share.hostId, ...sat.map(([id]) => id), ...invited]);
    return {
      id: share.id,
      host: cards.get(share.hostId) ?? null,
      hostDevice: share.hostDevice,
      titleId: share.titleId,
      title: share.title,
      open: share.open,
      maxViewers: share.maxViewers,
      viewers: sat.flatMap(([id, seat]) => {
        const user = cards.get(id);
        return user ? [{ user, device: seat.device, slot: seat.slot, joinedAt: seat.joinedAt }] : [];
      }),
      ...(forHost ? { invited: invited.flatMap((id) => cards.get(id) ?? []) } : {}),
      startedAt: share.startedAt,
    };
  }

  const joined = async (share: Share, me: string, forHost: boolean): Promise<SharePlayJoin> => ({
    sharePlay: await view(share, forHost),
    ...iceServers(deps.turn, me),
  });

  const showInPresence = async (share: Share, viewers: number) => {
    const value: SharePresence = {
      sharePlayId: share.id,
      titleId: share.titleId,
      title: share.title,
      open: share.open && viewers < share.maxViewers,
      viewers,
      maxViewers: share.maxViewers,
    };
    await setPresenceExtra(valkey, share.hostId, "share", value);
  };

  /** The host and every viewer hear it as it is now; the host's presence follows. */
  async function changed(share: Share) {
    const now = await seats(share.id);
    await tell([share.hostId], { type: "share_play.updated", data: await view(share, true) });
    if (now.size) await tell([...now.keys()], { type: "share_play.updated", data: await view(share) });
    await showInPresence(share, now.size);
  }

  async function end(share: Share) {
    const now = await seats(share.id);
    const invited = Object.keys(await valkey.hgetall(sharePlayInvitesKey(share.id)));
    const cleanup = valkey
      .multi()
      .del(
        sharePlayKey(share.id),
        sharePlayViewersKey(share.id),
        sharePlayMembersKey(share.id),
        sharePlayInvitesKey(share.id),
        sharePlayRemovedKey(share.id),
      )
      .srem(deviceSharePlaysKey(share.hostDevice), share.id);
    for (const seat of now.values()) cleanup.srem(deviceSharePlaysKey(seat.device), share.id);
    for (const userId of invited) cleanup.hdel(userShareInvitesKey(userId), share.id);
    await cleanup.exec();
    if ((await valkey.get(hostSharePlayKey(share.hostId))) === share.id)
      await valkey.del(hostSharePlayKey(share.hostId));
    for (const userId of now.keys())
      if ((await valkey.get(watchSharePlayKey(userId))) === share.id)
        await valkey.del(watchSharePlayKey(userId));
    await setPresenceExtra(valkey, share.hostId, "share", null);
    await tell([...now.keys(), ...invited], {
      type: "share_play.ended",
      data: { sharePlayId: share.id, reason: "ended" },
    });
  }

  /** A viewer out of it: by choice, taken out by the host, or because their device went away. */
  async function unseat(share: Share, userId: string, reason?: "removed") {
    const seat = (await seats(share.id)).get(userId);
    if (!seat) return false;
    const write = valkey
      .multi()
      .hdel(sharePlayViewersKey(share.id), userId)
      .srem(sharePlayMembersKey(share.id), userId)
      .srem(deviceSharePlaysKey(seat.device), share.id);
    if (reason) write.sadd(sharePlayRemovedKey(share.id), userId).expire(sharePlayRemovedKey(share.id), keep);
    await write.exec();
    if ((await valkey.get(watchSharePlayKey(userId))) === share.id)
      await valkey.del(watchSharePlayKey(userId));
    if (reason) await tell([userId], { type: "share_play.ended", data: { sharePlayId: share.id, reason } });
    await changed(share);
    return true;
  }

  /** Out of the share play someone watches, and the one they host ends. */
  async function leaveAll(userId: string) {
    const hosted = await load((await valkey.get(hostSharePlayKey(userId))) ?? "");
    if (hosted) await end(hosted);
    const watched = await load((await valkey.get(watchSharePlayKey(userId))) ?? "");
    if (watched) await unseat(watched, userId);
  }

  /** The host, its viewers, the invited and (while open) the host's friends see it; nobody the
   *  host was taken out by or blocked. */
  const visible = async (id: string, me: string) => {
    const share = await load(id);
    if (share) {
      if (share.hostId === me) return share;
      const [[, seated], [, invited], [, removed]] = (await valkey
        .multi()
        .hexists(sharePlayViewersKey(share.id), me)
        .hexists(sharePlayInvitesKey(share.id), me)
        .sismember(sharePlayRemovedKey(share.id), me)
        .exec()) as [[null, number], [null, number], [null, number]];
      if (seated || invited || (!removed && share.open && (await who.friends(me, share.hostId))))
        if (!(await who.blocked(me, share.hostId))) return share;
    }
    throw new HttpError(404, ErrorCode.notFound, "No such share play");
  };

  const asHost = async (id: string, me: string) => {
    const share = await visible(id, me);
    if (share.hostId !== me) throw new HttpError(403, ErrorCode.forbidden, "Only the host can do that");
    return share;
  };

  const asMember = async (id: string, me: string) => {
    const share = await visible(id, me);
    if (share.hostId !== me && !(await valkey.hexists(sharePlayViewersKey(share.id), me)))
      throw new HttpError(403, ErrorCode.forbidden, "Join the share play first");
    return share;
  };

  /** Start sharing the game this device runs; one at a time, so an earlier one ends. */
  app.post("/share-plays", async (c) => {
    const me = c.get("userId");
    const device = c.get("sessionId");
    const input = await body(c, SharePlayStart);
    await limit("sharePlay", me);
    await leaveAll(me);
    const share: Share = {
      id: uuidv7(),
      hostId: me,
      hostDevice: device,
      titleId: input.titleId,
      title: input.title ?? null,
      open: input.open,
      maxViewers: input.maxViewers,
      startedAt: new Date().toISOString(),
    };
    await valkey
      .multi()
      .set(sharePlayKey(share.id), JSON.stringify(share), "EX", keep)
      .sadd(sharePlayMembersKey(share.id), me)
      .set(hostSharePlayKey(me), share.id, "EX", keep)
      .exec();
    await touch(share, [device]);
    await showInPresence(share, 0);
    return c.json(await joined(share, me, true), 201);
  });

  /** The share play I host, the one I watch, and invites waiting for me. */
  app.get("/me/share-play", async (c) => {
    const me = c.get("userId");
    const hosting = await load((await valkey.get(hostSharePlayKey(me))) ?? "");
    const watching = await load((await valkey.get(watchSharePlayKey(me))) ?? "");
    const waiting = await valkey.hgetall(userShareInvitesKey(me));
    const invites: (SharePlayInviteView & { at: number })[] = [];
    const cards = new Map<string, MemberView>();
    for (const [id, raw] of Object.entries(waiting)) {
      const share = await load(id);
      if (!share || !(await valkey.hexists(sharePlayInvitesKey(id), me))) {
        await valkey.hdel(userShareInvitesKey(me), id);
        continue;
      }
      const { from, at } = JSON.parse(raw) as { from: string; at: string };
      if (!cards.has(from)) {
        const card = await who.card(from);
        if (card) cards.set(from, card);
      }
      invites.push({
        sharePlayId: id,
        from: cards.get(from) ?? null,
        titleId: share.titleId,
        title: share.title,
        invitedAt: at,
        at: Date.parse(at),
      });
    }
    return c.json({
      hosting: hosting ? await view(hosting, true) : null,
      watching: watching ? await view(watching) : null,
      invites: invites.sort((a, b) => a.at - b.at).map(({ at, ...invite }) => invite),
    });
  });

  app.get("/share-plays/:id", async (c) => {
    const me = c.get("userId");
    const share = await visible(c.req.param("id"), me);
    return c.json(await view(share, share.hostId === me));
  });

  app.patch("/share-plays/:id", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    const input = await body(c, SharePlayUpdate);
    if (
      input.maxViewers !== undefined &&
      input.maxViewers < (await valkey.hlen(sharePlayViewersKey(share.id)))
    )
      throw new HttpError(409, ErrorCode.conflict, "More people are watching already");
    const updated: Share = {
      ...share,
      ...(input.titleId !== undefined ? { titleId: input.titleId } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.open !== undefined ? { open: input.open } : {}),
      ...(input.maxViewers !== undefined ? { maxViewers: input.maxViewers } : {}),
    };
    await valkey.set(sharePlayKey(share.id), JSON.stringify(updated), "EX", keep);
    await touch(updated);
    await changed(updated);
    return c.json(await view(updated, true));
  });

  app.delete("/share-plays/:id", async (c) => {
    await end(await asHost(c.req.param("id"), c.get("userId")));
    return c.body(null, 204);
  });

  /** The host invites friends; they hear it on every device. */
  app.post("/share-plays/:id/invites", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    const { userIds } = await body(c, SharePlayInvite);
    const seated = await seats(share.id);
    const asked = [...new Set(userIds)].filter((id) => id !== me && !seated.has(id));
    const friends = await who.friendsAmong(me, asked);
    if (asked.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only invite your friends");
    const at = new Date().toISOString();
    const fresh: string[] = [];
    for (const id of asked) {
      const added = await valkey.hsetnx(sharePlayInvitesKey(share.id), id, at);
      await valkey
        .multi()
        .srem(sharePlayRemovedKey(share.id), id)
        .hset(userShareInvitesKey(id), share.id, JSON.stringify({ from: me, at }))
        .expire(userShareInvitesKey(id), keep)
        .exec();
      if (added) fresh.push(id);
    }
    await touch(share);
    const from = await who.card(me);
    if (from)
      await tell(fresh, {
        type: "share_play.invite",
        data: { sharePlayId: share.id, from, titleId: share.titleId, title: share.title },
      });
    if (fresh.length) await tell([me], { type: "share_play.updated", data: await view(share, true) });
    return c.json({ invited: fresh });
  });

  app.post("/share-plays/:id/decline", async (c) => {
    const me = c.get("userId");
    const share = await load(c.req.param("id"));
    const removed = share ? await valkey.hdel(sharePlayInvitesKey(share.id), me) : 0;
    await valkey.hdel(userShareInvitesKey(me), c.req.param("id"));
    if (!share || !removed) throw new HttpError(404, ErrorCode.notFound, "No such invite");
    await tell([share.hostId], { type: "share_play.updated", data: await view(share, true) });
    return c.body(null, 204);
  });

  /** Watch on this device: the host hears it and calls this device; joining again (another device,
   *  a reloaded page) moves the seat here and keeps the pad. */
  app.post("/share-plays/:id/join", async (c) => {
    const me = c.get("userId");
    const device = c.get("sessionId");
    const share = await visible(c.req.param("id"), me);
    if (share.hostId === me) throw new HttpError(400, ErrorCode.badRequest, "That is your own share play");
    const before = (await seats(share.id)).get(me);
    const seat: Seat = {
      device,
      slot: before?.slot ?? null,
      joinedAt: before?.joinedAt ?? new Date().toISOString(),
    };
    if (!before) {
      const watched = await load((await valkey.get(watchSharePlayKey(me))) ?? "");
      if (watched && watched.id !== share.id) await unseat(watched, me);
    }
    const taken = await valkey.eval(
      takeSeat,
      1,
      sharePlayViewersKey(share.id),
      me,
      JSON.stringify(seat),
      share.maxViewers,
    );
    if (!taken) throw new HttpError(409, ErrorCode.full, "Nobody else can watch right now");
    const write = valkey
      .multi()
      .sadd(sharePlayMembersKey(share.id), me)
      .hdel(sharePlayInvitesKey(share.id), me)
      .hdel(userShareInvitesKey(me), share.id)
      .set(watchSharePlayKey(me), share.id, "EX", keep);
    if (before && before.device !== device) write.srem(deviceSharePlaysKey(before.device), share.id);
    await write.exec();
    await touch(share, [device]);
    await changed(share);
    return c.json(await joined(share, me, false), before ? 200 : 201);
  });

  app.post("/share-plays/:id/leave", async (c) => {
    const me = c.get("userId");
    const share = await visible(c.req.param("id"), me);
    if (share.hostId === me) await end(share);
    else if (!(await unseat(share, me))) throw new HttpError(404, ErrorCode.notFound, "Not watching this");
    return c.body(null, 204);
  });

  /** The host hands a viewer a pad, or takes it back; one pad per viewer, one viewer per pad. */
  app.put("/share-plays/:id/viewers/:userId/slot", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    const { slot } = await body(c, SharePlaySlot);
    const now = await seats(share.id);
    const userId = c.req.param("userId");
    const seat = now.get(userId);
    if (!seat) throw new HttpError(404, ErrorCode.notFound, "Not watching this");
    if (slot !== null && [...now].some(([id, other]) => id !== userId && other.slot === slot))
      throw new HttpError(409, ErrorCode.conflict, `Someone else plays as player ${slot}`);
    if (seat.slot !== slot) {
      await valkey.hset(sharePlayViewersKey(share.id), userId, JSON.stringify({ ...seat, slot }));
      await touch(share);
      await changed(share);
    }
    return c.json(await view(share, true));
  });

  /** The host takes a viewer out; they cannot walk back in unless invited again. */
  app.delete("/share-plays/:id/viewers/:userId", async (c) => {
    const share = await asHost(c.req.param("id"), c.get("userId"));
    if (!(await unseat(share, c.req.param("userId"), "removed")))
      throw new HttpError(404, ErrorCode.notFound, "Not watching this");
    return c.body(null, 204);
  });

  /** STUN and TURN for the host and the viewers; asking again renews them. */
  app.get("/share-plays/:id/ice-servers", async (c) => {
    const me = c.get("userId");
    const share = await asMember(c.req.param("id"), me);
    await touch(share);
    return c.json(iceServers(deps.turn, me));
  });

  /** Devices whose gateway socket closed and did not come back within the grace: a viewer's seat
   *  goes, a host's share play ends. Run every few seconds; returns how many devices it took out. */
  async function sweepDepartures(now = Date.now()) {
    const due = await valkey.zrangebyscore(shareDeparturesKey, 0, now, "LIMIT", 0, 100);
    let gone = 0;
    for (const entry of due) {
      if (!(await valkey.zrem(shareDeparturesKey, entry))) continue;
      const [userId, device] = entry.split(":") as [string, string];
      if (!userId || !device || (await valkey.exists(devicePresenceKey(userId, device)))) continue;
      for (const id of await valkey.smembers(deviceSharePlaysKey(device))) {
        const share = await load(id);
        if (share?.hostId === userId && share.hostDevice === device) await end(share);
        else if (share && (await seats(share.id)).get(userId)?.device === device) await unseat(share, userId);
      }
      await valkey.del(deviceSharePlaysKey(device));
      gone++;
    }
    return gone;
  }

  return Object.assign(app, { sweepDepartures });
}
