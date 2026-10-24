import { type Database, accounts, blocks, friendships, handleHistory, profiles } from "@anytogether/db";
import { type MemberView, type Visibility, handleHoldDays, isReservedHandle } from "@anytogether/shared";
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";

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

/** An account under a day old, or with fewer trophies than this, is new: it may post and ask to
 *  join strangers less often. */
export const newcomerHours = 24;
export const newcomerTrophies = 5;

export async function isNewcomer(db: Pick<Database, "execute">, userId: string) {
  const [row] = await db.execute<{ fresh: boolean; trophies: number }>(sql`
    select a.created_at > now() - make_interval(hours => ${newcomerHours}) fresh,
      coalesce((select sum(l.trophies_earned) from library l where l.account_id = a.id), 0)::int trophies
    from accounts a where a.id = ${userId}`);
  return !row || row.fresh || Number(row.trophies) < newcomerTrophies;
}

/** SQL: neither of the two blocked the other (`other` is a column or a value). */
export const noBlockBetween = (me: string, other: unknown) =>
  sql`not exists (select 1 from blocks b where (b.blocker = ${me}::uuid and b.blocked = ${other})
    or (b.blocker = ${other} and b.blocked = ${me}::uuid))`;

/** Who is looking, as privacy settings see it. */
export type Relation = "me" | "friend" | "other";

export async function relationOf(db: Querier, viewer: string, owner: string): Promise<Relation> {
  if (viewer === owner) return "me";
  return (await areFriends(db, viewer, owner)) ? "friend" : "other";
}

export const canSee = (visibility: Visibility, relation: Relation) =>
  relation === "me" || visibility === "everyone" || (visibility === "friends" && relation === "friend");

/** Who may reach whom, and how people are shown, for messages, parties, calls and game sessions. */
export function people(db: Database) {
  const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

  const blocked = (a: string, b: string) => blockedBetween(db, a, b);
  const friends = (a: string, b: string) => areFriends(db, a, b);

  /** Of `others`, the ones who are `me`'s friends (a block always ends a friendship). */
  const friendsAmong = async (me: string, others: string[]) => {
    if (!others.length) return new Set<string>();
    const rows = await db
      .select({ userA: friendships.userA, userB: friendships.userB })
      .from(friendships)
      .where(
        and(
          eq(friendships.state, "accepted"),
          or(
            and(eq(friendships.userA, me), inArray(friendships.userB, others)),
            and(eq(friendships.userB, me), inArray(friendships.userA, others)),
          ),
        ),
      );
    return new Set(rows.map((r) => (r.userA === me ? r.userB : r.userA)));
  };

  /** Of `others`, the ones with a block either way with `me`. */
  const blockedAmong = async (me: string, others: string[]) => {
    if (!others.length) return new Set<string>();
    const rows = await db
      .select({ blocker: blocks.blocker, blocked: blocks.blocked })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blocker, me), inArray(blocks.blocked, others)),
          and(eq(blocks.blocked, me), inArray(blocks.blocker, others)),
        ),
      );
    return new Set(rows.map((r) => (r.blocker === me ? r.blocked : r.blocker)));
  };

  /** Name cards by user ID, for the users that exist. */
  const cards = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await db.select().from(profiles).where(inArray(profiles.accountId, unique))
      : [];
    return new Map<string, MemberView>(
      rows.map((p) => [
        p.accountId,
        { userId: p.accountId, handle: p.handle, displayName: p.displayName, avatar: p.avatarUrl },
      ]),
    );
  };

  const card = async (id: string) => (await cards([id])).get(id) ?? null;

  return { pair, blocked, friends, friendsAmong, blockedAmong, cards, card };
}
