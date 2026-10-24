import { accounts, blocks, friendships, profiles } from "@anytogether/db";
import { ErrorCode, friendsKey, presenceKey, privacyOf } from "@anytogether/shared";
import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { forgetFriendship, recordFriendship } from "./feed.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import { type ProfileRow, blockedBetween, canSee, findProfile, relationOf } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });
const offline = { state: "offline" };

/** Friends and people: requests by handle, a request back makes friends at once, blocks end it all. */
export function friendRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const limit = rateLimiter(deps.valkey, deps.limits);

  const profileOf = async (userId: string) =>
    (await deps.db.select().from(profiles).where(eq(profiles.accountId, userId)))[0];
  const card = (profile: {
    accountId: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
  }) => ({
    userId: profile.accountId,
    handle: profile.handle,
    displayName: profile.displayName,
    avatar: profile.avatarUrl,
  });
  const blocked = (a: string, b: string) => blockedBetween(deps.db, a, b);
  /** Profiles of accounts in good standing: banned ones and ones being deleted are left out. */
  const activePeople = async (ids: string[]): Promise<ProfileRow[]> =>
    ids.length
      ? (
          await deps.db
            .select({ profile: profiles })
            .from(profiles)
            .innerJoin(accounts, eq(accounts.id, profiles.accountId))
            .where(and(inArray(profiles.accountId, ids), eq(accounts.status, "active")))
        ).map((r) => r.profile)
      : [];
  const friendIds = async (userId: string) =>
    (
      await deps.db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.state, "accepted"),
            or(eq(friendships.userA, userId), eq(friendships.userB, userId)),
          ),
        )
    ).map((r) => (r.userA === userId ? r.userB : r.userA));
  /** What the gateway keeps, unless the person hides it from friends. */
  const presenceOf = async (people: ProfileRow[], relation: "me" | "friend" | "other") => {
    const kept = people.length ? await deps.valkey.mget(...people.map((p) => presenceKey(p.accountId))) : [];
    return new Map(
      people.map((p, index) => [
        p.accountId,
        kept[index] && canSee(privacyOf(p.privacy).presence, relation)
          ? JSON.parse(kept[index] as string)
          : offline,
      ]),
    );
  };
  const row = async (a: string, b: string) => {
    const { userA, userB } = pair(a, b);
    return (
      await deps.db
        .select()
        .from(friendships)
        .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    )[0];
  };

  async function befriend(me: string, other: string) {
    const { userA, userB } = pair(me, other);
    await deps.db
      .update(friendships)
      .set({ state: "accepted", acceptedAt: new Date() })
      .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)));
    await deps.valkey.multi().sadd(friendsKey(me), other).sadd(friendsKey(other), me).exec();
    const mine = await profileOf(me);
    if (mine)
      await publish(deps.valkey, other, {
        type: "friend.accepted",
        data: { userId: me, handle: mine.handle, displayName: mine.displayName },
      });
    await recordFriendship(deps, me, other);
    await notes.settle(me, "friend_request", other);
    await notes.notify(other, { kind: "friend_accepted", actorId: me, subjectId: me });
  }

  async function unfriend(me: string, other: string) {
    const { userA, userB } = pair(me, other);
    const removed = await deps.db
      .delete(friendships)
      .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
      .returning();
    await deps.valkey.multi().srem(friendsKey(me), other).srem(friendsKey(other), me).exec();
    await forgetFriendship(deps.db, me, other);
    // A request withdrawn or declined is no longer news for either of them.
    if (removed[0]?.state === "pending") {
      await notes.withdraw(other, "friend_request", me);
      await notes.settle(me, "friend_request", other);
    }
    if (removed[0]?.state === "accepted")
      await publish(deps.valkey, other, { type: "friend.removed", data: { userId: me } });
  }

  app.post("/me/friends/requests", async (c) => {
    const me = c.get("userId");
    const { handle } = await body(c, z.object({ handle: z.string().min(1).max(40) }));
    await limit("friendRequest", me);
    const target = await findProfile(deps.db, handle);
    if (!target || (await blocked(me, target.accountId)))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    if (target.accountId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
    const existing = await row(me, target.accountId);
    if (existing?.state === "accepted") return c.json({ state: "accepted" });
    if (existing && existing.askedBy !== me) {
      await befriend(me, target.accountId);
      return c.json({ state: "accepted" });
    }
    if (existing) return c.json({ state: "pending" });
    await deps.db
      .insert(friendships)
      .values({ ...pair(me, target.accountId), state: "pending", askedBy: me });
    const mine = await profileOf(me);
    if (mine)
      await publish(deps.valkey, target.accountId, {
        type: "friend.request",
        data: { userId: me, handle: mine.handle, displayName: mine.displayName },
      });
    await notes.notify(target.accountId, { kind: "friend_request", actorId: me, subjectId: me });
    return c.json({ state: "pending" }, 201);
  });

  app.get("/me/friends/requests", async (c) => {
    const me = c.get("userId");
    const rows = await deps.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.state, "pending"), or(eq(friendships.userA, me), eq(friendships.userB, me))));
    const others = rows.map((r) => (r.userA === me ? r.userB : r.userA));
    const byId = new Map((await activePeople(others)).map((p) => [p.accountId, p]));
    const shown = (r: (typeof rows)[number]) => {
      const other = byId.get(r.userA === me ? r.userB : r.userA);
      return other ? { ...card(other), askedAt: r.createdAt } : null;
    };
    return c.json({
      incoming: rows
        .filter((r) => r.askedBy !== me)
        .map(shown)
        .filter(Boolean),
      outgoing: rows
        .filter((r) => r.askedBy === me)
        .map(shown)
        .filter(Boolean),
    });
  });

  app.post("/me/friends/requests/:userId/:answer{accept|decline}", async (c) => {
    const me = c.get("userId");
    const other = c.req.param("userId");
    const existing = await row(me, other);
    if (!existing || existing.state !== "pending" || existing.askedBy === me)
      throw new HttpError(404, ErrorCode.notFound, "No such request");
    if (c.req.param("answer") === "accept") await befriend(me, other);
    else await unfriend(me, other);
    return c.body(null, 204);
  });

  app.get("/me/friends", async (c) => {
    const people = await activePeople(await friendIds(c.get("userId")));
    const byId = await presenceOf(people, "friend");
    const friends = people.map((p) => ({ ...card(p), presence: byId.get(p.accountId) ?? offline }));
    // Playing first, then online, then the rest, each by name.
    const rank = (state: string) =>
      state === "in_game" ? 0 : state === "online" ? 1 : state === "away" ? 2 : 3;
    friends.sort(
      (x, y) => rank(x.presence.state) - rank(y.presence.state) || x.displayName.localeCompare(y.displayName),
    );
    return c.json({ friends });
  });

  app.delete("/me/friends/:userId", async (c) => {
    await unfriend(c.get("userId"), c.req.param("userId"));
    return c.body(null, 204);
  });

  app.post("/me/blocks", async (c) => {
    const me = c.get("userId");
    const { userId } = await body(c, z.object({ userId: z.string().uuid() }));
    if (userId === me) throw new HttpError(400, ErrorCode.badRequest, "That is you");
    await deps.db.insert(blocks).values({ blocker: me, blocked: userId }).onConflictDoNothing();
    await unfriend(me, userId);
    return c.body(null, 204);
  });

  app.delete("/me/blocks/:userId", async (c) => {
    await deps.db
      .delete(blocks)
      .where(and(eq(blocks.blocker, c.get("userId")), eq(blocks.blocked, c.req.param("userId"))));
    return c.body(null, 204);
  });

  app.get("/users/search", async (c) => {
    const me = c.get("userId");
    const query = (c.req.query("q") ?? "").replace(/^@/, "").trim();
    if (query.length < 2) return c.json({ users: [] });
    await limit("search", me);
    const pattern = `${query.replace(/[%_\\]/g, "")}%`;
    // Who wants to be found: everyone, or only by friends; never banned accounts or blocks.
    const findable = sql.raw("coalesce(profiles.privacy->>'search', 'everyone')");
    const found = await deps.db
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(
        and(
          ne(profiles.accountId, me),
          eq(accounts.status, "active"),
          or(ilike(profiles.handle, pattern), ilike(profiles.displayName, pattern)),
          sql`not exists (select 1 from blocks where (blocker = ${me} and blocked = ${profiles.accountId}) or (blocker = ${profiles.accountId} and blocked = ${me}))`,
          sql`(${findable} = 'everyone' or (${findable} = 'friends' and exists (select 1 from friendships f
            where f.state = 'accepted' and ((f.user_a = ${me} and f.user_b = ${profiles.accountId})
              or (f.user_b = ${me} and f.user_a = ${profiles.accountId})))))`,
        ),
      )
      .limit(20);
    return c.json({ users: found.map((r) => card(r.profile)) });
  });

  app.get("/users/:handle", async (c) => {
    const me = c.get("userId");
    const profile = await findProfile(deps.db, c.req.param("handle"));
    if (!profile || (await blocked(me, profile.accountId)))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    const existing = profile.accountId === me ? undefined : await row(me, profile.accountId);
    const friendship =
      profile.accountId === me
        ? "me"
        : !existing
          ? "none"
          : existing.state === "accepted"
            ? "friends"
            : existing.askedBy === me
              ? "pending_out"
              : "pending_in";
    const relation = friendship === "me" ? "me" : friendship === "friends" ? "friend" : "other";
    const privacy = privacyOf(profile.privacy);
    // Which parts the asker may open; the card itself is shown to anyone not blocked.
    const visible = {
      library: canSee(privacy.library, relation),
      trophies: canSee(privacy.trophies, relation),
      friends: canSee(privacy.friends, relation),
      presence: canSee(privacy.presence, relation),
    };
    return c.json({
      ...card(profile),
      bio: profile.bio,
      country: profile.country,
      friendship,
      visible,
      ...(visible.presence
        ? { presence: (await presenceOf([profile], relation)).get(profile.accountId) }
        : {}),
    });
  });

  app.get("/users/:handle/friends", async (c) => {
    const me = c.get("userId");
    const profile = await findProfile(deps.db, c.req.param("handle"));
    if (!profile || (await blocked(me, profile.accountId)))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    const relation = await relationOf(deps.db, me, profile.accountId);
    if (!canSee(privacyOf(profile.privacy).friends, relation))
      throw new HttpError(403, ErrorCode.forbidden, "This friends list is private", { section: "friends" });
    const ids = await friendIds(profile.accountId);
    // Nobody the asker blocked, or who blocked the asker, shows up in someone else's list.
    const hidden = new Set(
      ids.length && relation !== "me"
        ? (
            await deps.db
              .select()
              .from(blocks)
              .where(
                or(
                  and(eq(blocks.blocker, me), inArray(blocks.blocked, ids)),
                  and(eq(blocks.blocked, me), inArray(blocks.blocker, ids)),
                ),
              )
          ).map((b) => (b.blocker === me ? b.blocked : b.blocker))
        : [],
    );
    const people = (await activePeople(ids.filter((id) => !hidden.has(id)))).map(card);
    people.sort((x, y) => x.displayName.localeCompare(y.displayName));
    return c.json({ friends: people });
  });

  return app;
}
