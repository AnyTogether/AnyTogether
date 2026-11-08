import { conversationMembers, conversations, e2eeDevices, sessions } from "@anytogether/db";
import { deviceIdOf, fromBase64, publicDeviceName, verifyDevice } from "@anytogether/e2ee";
import {
  E2eeDeviceRegister,
  type E2eeDeviceView,
  type E2eeDevicesView,
  ErrorCode,
  type SealedMessage,
  maxE2eeDevices,
} from "@anytogether/shared";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { people } from "./people.js";

type Device = typeof e2eeDevices.$inferSelect;
type Db = Deps["db"];

const iso = (date: Date | null) => (date ? date.toISOString() : null);
const deviceView = (d: Device): E2eeDeviceView => ({
  id: d.id,
  signKey: d.signKey,
  boxKey: d.boxKey,
  sig: d.sig,
  name: d.name,
  createdAt: d.createdAt.toISOString(),
  removedAt: iso(d.removedAt),
});

/** A device key counts while it is not removed and its session is still signed in. */
const activeWhere = () =>
  and(
    isNull(e2eeDevices.removedAt),
    sql`exists (select 1 from ${sessions} where ${sessions.id} = ${e2eeDevices.sessionId}
      and ${sessions.revokedAt} is null and ${sessions.expiresAt} > now())`,
  );

/** The active devices of these people, by user ID (everyone asked for is there, maybe empty). */
export async function activeDevices(db: Db, userIds: string[]) {
  const found = new Map<string, Device[]>(userIds.map((id) => [id, []]));
  if (!userIds.length) return found;
  const rows = await db
    .select()
    .from(e2eeDevices)
    .where(and(inArray(e2eeDevices.accountId, userIds), activeWhere()))
    .orderBy(e2eeDevices.createdAt);
  for (const row of rows) found.get(row.accountId)?.push(row);
  return found;
}

/** The people one has a direct conversation with. */
async function directPartners(db: Db, userId: string) {
  const rows = await db.execute<{ id: string }>(sql`select other.account_id as id
    from ${conversationMembers} mine
    join ${conversations} c on c.id = mine.conversation_id and c.kind = 'direct'
    join ${conversationMembers} other on other.conversation_id = mine.conversation_id
      and other.account_id <> mine.account_id
    where mine.account_id = ${userId}::uuid`);
  return rows.map((r) => r.id);
}

/** Someone's devices changed: they and their direct-conversation partners hear it. */
export async function tellDevicesChanged(ctx: { db: Db; valkey: Redis }, userId: string) {
  const event = { type: "e2ee.devices" as const, data: { userId } };
  for (const id of new Set([userId, ...(await directPartners(ctx.db, userId))]))
    await publish(ctx.valkey, id, event);
}

/** A session signed out: its device key goes with it (kept as removed for old messages). */
export async function forgetSessionDevice(ctx: { db: Db; valkey: Redis }, sessionId: string) {
  const gone = await ctx.db
    .update(e2eeDevices)
    .set({ removedAt: new Date() })
    .where(and(eq(e2eeDevices.sessionId, sessionId), isNull(e2eeDevices.removedAt)))
    .returning({ accountId: e2eeDevices.accountId });
  for (const accountId of new Set(gone.map((g) => g.accountId))) await tellDevicesChanged(ctx, accountId);
}

/** Whether a sealed message's keys name exactly the active devices of these people, and its sender
 *  device is the sender's own; refused as docs/e2ee.md says otherwise. */
export async function checkSealed(db: Db, sealed: SealedMessage, sender: string, members: string[]) {
  const devices = await activeDevices(db, members);
  const mine = devices.get(sender) ?? [];
  if (!mine.some((d) => d.id === sealed.device))
    throw new HttpError(400, ErrorCode.badRequest, "sealed.device: one of your own active devices");
  const wanted = [...devices.values()].flat().map((d) => d.id);
  const given = Object.keys(sealed.keys);
  const exact =
    [...devices.values()].every((list) => list.length > 0) &&
    wanted.length === given.length &&
    wanted.every((id) => id in sealed.keys);
  if (!exact)
    throw new HttpError(409, ErrorCode.e2eeDevices, "The devices changed: seal it again", {
      devices: Object.fromEntries([...devices].map(([userId, list]) => [userId, list.map((d) => d.id)])),
    });
}

/** Whether every one of these people has an active device key. */
export async function allHaveDevices(db: Db, userIds: string[]) {
  const devices = await activeDevices(db, userIds);
  return [...devices.values()].every((list) => list.length > 0);
}

/** The signing key of a device of `userId`, active or removed, for checking a report. */
export async function deviceSignKey(db: Db, userId: string, deviceId: string) {
  const [row] = await db
    .select({ signKey: e2eeDevices.signKey })
    .from(e2eeDevices)
    .where(and(eq(e2eeDevices.accountId, userId), eq(e2eeDevices.id, deviceId)));
  return row?.signKey ?? null;
}

const Users = z
  .string()
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(z.string().uuid()).min(1).max(20));

