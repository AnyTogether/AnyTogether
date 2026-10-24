import { type Database, accounts, games, lfgPosts, lfgRequests } from "@anytogether/db";
import {
  ErrorCode,
  LanguageCode,
  LfgCreate,
  type LfgInvite,
  type LfgPurpose,
  type LfgRequestStatus,
  type LfgStatus,
  type LfgView,
  type Region,
  TitleId,
  lfgPageSize,
  lfgPurposes,
  maxLfgHours,
  maxOpenLfgPosts,
  maxPartySize,
} from "@anytogether/shared";
import { type SQL, and, asc, count, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { broadcast, publish, topicsFor } from "./events.js";
import { body } from "./http.js";
import { blockedLink } from "./links.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { Notifier } from "./notifications.js";
import type { PartyService } from "./parties.js";
import { blockedBetween, noBlockBetween, people } from "./people.js";
import { strangerLimiter } from "./ratelimit.js";
import type { SharePlayService } from "./sharePlays.js";

type Post = typeof lfgPosts.$inferSelect;
type Request = typeof lfgRequests.$inferSelect;

const hour = 3_600_000;
/** Clocks drift; a start a little in the past is still "now". */
const slack = 5 * 60_000;
/** Left out, a post goes this long after it starts. */
const defaultHours = 3;

const Id = z.string().uuid();

/** Closing a post (full, closed by its poster, expired, removed by a moderator): whoever still
 *  waits hears no, the poster's notification about them goes, and the board hears it. */
export function lfgService(deps: { db: Database; valkey: Redis }, notes: Notifier) {
  const { db, valkey } = deps;

  const changed = (post: Pick<Post, "id" | "titleId">, change: "opened" | "updated" | "closed") =>
    broadcast(valkey, topicsFor("lfg", post.titleId), {
      type: "lfg.changed",
      data: { postId: post.id, titleId: post.titleId, change },
    });

  /** Says no to everyone still waiting on the post. */
  async function declineWaiting(post: Post) {
    const waiting = await db
      .update(lfgRequests)
      .set({ status: "declined", answeredAt: new Date() })
      .where(and(eq(lfgRequests.postId, post.id), eq(lfgRequests.status, "pending")))
      .returning();
    for (const request of waiting)
      await publish(valkey, request.accountId, {
        type: "lfg.answered",
        data: { postId: post.id, answer: "declined", invite: null },
      });
    await notes.withdraw(post.authorId, "lfg_request", post.id);
  }

  /** Takes an open (or full) post off the board with a new status; false when it was not on it. */
  async function close(post: Post, status: Exclude<LfgStatus, "open">) {
    const [closed] = await db
      .update(lfgPosts)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(lfgPosts.id, post.id),
          inArray(
            lfgPosts.status,
            status === "removed" ? ["open", "full", "closed", "expired"] : ["open", "full"],
          ),
        ),
      )
      .returning();
    if (!closed) return false;
    await declineWaiting(closed);
    if (post.status === "open") await changed(closed, "closed");
    return true;
  }

  /** Posts whose time ran out; run every minute. Returns how many it closed. */
  async function sweep(now = Date.now()) {
    const due = await db
      .select()
      .from(lfgPosts)
      .where(and(eq(lfgPosts.status, "open"), lte(lfgPosts.expiresAt, new Date(now))))
      .limit(200);
    let closed = 0;
    for (const post of due) if (await close(post, "expired")) closed++;
    return closed;
  }

  return { changed, close, declineWaiting, sweep };
}

export type LfgService = ReturnType<typeof lfgService>;

/** The looking-for-group board: post what you want to play and when, browse and filter, "I'm in",
 *  and the poster's yes invites the player to their party or the share play they host. */
