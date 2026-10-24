import { type Database, accounts, blocks, friendships, handleHistory, profiles } from "@anytogether/db";
import { handleHoldDays, isReservedHandle } from "@anytogether/shared";
import { and, eq, gt, ne, or } from "drizzle-orm";

type Querier = Pick<Database, "select">;
export type ProfileRow = typeof profiles.$inferSelect;

const heldSince = () => new Date(Date.now() - handleHoldDays * 86_400_000);

/** The profile behind a handle, current or given up in the last 30 days; only accounts in good
 *  standing (not banned, not being deleted) are found. */
export async function findProfile(db: Querier, raw: string): Promise<ProfileRow | undefined> {
  const handle = raw.replace(/^@/, "");
  const active = (where: ReturnType<typeof eq>) =>
    db
      .select({ profile: profiles })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(and(where, eq(accounts.status, "active")));
  const [current] = await active(eq(profiles.handle, handle));
  if (current) return current.profile;
  const [held] = await db
    .select({ accountId: handleHistory.accountId })
    .from(handleHistory)
    .where(and(eq(handleHistory.handle, handle), gt(handleHistory.releasedAt, heldSince())));
  if (!held) return undefined;
  return (await active(eq(profiles.accountId, held.accountId)))[0]?.profile;
}

/** Whether a handle may be taken by `accountId` (or by a new account): not reserved, not someone
 *  else's, and not held for its last owner. */
export async function handleFree(db: Querier, handle: string, accountId?: string) {
  if (isReservedHandle(handle)) return false;
  const owner = await db.select({ id: profiles.accountId }).from(profiles).where(eq(profiles.handle, handle));
  if (owner[0] && owner[0].id !== accountId) return false;
  const held = await db
    .select({ id: handleHistory.accountId })
    .from(handleHistory)
    .where(
      and(
        eq(handleHistory.handle, handle),
        gt(handleHistory.releasedAt, heldSince()),
        ...(accountId ? [ne(handleHistory.accountId, accountId)] : []),
      ),
    );
  return held.length === 0;
}

/** Either of the two blocked the other. */
export async function blockedBetween(db: Querier, a: string, b: string) {
  const rows = await db
    .select({ blocker: blocks.blocker })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blocker, a), eq(blocks.blocked, b)),
        and(eq(blocks.blocker, b), eq(blocks.blocked, a)),
      ),
    );
  return rows.length > 0;
}

export async function areFriends(db: Querier, a: string, b: string) {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const rows = await db
    .select({ state: friendships.state })
    .from(friendships)
    .where(
      and(eq(friendships.userA, userA), eq(friendships.userB, userB), eq(friendships.state, "accepted")),
    );
  return rows.length > 0;
}
