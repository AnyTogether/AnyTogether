import { accounts, handleHistory, profiles } from "@anytogether/db";
import {
  ErrorCode,
  HandleChange,
  PresenceModeUpdate,
  PrivacyUpdate,
  ProfileUpdate,
  ReadReceiptsSet,
  friendsKey,
  handleCooldownDays,
  handleSkeleton,
  hasLink,
  isReservedHandle,
  presenceHidden,
  presenceHiddenKey,
  presenceKey,
  privacyOf,
  trophyLevelOf,
} from "@anytogether/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { mayShow } from "./family.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted, restrictionsOf } from "./moderation.js";
import { type ProfileRow, handleProblem, skeletonClash } from "./people.js";
import { identityOf } from "./privateIdentity.js";
import { rateLimiter } from "./ratelimit.js";
import { lookOf } from "./showcase.js";

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
    trophyLevel: trophyLevelOf(profile.trophyPoints),
    // The owner always sees their own friends-only name and picture.
    ...identityOf(deps, profile),
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
    const profile = await load(userId);
    return c.json({
      account: { id: account.id, email: account.email, role: account.role, createdAt: account.createdAt },
      profile: {
        ...own(profile),
        ...(await lookOf(db, deps.publicUrl, profile)),
        showcase: profile.showcase,
        rememberMet: profile.rememberMet,
        appearOffline: profile.appearOffline,
        readReceipts: profile.readReceipts,
      },
      // What the account may not do now (a mute; a banned account has no session), and its
      // newest appeal.
      ...(await restrictionsOf(db, userId)),
    });
  });

  app.patch("/me/profile", async (c) => {
    const userId = c.get("userId");
    const input = await body(c, ProfileUpdate);
    // Clearing is always allowed; writing a name or bio is not while muted.
    if (input.displayName !== undefined || input.bio || input.privateName) await assertNotMuted(db, userId);
    if (
      (input.displayName && hasLink(input.displayName)) ||
      (input.bio && hasLink(input.bio)) ||
      (input.privateName && hasLink(input.privateName))
    )
      throw new HttpError(400, ErrorCode.linksNotAllowed, "Names and bios cannot carry links");
    const changes = {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio || null } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.privateName !== undefined ? { privateName: input.privateName || null } : {}),
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
    const similar = () =>
      new HttpError(409, ErrorCode.handleTooSimilar, "That handle looks too much like another one");
    try {
      await db.transaction(async (tx) => {
        const problem = await handleProblem(tx, handle, userId);
        if (problem === "too_similar") throw similar();
        if (problem) throw taken();
        await tx
          .update(profiles)
          .set({ handle, handleSkeleton: handleSkeleton(handle), handleChangedAt: new Date() })
          .where(eq(profiles.accountId, userId));
        // The old handle is held for its owner; taking back one's own old handle frees it.
        const old = { accountId: userId, releasedAt: new Date(), skeleton: handleSkeleton(profile.handle) };
        await tx
          .insert(handleHistory)
          .values({ handle: profile.handle, ...old })
          .onConflictDoUpdate({ target: handleHistory.handle, set: old });
        await tx
          .delete(handleHistory)
          .where(and(eq(handleHistory.handle, handle), eq(handleHistory.accountId, userId)));
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Two people asking for the same (or look-alike) handle at once: the unique indexes decide.
      if (skeletonClash(error)) throw similar();
      if ((error as { code?: string }).code === "23505") throw taken();
      throw error;
    }
    return c.json(own(await load(userId)));
  });

  app.patch("/me/privacy", async (c) => {
    const userId = c.get("userId");
    const input = await body(c, PrivacyUpdate);
    const profile = await load(userId);
    const before = privacyOf(profile.privacy);
    const privacy = privacyOf({ ...before, ...input });
    await mayShow(deps, userId, privacy);
    await db.update(profiles).set({ privacy }).where(eq(profiles.accountId, userId));
    await presenceShownChanged(
      deps,
      userId,
      presenceHidden(before, profile.appearOffline),
      presenceHidden(privacy, profile.appearOffline),
    );
    return c.json(privacy);
  });

  /** Appear offline: the account stays signed in and keeps working, but everyone else sees it
   *  offline. Its other devices hear the change, and so does the gateway. */
  app.patch("/me/presence", async (c) => {
    const userId = c.get("userId");
    const { appearOffline } = await body(c, PresenceModeUpdate);
    const profile = await load(userId);
    const privacy = privacyOf(profile.privacy);
    if (appearOffline !== profile.appearOffline)
      await db.update(profiles).set({ appearOffline }).where(eq(profiles.accountId, userId));
    await presenceShownChanged(
      deps,
      userId,
      presenceHidden(privacy, profile.appearOffline),
      presenceHidden(privacy, appearOffline),
    );
    await publish(deps.valkey, userId, { type: "presence.mode", data: { appearOffline } });
    return c.json({ appearOffline });
  });

  /** Read receipts on or off: off, nobody sees how far this person has read and they see nobody's
   *  (delivered marks and their own unread counts stay). Their other devices hear the change. */
  app.patch("/me/read-receipts", async (c) => {
    const userId = c.get("userId");
    const { readReceipts } = await body(c, ReadReceiptsSet);
    await db.update(profiles).set({ readReceipts }).where(eq(profiles.accountId, userId));
    await publish(deps.valkey, userId, { type: "messages.settings", data: { readReceipts } });
    return c.json({ readReceipts });
  });

  return app;
}

/** After a privacy or appear-offline change: hiding presence takes the account offline for its
 *  friends now; showing it again lets the gateway tell them (at once on `presence.mode`, else at the
 *  next heartbeat). */
export async function presenceShownChanged(
  deps: Pick<Deps, "valkey">,
  userId: string,
  wasHidden: boolean,
  hidden: boolean,
) {
  if (hidden && !wasHidden) {
    // Friends see the account go offline now; the gateway keeps quiet from here on.
    await deps.valkey.multi().set(presenceHiddenKey(userId), "1").del(presenceKey(userId)).exec();
    for (const friend of await deps.valkey.smembers(friendsKey(userId)))
      await publish(deps.valkey, friend, { type: "presence.updated", data: { userId, state: "offline" } });
  } else if (!hidden && wasHidden) {
    // The next heartbeat finds no presence kept and tells the friends again.
    await deps.valkey.multi().del(presenceHiddenKey(userId)).del(presenceKey(userId)).exec();
  }
}
