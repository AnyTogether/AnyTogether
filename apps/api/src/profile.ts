import { accounts, handleHistory, profiles } from "@anytogether/db";
import {
  ErrorCode,
  HandleChange,
  PrivacyUpdate,
  ProfileUpdate,
  friendsKey,
  handleCooldownDays,
  hasLink,
  isReservedHandle,
  presenceHiddenKey,
  presenceKey,
  privacyOf,
} from "@anytogether/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { type ProfileRow, handleFree } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

const cooldown = handleCooldownDays * 86_400_000;

/** When the handle may change again; null when it may now (the first change is always free). */
const nextHandleChange = (profile: ProfileRow) =>
  profile.handleChangedAt && profile.handleChangedAt.getTime() + cooldown > Date.now()
    ? new Date(profile.handleChangedAt.getTime() + cooldown)
    : null;

/** The signed-in user's own account and profile, and changing them. */
export function profileRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const limit = rateLimiter(deps.valkey, deps.limits);
  app.patch("/me/*", async (c, next) => {
    await limit("profile", c.get("userId"));
    await next();
  });

  const own = (profile: ProfileRow) => ({
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    avatar: profile.avatarUrl,
    country: profile.country,
    handleChangedAt: profile.handleChangedAt,
    handleChangeAt: nextHandleChange(profile),
    privacy: privacyOf(profile.privacy),
  });
  const load = async (userId: string) => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.accountId, userId));
    if (!profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return profile;
  };

  app.get("/me", async (c) => {
    const userId = c.get("userId");
    const [account] = await db.select().from(accounts).where(eq(accounts.id, userId));
    if (!account) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return c.json({
      account: { id: account.id, email: account.email, createdAt: account.createdAt },
      profile: own(await load(userId)),
    });
  });

  app.patch("/me/profile", async (c) => {
    const userId = c.get("userId");
    const input = await body(c, ProfileUpdate);
    if ((input.displayName && hasLink(input.displayName)) || (input.bio && hasLink(input.bio)))
      throw new HttpError(400, ErrorCode.linksNotAllowed, "Names and bios cannot carry links");
    const changes = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio || null } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
    };
    if (Object.keys(changes).length)
      await db.update(profiles).set(changes).where(eq(profiles.accountId, userId));
    return c.json(own(await load(userId)));
  });

  app.patch("/me/handle", async (c) => {
    const userId = c.get("userId");
    const { handle } = await body(c, HandleChange);
    const profile = await load(userId);
    if (profile.handle.toLowerCase() === handle) return c.json(own(profile));
    const after = nextHandleChange(profile);
    if (after) {
      const seconds = Math.ceil((after.getTime() - Date.now()) / 1000);
      throw new HttpError(
        429,
        ErrorCode.handleCooldown,
        `The handle can change again on ${after.toISOString().slice(0, 10)}`,
        { handleChangeAt: after.toISOString() },
        { "retry-after": String(seconds) },
      );
    }
    if (isReservedHandle(handle))
      throw new HttpError(400, ErrorCode.handleReserved, "That handle is reserved");
    const taken = () => new HttpError(409, ErrorCode.handleTaken, "That handle is taken");
    try {
      await db.transaction(async (tx) => {
        if (!(await handleFree(tx, handle, userId))) throw taken();
        await tx
          .update(profiles)
          .set({ handle, handleChangedAt: new Date() })
          .where(eq(profiles.accountId, userId));
        // The old handle is held for its owner; taking back one's own old handle frees it.
        await tx
          .insert(handleHistory)
          .values({ handle: profile.handle, accountId: userId })
          .onConflictDoUpdate({
            target: handleHistory.handle,
            set: { accountId: userId, releasedAt: new Date() },
          });
        await tx
          .delete(handleHistory)
          .where(and(eq(handleHistory.handle, handle), eq(handleHistory.accountId, userId)));
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Two people asking for the same handle at once: the unique index decides.
      if ((error as { code?: string }).code === "23505") throw taken();
      throw error;
    }
    return c.json(own(await load(userId)));
  });

  app.patch("/me/privacy", async (c) => {
    const userId = c.get("userId");
    const input = await body(c, PrivacyUpdate);
    const before = privacyOf((await load(userId)).privacy);
    const privacy = privacyOf({ ...before, ...input });
    await db.update(profiles).set({ privacy }).where(eq(profiles.accountId, userId));
    if (privacy.presence === "nobody" && before.presence !== "nobody") {
      // Friends see the account go offline now; the gateway keeps quiet from here on.
      await deps.valkey.multi().set(presenceHiddenKey(userId), "1").del(presenceKey(userId)).exec();
      for (const friend of await deps.valkey.smembers(friendsKey(userId)))
        await publish(deps.valkey, friend, { type: "presence.updated", data: { userId, state: "offline" } });
    } else if (privacy.presence !== "nobody" && before.presence === "nobody") {
      // The next heartbeat finds no presence kept and tells the friends again.
      await deps.valkey.multi().del(presenceHiddenKey(userId)).del(presenceKey(userId)).exec();
    }
    return c.json(privacy);
  });

  return app;
}