/** Device keys: this session's, and the lists clients seal for. */
export function e2eeRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const { db } = deps;
  const who = people(db);
  for (const path of ["/me/e2ee/*", "/e2ee/*"]) app.use(path, requireUser(deps));

  app.get("/me/e2ee/device", async (c) => {
    const [row] = await db
      .select()
      .from(e2eeDevices)
      .where(
        and(
          eq(e2eeDevices.accountId, c.get("userId")),
          eq(e2eeDevices.sessionId, c.get("sessionId")),
          isNull(e2eeDevices.removedAt),
        ),
      );
    if (!row) throw new HttpError(404, ErrorCode.notFound, "This device has no keys here yet");
    return c.json(deviceView(row));
  });

  /** This session's keys. The same keys again (signed in anew on the same device) come back to
   *  this session; other keys of this session before are removed. */
  app.put("/me/e2ee/device", async (c) => {
    const me = c.get("userId");
    const session = c.get("sessionId");
    const input = await body(c, E2eeDeviceRegister);
    const id = deviceIdOf(fromBase64(input.signKey, 32));
    if (!verifyDevice(me, { id, signKey: input.signKey, boxKey: input.boxKey, sig: input.sig }))
      throw new HttpError(
        400,
        ErrorCode.badRequest,
        "sig: the device's signature over its key and your user ID",
      );
    const [existing] = await db
      .select()
      .from(e2eeDevices)
      .where(and(eq(e2eeDevices.accountId, me), eq(e2eeDevices.id, id)));
    if (existing && (existing.boxKey !== input.boxKey || existing.signKey !== input.signKey))
      throw new HttpError(409, ErrorCode.conflict, "That device ID has other keys");
    const unchanged =
      existing && existing.sessionId === session && !existing.removedAt && existing.name === input.name;
    if (unchanged) return c.json(deviceView(existing), 200);
    const active = (await activeDevices(db, [me])).get(me) ?? [];
    const others = active.filter((d) => d.id !== id && d.sessionId !== session);
    if (others.length >= maxE2eeDevices)
      throw new HttpError(409, ErrorCode.conflict, `At most ${maxE2eeDevices} devices`, {
        max: maxE2eeDevices,
      });
    const row = await db.transaction(async (tx) => {
      // One key per session: another one this session had before is removed.
      await tx
        .update(e2eeDevices)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(e2eeDevices.accountId, me),
            eq(e2eeDevices.sessionId, session),
            ne(e2eeDevices.id, id),
            isNull(e2eeDevices.removedAt),
          ),
        );
      const [saved] = await tx
        .insert(e2eeDevices)
        .values({ accountId: me, id, ...input, sessionId: session })
        .onConflictDoUpdate({
          target: [e2eeDevices.accountId, e2eeDevices.id],
          set: { sessionId: session, name: input.name, removedAt: null },
        })
        .returning();
      return saved as Device;
    });
    const wasActive = active.some((d) => d.id === id);
    if (!wasActive || active.some((d) => d.sessionId === session && d.id !== id))
      await tellDevicesChanged(deps, me);
    return c.json(deviceView(row), existing ? 200 : 201);
  });

  app.delete("/me/e2ee/devices/:id", async (c) => {
    const me = c.get("userId");
    const gone = await db
      .update(e2eeDevices)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(e2eeDevices.accountId, me),
          eq(e2eeDevices.id, c.req.param("id")),
          isNull(e2eeDevices.removedAt),
        ),
      )
      .returning();
    if (!gone.length) throw new HttpError(404, ErrorCode.notFound, "No such device");
    await tellDevicesChanged(deps, me);
    return c.body(null, 204);
  });

  /** Oneself, friends and direct-conversation partners; anyone else is left out. */
  app.get("/e2ee/devices", async (c) => {
    const me = c.get("userId");
    const asked = Users.safeParse(c.req.query("users") ?? "");
    if (!asked.success)
      throw new HttpError(400, ErrorCode.badRequest, "users: up to 20 user IDs, comma-separated");
    const ids = [...new Set(asked.data)];
    const others = ids.filter((id) => id !== me);
    const friends = await who.friendsAmong(me, others);
    const partners = new Set(await directPartners(db, me));
    const allowed = ids.filter((id) => id === me || friends.has(id) || partners.has(id));
    const rows = allowed.length
      ? await db
          .select()
          .from(e2eeDevices)
          .where(inArray(e2eeDevices.accountId, allowed))
          .orderBy(e2eeDevices.createdAt)
      : [];
    const active = await activeDevices(db, allowed);
    const view: E2eeDevicesView = {
      users: allowed.map((userId) => {
        const live = new Set((active.get(userId) ?? []).map((d) => d.id));
        const mine = rows.filter((r) => r.accountId === userId);
        // Someone else's devices go by their kind ("Windows PC"): the name an app registered is
        // often the computer's own, with its owner's name in it.
        const shown = (d: Device): E2eeDeviceView =>
          userId === me ? deviceView(d) : { ...deviceView(d), name: publicDeviceName(d.name) };
        return {
          userId,
          devices: mine.filter((d) => live.has(d.id)).map(shown),
          removed: mine
            .filter((d) => !live.has(d.id))
            .map((d) => ({ ...shown(d), removedAt: iso(d.removedAt ?? d.createdAt) })),
        };
      }),
    };
    return c.json(view);
  });

  return app;
}

/** Devices whose sessions ran out are removed too, so lists stay honest; run with the other
 *  periodic jobs. */
export async function sweepExpiredDevices(ctx: { db: Db; valkey: Redis }) {
  const gone = await ctx.db
    .update(e2eeDevices)
    .set({ removedAt: new Date() })
    .where(
      and(
        isNull(e2eeDevices.removedAt),
        sql`not exists (select 1 from ${sessions} where ${sessions.id} = ${e2eeDevices.sessionId}
          and ${sessions.revokedAt} is null and ${sessions.expiresAt} > now())`,
      ),
    )
    .returning({ accountId: e2eeDevices.accountId });
  for (const accountId of new Set(gone.map((g) => g.accountId))) await tellDevicesChanged(ctx, accountId);
  return gone.length;
}
