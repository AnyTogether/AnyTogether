import { blocks, friendships, profiles } from "@anytogether/db";
import { ErrorCode, friendsKey, presenceKey } from "@anytogether/shared";
import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";

const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });
const offline = { state: "offline" };

/** Friends and people: requests by handle, a request back makes friends at once, blocks end it all. */
export function friendRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));

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
  const blocked = async (a: string, b: string) =>
    (
      await deps.db
        .select()
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blocker, a), eq(blocks.blocked, b)),
            and(eq(blocks.blocker, b), eq(blocks.blocked, a)),
          ),
        )
    ).length > 0;
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
  }

  async function unfriend(me: string, other: string) {
    const { userA, userB } = pair(me, other);
    const removed = await deps.db
      .delete(friendships)
      .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
      .returning();
    await deps.valkey.multi().srem(friendsKey(me), other).srem(friendsKey(other), me).exec();
    if (removed[0]?.state === "accepted")
      await publish(deps.valkey, other, { type: "friend.removed", data: { userId: me } });
  }

  app.post("/me/friends/requests", async (c) => {
    const me = c.get("userId");
    const { handle } = await body(c, z.object({ handle: z.string().min(1).max(40) }));
    const target = (
      await deps.db
        .select()
        .from(profiles)
        .where(eq(profiles.handle, handle.replace(/^@/, "")))
    )[0];
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
    return c.json({ state: "pending" }, 201);
  });

  app.get("/me/friends/requests", async (c) => {
    const me = c.get("userId");
    const rows = await deps.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.state, "pending"), or(eq(friendships.userA, me), eq(friendships.userB, me))));
    const others = rows.map((r) => (r.userA === me ? r.userB : r.userA));
    const people = others.length
      ? await deps.db.select().from(profiles).where(inArray(profiles.accountId, others))
      : [];
    const byId = new Map(people.map((p) => [p.accountId, p]));
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
    const me = c.get("userId");
    const rows = await deps.db
      .select()
      .from(friendships)
      .where(
        and(eq(friendships.state, "accepted"), or(eq(friendships.userA, me), eq(friendships.userB, me))),
      );
    const others = rows.map((r) => (r.userA === me ? r.userB : r.userA));
    if (others.length === 0) return c.json({ friends: [] });
    const people = await deps.db.select().from(profiles).where(inArray(profiles.accountId, others));
    const presence = await deps.valkey.mget(...others.map(presenceKey));
    const byId = new Map(
      others.map((id, index) => [id, presence[index] ? JSON.parse(presence[index] as string) : offline]),
    );
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
    const pattern = `${query.replace(/[%_\\]/g, "")}%`;
    const found = await deps.db
      .select()
      .from(profiles)
      .where(
        and(
          ne(profiles.accountId, me),
          or(ilike(profiles.handle, pattern), ilike(profiles.displayName, pattern)),
          sql`not exists (select 1 from blocks where (blocker = ${me} and blocked = ${profiles.accountId}) or (blocker = ${profiles.accountId} and blocked = ${me}))`,
        ),
      )
      .limit(20);
    return c.json({ users: found.map(card) });
  });

  app.get("/users/:handle", async (c) => {
    const me = c.get("userId");
    const profile = (
      await deps.db
        .select()
        .from(profiles)
        .where(eq(profiles.handle, c.req.param("handle").replace(/^@/, "")))
    )[0];
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
    return c.json({ ...card(profile), bio: profile.bio, country: profile.country, friendship });
  });

  return app;
}