export function lfgRoutes(deps: Deps, notes: Notifier, parties: PartyService, shares: SharePlayService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const strangerLimit = strangerLimiter(deps);
  const service = lfgService(deps, notes);
  const { changed, close } = service;

  /** On the board: open, not run out, by an account in good standing. */
  const onBoard = () =>
    and(eq(lfgPosts.status, "open"), gt(lfgPosts.expiresAt, new Date()), eq(accounts.status, "active"));

  async function views(rows: Post[], me: string): Promise<LfgView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const titles = [...new Set(rows.map((r) => r.titleId))];
    const gameRows = await db.select().from(games).where(inArray(games.titleId, titles));
    const gameOf = new Map(gameRows.map((g) => [g.titleId, g]));
    const mineIds = rows.filter((r) => r.authorId === me).map((r) => r.id);
    const asked = await db
      .select()
      .from(lfgRequests)
      .where(
        and(
          inArray(lfgRequests.postId, ids),
          mineIds.length
            ? or(eq(lfgRequests.accountId, me), inArray(lfgRequests.postId, mineIds))
            : eq(lfgRequests.accountId, me),
        ),
      )
      .orderBy(asc(lfgRequests.createdAt));
    // The poster does not see people they have a block with among those asking.
    const blocked = await who.blockedAmong(
      me,
      asked.filter((r) => r.accountId !== me).map((r) => r.accountId),
    );
    const cards = await who.cards([...rows.map((r) => r.authorId), ...asked.map((r) => r.accountId)]);
    const inviteOf = (r: Request) => (r.invite as LfgInvite | null) ?? null;
    return rows.flatMap((post) => {
      const author = cards.get(post.authorId);
      if (!author) return [];
      const own = asked.find((r) => r.postId === post.id && r.accountId === me);
      const now = Date.now();
      const status: LfgStatus =
        post.status === "open" && post.expiresAt.getTime() <= now ? "expired" : (post.status as LfgStatus);
      return [
        {
          id: post.id,
          author,
          titleId: post.titleId,
          game: gameOf.has(post.titleId)
            ? {
                names: gameOf.get(post.titleId)?.names ?? {},
                iconUrl: gameOf.get(post.titleId)?.iconUrl ?? null,
              }
            : null,
          purpose: post.purpose as LfgPurpose,
          startsAt: post.startsAt?.toISOString() ?? null,
          languages: post.languages,
          region: (post.region as Region | null) ?? null,
          slots: post.slots,
          filled: post.filled,
          note: post.note,
          expiresAt: post.expiresAt.toISOString(),
          status,
          createdAt: post.createdAt.toISOString(),
          mine: post.authorId === me,
          myRequest: own ? { status: own.status as LfgRequestStatus, invite: inviteOf(own) } : null,
          ...(post.authorId === me
            ? {
                requests: asked
                  .filter((r) => r.postId === post.id && r.accountId !== me && !blocked.has(r.accountId))
                  .flatMap((r) => {
                    const user = cards.get(r.accountId);
                    return user
                      ? [
                          {
                            user,
                            status: r.status as LfgRequestStatus,
                            invite: inviteOf(r),
                            createdAt: r.createdAt.toISOString(),
                          },
                        ]
                      : [];
                  }),
              }
            : {}),
        },
      ];
    });
  }

  const view = async (post: Post, me: string) => (await views([post], me))[0] as LfgView;

  /** A post the asker may see: theirs, or anyone's they have no block with; a removed one only its
   *  poster sees. */
  const visible = async (id: string, me: string) => {
    const [row] = Id.safeParse(id).success
      ? await db
          .select({ post: lfgPosts, status: accounts.status })
          .from(lfgPosts)
          .innerJoin(accounts, eq(accounts.id, lfgPosts.authorId))
          .where(eq(lfgPosts.id, id))
      : [];
    if (row && row.post.authorId === me) return row.post;
    if (!row || row.status !== "active" || row.post.status === "removed")
      throw new HttpError(404, ErrorCode.notFound, "No such post");
    if (await blockedBetween(db, me, row.post.authorId))
      throw new HttpError(404, ErrorCode.notFound, "No such post");
    return row.post;
  };

  const asAuthor = async (id: string, me: string) => {
    const post = await visible(id, me);
    if (post.authorId !== me) throw new HttpError(403, ErrorCode.forbidden, "Only its poster can do that");
    return post;
  };

  const isOpen = (post: Post) => post.status === "open" && post.expiresAt.getTime() > Date.now();

  /** Open posts the asker may see, newest first. */
  async function openPosts(
    me: string,
    filter: {
      titleId?: string;
      purpose?: LfgPurpose;
      language?: string;
      now?: boolean;
      before?: string;
      limit?: number;
    },
  ) {
    const where: SQL[] = [onBoard() as SQL, noBlockBetween(me, lfgPosts.authorId)];
    if (filter.titleId) where.push(eq(lfgPosts.titleId, filter.titleId));
    if (filter.purpose) where.push(eq(lfgPosts.purpose, filter.purpose));
    if (filter.language) where.push(sql`${lfgPosts.languages} ? ${filter.language}`);
    // Now: no start time, or one within the next half hour.
    if (filter.now)
      where.push(
        or(
          sql`${lfgPosts.startsAt} is null`,
          lte(lfgPosts.startsAt, new Date(Date.now() + 30 * 60_000)),
        ) as SQL,
      );
    if (filter.before) where.push(lt(lfgPosts.id, filter.before));
    const limit = filter.limit ?? lfgPageSize;
    const rows = await db
      .select({ post: lfgPosts })
      .from(lfgPosts)
      .innerJoin(accounts, eq(accounts.id, lfgPosts.authorId))
      .where(and(...where))
      .orderBy(desc(lfgPosts.id))
      .limit(limit + 1);
    return {
      posts: await views(
        rows.slice(0, limit).map((r) => r.post),
        me,
      ),
      more: rows.length > limit,
    };
  }

  /** The board, newest first: by game, purpose, language, and now=1 for what starts within half an
   *  hour; `before` is the last post ID of the page before. */
  app.get("/lfg", async (c) => {
    const q = c.req.query();
    const bad = (what: string) => new HttpError(400, ErrorCode.badRequest, what);
    if (q.titleId !== undefined && !TitleId.safeParse(q.titleId).success)
      throw bad("titleId: a title ID like PPSA01234");
    if (q.purpose !== undefined && !lfgPurposes.includes(q.purpose as LfgPurpose))
      throw bad(`purpose: one of ${lfgPurposes.join(", ")}`);
    if (q.language !== undefined && !LanguageCode.safeParse(q.language).success)
      throw bad("language: a language like en or tr");
    if (q.before !== undefined && !Id.safeParse(q.before).success) throw bad("before: a post ID");
    const limit = Math.min(50, Math.max(1, Number(q.limit ?? lfgPageSize) || lfgPageSize));
    return c.json(
      await openPosts(c.get("userId"), {
        titleId: q.titleId,
        purpose: q.purpose as LfgPurpose | undefined,
        language: q.language,
        now: q.now === "1",
        before: q.before,
        limit,
      }),
    );
  });

  /** Games with open posts, the busiest first, for the board's game filter. */
  app.get("/lfg/games", async (c) => {
    const me = c.get("userId");
    const rows = await db
      .select({ titleId: lfgPosts.titleId, posts: count(), names: games.names, iconUrl: games.iconUrl })
      .from(lfgPosts)
      .innerJoin(accounts, eq(accounts.id, lfgPosts.authorId))
      .innerJoin(games, eq(games.titleId, lfgPosts.titleId))
      .where(and(onBoard(), noBlockBetween(me, lfgPosts.authorId)))
      .groupBy(lfgPosts.titleId, games.names, games.iconUrl)
      .orderBy(desc(count()), asc(lfgPosts.titleId))
      .limit(50);
    return c.json({ games: rows });
  });

  /** My posts of the last two days with who asked, and the posts I said "I'm in" to. */
  app.get("/me/lfg", async (c) => {
    const me = c.get("userId");
    const since = new Date(Date.now() - 2 * 24 * hour);
    const mine = await db
      .select()
      .from(lfgPosts)
      .where(
        and(eq(lfgPosts.authorId, me), gt(lfgPosts.createdAt, since), sql`${lfgPosts.status} <> 'removed'`),
      )
      .orderBy(desc(lfgPosts.id))
      .limit(20);
    const askedRows = await db
      .select({ post: lfgPosts })
      .from(lfgRequests)
      .innerJoin(lfgPosts, eq(lfgPosts.id, lfgRequests.postId))
      .innerJoin(accounts, eq(accounts.id, lfgPosts.authorId))
      .where(
        and(
          eq(lfgRequests.accountId, me),
          gt(lfgRequests.createdAt, since),
          eq(accounts.status, "active"),
          sql`${lfgPosts.status} <> 'removed'`,
          noBlockBetween(me, lfgPosts.authorId),
        ),
      )
      .orderBy(desc(lfgRequests.createdAt))
      .limit(30);
    return c.json({
      posts: await views(mine, me),
      asked: await views(
        askedRows.map((r) => r.post),
        me,
      ),
    });
  });

  app.post("/lfg", async (c) => {
    const me = c.get("userId");
    const input = await body(c, LfgCreate);
    const now = Date.now();
    const bad = (what: string) => new HttpError(400, ErrorCode.badRequest, what);
    const startsAt = input.startsAt ? Date.parse(input.startsAt) : null;
    if (startsAt !== null && (startsAt < now - slack || startsAt > now + maxLfgHours * hour))
      throw bad("startsAt: within the next 24 hours");
    const latest = now + maxLfgHours * hour;
    const expiresAt = input.expiresAt
      ? Date.parse(input.expiresAt)
      : Math.min(latest, (startsAt ?? now) + defaultHours * hour);
    if (expiresAt <= now || expiresAt > latest + 60_000) throw bad("expiresAt: within the next 24 hours");
    if (startsAt !== null && expiresAt < startsAt) throw bad("expiresAt: not before startsAt");
    const note = input.note || null;
    const domain = note ? blockedLink(note, deps.blockedLinkDomains ?? []) : null;
    if (domain)
      throw new HttpError(400, ErrorCode.linkBlocked, `Links to ${domain} are not allowed`, { domain });
    const [open] = await db
      .select({ n: count() })
      .from(lfgPosts)
      .where(and(eq(lfgPosts.authorId, me), eq(lfgPosts.status, "open"), gt(lfgPosts.expiresAt, new Date())));
    if ((open?.n ?? 0) >= maxOpenLfgPosts)
      throw new HttpError(409, ErrorCode.conflict, `At most ${maxOpenLfgPosts} open posts; close one first`);
    await strangerLimit("lfgPost", me);
    await db.insert(games).values({ titleId: input.titleId }).onConflictDoNothing();
    const [post] = (await db
      .insert(lfgPosts)
      .values({
        id: uuidv7(),
        authorId: me,
        titleId: input.titleId,
        purpose: input.purpose,
        startsAt: startsAt === null ? null : new Date(startsAt),
        languages: input.languages,
        region: input.region ?? null,
        slots: input.slots,
        note,
        expiresAt: new Date(expiresAt),
      })
      .returning()) as [Post];
    await changed(post, "opened");
    return c.json(await view(post, me), 201);
  });

  app.get("/lfg/:id", async (c) => {
    const me = c.get("userId");
    return c.json(await view(await visible(c.req.param("id"), me), me));
  });

  /** The poster closes the post. */
  app.delete("/lfg/:id", async (c) => {
    const me = c.get("userId");
    const post = await asAuthor(c.req.param("id"), me);
    await close(post, "closed");
    return c.body(null, 204);
  });

  /** "I'm in": the poster hears it and gets a notification; asking again changes nothing. */
  app.post("/lfg/:id/requests", async (c) => {
    const me = c.get("userId");
    const post = await visible(c.req.param("id"), me);
    if (post.authorId === me) throw new HttpError(400, ErrorCode.badRequest, "That is your own post");
    const [existing] = await db
      .select()
      .from(lfgRequests)
      .where(and(eq(lfgRequests.postId, post.id), eq(lfgRequests.accountId, me)));
    if (existing?.status === "declined")
      throw new HttpError(409, ErrorCode.conflict, "The poster said no to this one");
    if (existing) return c.json(await view(post, me));
    if (!isOpen(post))
      throw new HttpError(409, ErrorCode.conflict, "This post is closed", {
        postStatus: post.status === "open" ? "expired" : post.status,
      });
    await strangerLimit("joinRequest", me);
    const [made] = await db
      .insert(lfgRequests)
      .values({ postId: post.id, accountId: me })
      .onConflictDoNothing()
      .returning();
    if (made) {
      const from = await who.card(me);
      if (from)
        await publish(deps.valkey, post.authorId, {
          type: "lfg.request",
          data: { postId: post.id, titleId: post.titleId, from },
        });
      const [game] = await db.select().from(games).where(eq(games.titleId, post.titleId));
      await notes.notify(post.authorId, {
        kind: "lfg_request",
        actorId: me,
        subjectId: post.id,
        data: { postId: post.id, titleId: post.titleId, gameNames: game?.names ?? {}, purpose: post.purpose },
      });
    }
    return c.json(await view(post, me), made ? 201 : 200);
  });

  /** Takes back an "I'm in" the poster has not answered. */
  app.delete("/lfg/:id/requests/me", async (c) => {
    const me = c.get("userId");
    const post = await visible(c.req.param("id"), me);
    const removed = await db
      .delete(lfgRequests)
      .where(
        and(
          eq(lfgRequests.postId, post.id),
          eq(lfgRequests.accountId, me),
          eq(lfgRequests.status, "pending"),
        ),
      )
      .returning();
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "No such request");
    await publish(deps.valkey, post.authorId, {
      type: "lfg.request_cancelled",
      data: { postId: post.id, userId: me },
    });
    await settleIfAnswered(post);
    return c.body(null, 204);
  });

  /** Once nobody waits, the poster's notification about the post is read. */
  async function settleIfAnswered(post: Post) {
    const [waiting] = await db
      .select({ n: count() })
      .from(lfgRequests)
      .where(and(eq(lfgRequests.postId, post.id), eq(lfgRequests.status, "pending")));
    if (!waiting?.n) await notes.settle(post.authorId, "lfg_request", post.id);
  }

  /** Where a player the poster lets in goes: the share play the poster hosts for co-op, otherwise
   *  the poster's party if they lead it (a new one when they are in none; refused when someone
   *  else leads theirs). Invites are quiet: the player hears of
   *  them in the answer and its notification. */
  async function inviteFor(post: Post, userId: string): Promise<LfgInvite> {
    if (post.purpose === "coop") {
      const share = await shares.hostedBy(post.authorId);
      if (share) {
        await shares.inviteTo(share, [userId]);
        return { kind: "share_play", id: share.id };
      }
    }
    const current = await parties.partyOf(post.authorId);
    const party = current ?? (await parties.create(post.authorId, "invite"));
    const members = await parties.memberIds(party.id);
    // Only its leader brings strangers into a party (one with no leader left: its first member).
    if (current && (party.leaderId ?? members[0]) !== post.authorId)
      throw new HttpError(403, ErrorCode.notPartyLeader, "Only your party's leader can bring players in");
    if (!members.includes(userId)) {
      if (members.length >= maxPartySize)
        throw new HttpError(409, ErrorCode.full, `Your party has ${maxPartySize} people already`);
      await parties.inviteTo(party, post.authorId, [userId], { quiet: true });
      await parties.announce(party);
    }
    return { kind: "party", id: party.id };
  }

  /** The poster answers: yes invites the player and fills a slot (the last one closes the post),
   *  no tells them so. */
  app.post("/lfg/:id/requests/:userId/:answer{accept|decline}", async (c) => {
    const me = c.get("userId");
    const post = await asAuthor(c.req.param("id"), me);
    const userId = c.req.param("userId");
    const [request] = Id.safeParse(userId).success
      ? await db
          .select()
          .from(lfgRequests)
          .where(
            and(
              eq(lfgRequests.postId, post.id),
              eq(lfgRequests.accountId, userId),
              eq(lfgRequests.status, "pending"),
            ),
          )
      : [];
    if (!request) throw new HttpError(404, ErrorCode.notFound, "No such request");

    if (c.req.param("answer") === "decline" || (await blockedBetween(db, me, userId))) {
      await db
        .update(lfgRequests)
        .set({ status: "declined", answeredAt: new Date() })
        .where(and(eq(lfgRequests.postId, post.id), eq(lfgRequests.accountId, userId)));
      await publish(deps.valkey, userId, {
        type: "lfg.answered",
        data: { postId: post.id, answer: "declined", invite: null },
      });
      await settleIfAnswered(post);
      return c.json(await view(post, me));
    }

    if (!isOpen(post))
      throw new HttpError(409, ErrorCode.conflict, "This post is closed", {
        postStatus: post.status === "open" ? "expired" : post.status,
      });
    const invite = await inviteFor(post, userId);
    const updated = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(lfgPosts).where(eq(lfgPosts.id, post.id)).for("update");
      if (!locked || locked.status !== "open" || locked.filled >= locked.slots) return null;
      await tx
        .update(lfgRequests)
        .set({ status: "accepted", invite, answeredAt: new Date() })
        .where(and(eq(lfgRequests.postId, post.id), eq(lfgRequests.accountId, userId)));
      const filled = locked.filled + 1;
      const [next] = await tx
        .update(lfgPosts)
        .set({ filled, status: filled >= locked.slots ? "full" : "open", updatedAt: new Date() })
        .where(eq(lfgPosts.id, post.id))
        .returning();
      return next as Post;
    });
    if (!updated) throw new HttpError(409, ErrorCode.full, "Every slot is taken");
    await publish(deps.valkey, userId, {
      type: "lfg.answered",
      data: { postId: post.id, answer: "accepted", invite },
    });
    const [game] = await db.select().from(games).where(eq(games.titleId, post.titleId));
    await notes.notify(userId, {
      kind: "lfg_accepted",
      actorId: me,
      subjectId: post.id,
      data: {
        postId: post.id,
        titleId: post.titleId,
        gameNames: game?.names ?? {},
        purpose: post.purpose,
        invite,
      },
    });
    if (updated.status === "full") {
      // The last slot: everyone still waiting hears no, and the post leaves the board.
      await service.declineWaiting(updated);
      await changed(updated, "closed");
    } else {
      await changed(updated, "updated");
      await settleIfAnswered(updated);
    }
    return c.json(await view(updated, me));
  });

  return Object.assign(app, { openPosts, sweep: service.sweep });
}

export type LfgRoutes = ReturnType<typeof lfgRoutes>;
