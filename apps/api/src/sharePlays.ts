import { games } from "@anytogether/db";
import {
  ErrorCode,
  type GatewayEvent,
  JoinCodeIssue,
  type JoinCodeState,
  LanguageCode,
  type MemberView,
  type PublicJoin,
  type PublicShareView,
  type SharePadSlot,
  SharePlayInvite,
  type SharePlayInviteView,
  type SharePlayJoin,
  SharePlaySlot,
  SharePlayStart,
  SharePlayUpdate,
  type SharePlayView,
  type SharePresence,
  TitleId,
  devicePresenceKey,
  deviceSharePlaysKey,
  hostSharePlayKey,
  publicSharePlaysKey,
  shareDeparturesKey,
  sharePlayInvitesKey,
  sharePlayKeepSeconds,
  sharePlayKey,
  sharePlayMembersKey,
  sharePlayRemovedKey,
  sharePlayRequestsKey,
  sharePlayViewersKey,
  userShareInvitesKey,
  watchSharePlayKey,
} from "@anytogether/shared";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { iceServers } from "./calls.js";
import { HttpError } from "./errors.js";
import { broadcast, publish, topicsFor } from "./events.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import { joinCodeStore } from "./joinCodes.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import { people } from "./people.js";
import { setPresenceExtra } from "./presence.js";
import { rateLimiter, strangerLimiter } from "./ratelimit.js";

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
  /** Listed in public (older ones kept before listing existed have none). */
  public?: { join: PublicJoin; language: string | null; live: boolean } | null;
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
  const strangerLimit = strangerLimiter(deps);
  const family = familyGuard(deps.db);
  const noShare = "Your family settings keep share play off";
  const noPublic = "Your family settings keep public parties, Find players and share plays off";
  const keep = sharePlayKeepSeconds;
  const codes = joinCodeStore(deps);

  /** The public lists hear that a listed share play came, changed or went. */
  const relist = (share: Share, change: "listed" | "updated" | "unlisted") =>
    broadcast(valkey, topicsFor("discover", share.titleId), {
      type: "discover.changed",
      data: { kind: "share_play", id: share.id, titleId: share.titleId, change },
    });

  /** Keeps the public index in step with the share play's listing. */
  const index = async (share: Share) => {
    if (share.public) await valkey.zadd(publicSharePlaysKey, Date.parse(share.startedAt), share.id);
    else await valkey.zrem(publicSharePlaysKey, share.id);
  };

  /** Drops every request to join (the share play left the list or ended); the askers hear no. */
  const dropRequests = async (share: Share) => {
    const asked = Object.keys(await valkey.hgetall(sharePlayRequestsKey(share.id)));
    await valkey.del(sharePlayRequestsKey(share.id));
    for (const userId of asked)
      await publish(valkey, userId, {
        type: "share_play.request_answered",
        data: { sharePlayId: share.id, answer: "declined" },
      });
  };

  const listingOf = (input: { join: PublicJoin; language?: string | null | undefined; live: boolean }) => ({
    join: input.join,
    language: input.language ?? null,
    live: input.live,
  });
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
      sharePlayRequestsKey(share.id),
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
    const asked = forHost ? Object.keys(await valkey.hgetall(sharePlayRequestsKey(share.id))) : [];
    const cards = await who.cards([share.hostId, ...sat.map(([id]) => id), ...invited, ...asked]);
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
      public: share.public ?? null,
      ...(forHost
        ? {
            invited: invited.flatMap((id) => cards.get(id) ?? []),
            requests: asked.flatMap((id) => cards.get(id) ?? []),
            joinCode: await codes.current("share_play", share.id),
          }
        : {}),
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
    if (share.public) await relist(share, "updated");
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
    await dropRequests(share);
    await codes.revoke("share_play", share.id);
    if (share.public) {
      await valkey.zrem(publicSharePlaysKey, share.id);
      await relist(share, "unlisted");
    }
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

  /** How `me` stands with a share play: seated, invited, taken out by the host. */
  const standing = async (share: Share, me: string) => {
    const [[, seated], [, invited], [, removed]] = (await valkey
      .multi()
      .hexists(sharePlayViewersKey(share.id), me)
      .hexists(sharePlayInvitesKey(share.id), me)
      .sismember(sharePlayRemovedKey(share.id), me)
      .exec()) as [[null, number], [null, number], [null, number]];
    return { seated: Boolean(seated), invited: Boolean(invited), removed: Boolean(removed) };
  };

  /** May `me` take a seat without asking: seated or invited already, a friend of the host while it
   *  is open to friends, or anyone while it is listed in public as open. */
  const mayWalkIn = async (share: Share, me: string) => {
    const { seated, invited, removed } = await standing(share, me);
    if (seated || invited) return true;
    if (removed) return false;
    return share.public?.join === "open" || (share.open && (await who.friends(me, share.hostId)));
  };

  /** The host, its viewers, the invited and (while open) the host's friends see it, and anyone
   *  while it is listed in public; nobody the host took out (unless invited again) or who has a
   *  block with the host. */
  const visible = async (id: string, me: string) => {
    const share = await load(id);
    if (share) {
      if (share.hostId === me) return share;
      const { seated, invited, removed } = await standing(share, me);
      if (
        seated ||
        invited ||
        (!removed && (share.public || (share.open && (await who.friends(me, share.hostId)))))
      )
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

  /** The host invites people (who may be invited is the caller's to check); they hear it on every
   *  device. Returns who was invited now. */
  async function inviteTo(share: Share, userIds: string[]) {
    const at = new Date().toISOString();
    const fresh: string[] = [];
    for (const id of userIds) {
      const added = await valkey.hsetnx(sharePlayInvitesKey(share.id), id, at);
      await valkey
        .multi()
        .srem(sharePlayRemovedKey(share.id), id)
        .hdel(sharePlayRequestsKey(share.id), id)
        .hset(userShareInvitesKey(id), share.id, JSON.stringify({ from: share.hostId, at }))
        .expire(userShareInvitesKey(id), keep)
        .exec();
      if (added) fresh.push(id);
    }
    await touch(share);
    const from = await who.card(share.hostId);
    if (from)
      await tell(fresh, {
        type: "share_play.invite",
        data: { sharePlayId: share.id, from, titleId: share.titleId, title: share.title },
      });
    if (fresh.length)
      await tell([share.hostId], { type: "share_play.updated", data: await view(share, true) });
    return fresh;
  }

  /** The share play `userId` hosts now, if any. */
  const hostedBy = async (userId: string) => load((await valkey.get(hostSharePlayKey(userId))) ?? "");

  /** Share plays listed in public that `me` may see (no block with the host, not taken out by
   *  them), newest first; `live` keeps the ones under Live now. Ones that ended are dropped from
   *  the index as they are found. */
  async function publicShares(
    me: string,
    filter: { titleId?: string; language?: string; live?: boolean; limit?: number },
  ) {
    const ids = await valkey.zrevrange(publicSharePlaysKey, 0, 499);
    const found: Share[] = [];
    for (const id of ids) {
      const share = await load(id);
      if (!share?.public) {
        await valkey.zrem(publicSharePlaysKey, id);
        continue;
      }
      if (filter.titleId && share.titleId !== filter.titleId) continue;
      if (filter.language && share.public.language !== filter.language) continue;
      if (filter.live && !share.public.live) continue;
      found.push(share);
    }
    const blocked = await who.blockedAmong(
      me,
      found.map((s) => s.hostId),
    );
    const shown: Share[] = [];
    for (const share of found) {
      if (blocked.has(share.hostId)) continue;
      if (share.hostId !== me && (await valkey.sismember(sharePlayRemovedKey(share.id), me))) continue;
      shown.push(share);
      if (shown.length >= (filter.limit ?? 50)) break;
    }
    const cards = await who.cards(shown.map((s) => s.hostId));
    const titles = [...new Set(shown.map((s) => s.titleId))];
    const names = new Map(
      titles.length
        ? (await deps.db.select().from(games).where(inArray(games.titleId, titles))).map((g) => [
            g.titleId,
            g,
          ])
        : [],
    );
    const views: PublicShareView[] = [];
    for (const share of shown) {
      const listing = share.public as NonNullable<Share["public"]>;
      const game = names.get(share.titleId);
      views.push({
        id: share.id,
        host: cards.get(share.hostId) ?? null,
        titleId: share.titleId,
        title: share.title,
        game: game ? { names: game.names, iconUrl: game.iconUrl } : null,
        language: listing.language,
        join: listing.join,
        live: listing.live,
        viewers: await valkey.hlen(sharePlayViewersKey(share.id)),
        maxViewers: share.maxViewers,
        requested: Boolean(await valkey.hexists(sharePlayRequestsKey(share.id), me)),
        startedAt: share.startedAt,
      });
    }
    return views;
  }

  /** `me` asks to watch (from the public list or with the join code): the host hears it. Whether
   *  they may is the caller's to check. True when the request is new. */
  async function ask(share: Share, me: string, via: "list" | "code") {
    const made = await valkey.hsetnx(sharePlayRequestsKey(share.id), me, new Date().toISOString());
    await touch(share);
    if (!made) return false;
    const from = await who.card(me);
    if (from)
      await tell([share.hostId], { type: "share_play.request", data: { sharePlayId: share.id, from, via } });
    await tell([share.hostId], { type: "share_play.updated", data: await view(share, true) });
    return true;
  }

  /** What a join code opens, as `me` (or anyone, signed out) sees it; nothing for someone with a
   *  block either way with the host, or whom the host took out. */
  async function codeTarget(id: string, me?: string) {
    const share = await load(id);
    if (!share) return undefined;
    let state: JoinCodeState | undefined;
    if (me) {
      if (me === share.hostId) state = "member";
      else {
        const { seated, invited, removed } = await standing(share, me);
        if (removed || (await who.blocked(me, share.hostId))) return undefined;
        const asked = Boolean(await valkey.hexists(sharePlayRequestsKey(share.id), me));
        state = seated ? "member" : invited ? "invited" : asked ? "requested" : "none";
      }
    }
    const [game] = await deps.db
      .select()
      .from(games)
      .where(inArray(games.titleId, [share.titleId]));
    return {
      host: await who.card(share.hostId),
      game: {
        titleId: share.titleId,
        title: share.title,
        names: game?.names ?? {},
        iconUrl: game?.iconUrl ?? null,
      },
      size: await valkey.hlen(sharePlayViewersKey(share.id)),
      max: share.maxViewers,
      state,
    };
  }

  /** Asks to watch with a join code: a child needs share play on and follows their family's rules
   *  (public matchmaking for a stranger's share play, and who may talk to them). */
  async function askWithCode(id: string, me: string) {
    const share = await load(id);
    if (!share) throw new HttpError(404, ErrorCode.notFound, "No such share play");
    if (share.hostId === me) throw new HttpError(409, ErrorCode.conflict, "That is your own share play");
    const { seated, invited, removed } = await standing(share, me);
    if (removed || (await who.blocked(me, share.hostId)))
      throw new HttpError(404, ErrorCode.notFound, "No such share play");
    if (seated) throw new HttpError(409, ErrorCode.conflict, "You are watching");
    await family.need(me, "share_play", noShare);
    const friend = await who.friends(me, share.hostId);
    if (!friend) await family.need(me, "public_matchmaking", noPublic);
    await family.mayMessage(me, [share.hostId]);
    if (invited) return { state: "invited" as const, made: false };
    if (await valkey.hexists(sharePlayRequestsKey(share.id), me))
      return { state: "requested" as const, made: false };
    if (!friend) await strangerLimit("joinRequest", me);
    return { state: "requested" as const, made: await ask(share, me, "code") };
  }

  /** The host hands out a join code (in place of the one before): anyone holding it may ask to
   *  watch. */
  app.post("/share-plays/:id/code", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    const { hours } = await body(c, JoinCodeIssue);
    await assertNotMuted(deps.db, me);
    await family.need(me, "public_matchmaking", noPublic);
    await limit("joinCode", me);
    const code = await codes.issue("share_play", share.id, me, hours);
    await touch(share);
    await tell([me], { type: "share_play.updated", data: await view(share, true) });
    return c.json(code, 201);
  });

  /** The host stops the join code working; requests made with it wait for an answer still. */
  app.delete("/share-plays/:id/code", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    if (!(await codes.revoke("share_play", share.id)))
      throw new HttpError(404, ErrorCode.notFound, "No code to stop");
    await tell([me], { type: "share_play.updated", data: await view(share, true) });
    return c.body(null, 204);
  });

  /** Share plays listed in public, newest first; by game and language, and live=1 for the ones
   *  under Live now. */
  app.get("/share-plays/public", async (c) => {
    const titleId = c.req.query("titleId");
    const language = c.req.query("language");
    if (titleId !== undefined && !TitleId.safeParse(titleId).success)
      throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    if (language !== undefined && !LanguageCode.safeParse(language).success)
      throw new HttpError(400, ErrorCode.badRequest, "language: a language like en or tr");
    await family.need(c.get("userId"), "share_play", noShare);
    await family.need(
      c.get("userId"),
      "public_matchmaking",
      "Your family settings keep public parties, Find players and share plays off",
    );
    return c.json({
      sharePlays: await publicShares(c.get("userId"), {
        titleId,
        language,
        live: c.req.query("live") === "1",
      }),
    });
  });

  /** Start sharing the game this device runs; one at a time, so an earlier one ends. */
  app.post("/share-plays", async (c) => {
    const me = c.get("userId");
    const device = c.get("sessionId");
    const input = await body(c, SharePlayStart);
    await family.need(me, "share_play", noShare);
    if (input.public)
      await family.need(
        me,
        "public_matchmaking",
        "Your family settings keep public parties, Find players and share plays off",
      );
    await family.mayPlay(me, input.titleId);
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
      public: input.public ? listingOf(input.public) : null,
    };
    await valkey
      .multi()
      .set(sharePlayKey(share.id), JSON.stringify(share), "EX", keep)
      .sadd(sharePlayMembersKey(share.id), me)
      .set(hostSharePlayKey(me), share.id, "EX", keep)
      .exec();
    await touch(share, [device]);
    await showInPresence(share, 0);
    if (share.public) {
      await index(share);
      await relist(share, "listed");
    }
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
      ...(input.public !== undefined ? { public: input.public ? listingOf(input.public) : null } : {}),
    };
    await valkey.set(sharePlayKey(share.id), JSON.stringify(updated), "EX", keep);
    await touch(updated);
    await index(updated);
    if (share.public && !updated.public) {
      // Requests that came with the join code stay while it works.
      if (!(await codes.current("share_play", share.id))) await dropRequests(updated);
      await relist(share, "unlisted");
    } else if (!share.public && updated.public) await relist(updated, "listed");
    else if (share.public && share.titleId !== updated.titleId) {
      await relist(share, "unlisted");
      await relist(updated, "listed");
    }
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
    if ((await family.without(asked, "share_play")).size)
      throw new HttpError(403, ErrorCode.restrictedByFamily, "Someone you invited cannot watch share plays", {
        feature: "share_play",
        side: "other",
      });
    return c.json({ invited: await inviteTo(share, asked) });
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
    await family.need(me, "share_play", noShare);
    if (!(await mayWalkIn(share, me)))
      throw new HttpError(403, ErrorCode.forbidden, "Ask the host to let you in", {
        join: share.public?.join ?? null,
      });
    const before = (await seats(share.id)).get(me);
    // Walking into a stranger's share play counts like asking to.
    if (!before && share.public?.join === "open" && !(await standing(share, me)).invited)
      if (!(await who.friends(me, share.hostId))) await strangerLimit("joinRequest", me);
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
      .hdel(sharePlayRequestsKey(share.id), me)
      .hdel(userShareInvitesKey(me), share.id)
      .set(watchSharePlayKey(me), share.id, "EX", keep);
    if (before && before.device !== device) write.srem(deviceSharePlaysKey(before.device), share.id);
    await write.exec();
    await touch(share, [device]);
    await changed(share);
    return c.json(await joined(share, me, false), before ? 200 : 201);
  });

  /** Asks to join a share play listed in public; the host hears it and lets them in with an
   *  invite. */
  app.post("/share-plays/:id/requests", async (c) => {
    const me = c.get("userId");
    const share = await visible(c.req.param("id"), me);
    if (share.hostId === me) throw new HttpError(400, ErrorCode.badRequest, "That is your own share play");
    if (!share.public) throw new HttpError(403, ErrorCode.forbidden, "This share play takes no requests");
    await family.need(me, "share_play", noShare);
    await family.need(
      me,
      "public_matchmaking",
      "Your family settings keep public parties, Find players and share plays off",
    );
    if ((await standing(share, me)).seated) throw new HttpError(409, ErrorCode.conflict, "You are watching");
    await strangerLimit("joinRequest", me);
    const made = await ask(share, me, "list");
    return c.json({ requested: true }, made ? 201 : 200);
  });

  app.delete("/share-plays/:id/requests/me", async (c) => {
    const me = c.get("userId");
    const share = await load(c.req.param("id"));
    const removed = share ? await valkey.hdel(sharePlayRequestsKey(share.id), me) : 0;
    if (!share || !removed) throw new HttpError(404, ErrorCode.notFound, "No such request");
    await tell([share.hostId], {
      type: "share_play.request_cancelled",
      data: { sharePlayId: share.id, userId: me },
    });
    await tell([share.hostId], { type: "share_play.updated", data: await view(share, true) });
    return c.body(null, 204);
  });

  /** The host answers a request: yes is an invite, which the asker hears and joins with. */
  app.post("/share-plays/:id/requests/:userId/:answer{accept|decline}", async (c) => {
    const me = c.get("userId");
    const share = await asHost(c.req.param("id"), me);
    const userId = c.req.param("userId");
    const removed = await valkey.hdel(sharePlayRequestsKey(share.id), userId);
    if (!removed) throw new HttpError(404, ErrorCode.notFound, "No such request");
    const accept = c.req.param("answer") === "accept";
    if (accept && !(await who.blocked(me, userId))) await inviteTo(share, [userId]);
    else await tell([me], { type: "share_play.updated", data: await view(share, true) });
    await tell([userId], {
      type: "share_play.request_answered",
      data: { sharePlayId: share.id, answer: accept ? "accepted" : "declined" },
    });
    return c.json(await view(share, true));
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

  return Object.assign(app, { sweepDepartures, hostedBy, inviteTo, publicShares, codeTarget, askWithCode });
}

export type SharePlayService = ReturnType<typeof sharePlayRoutes>;
