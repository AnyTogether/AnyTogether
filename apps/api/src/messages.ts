import { conversationMembers, conversations, messageReactions, messages, profiles } from "@anytogether/db";
import {
  type AttachmentView,
  ConversationCreate,
  ConversationMembers,
  ConversationUpdate,
  type ConversationView,
  DeliveredUpTo,
  ErrorCode,
  type GatewayEvent,
  type MediaKind,
  MessageEdit,
  type MessageReaction,
  MessageReactionName,
  MessageSend,
  type MessageView,
  MuteSet,
  PinSet,
  type ReactionView,
  ReadUpTo,
  type ReceiptView,
  conversationMembersKey,
  conversationMembersSeconds,
  editWindowMs,
  maxGroupMembers,
  maxMessageEdits,
  maxPinnedConversations,
  mediaFallbackText,
  messageReactions as reactionNames,
} from "@anytogether/shared";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import { blockedLink } from "./links.js";
import { mediaService } from "./media.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import type { Notifier } from "./notifications.js";
import { people } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

type Conversation = typeof conversations.$inferSelect;
type Message = typeof messages.$inferSelect;

const Seq = z.coerce.number().int().min(0);
const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Reactions rows gathered per reaction, in the fixed order. */
export const reactionViews = (rows: { reaction: string; accountId: string }[]): ReactionView[] => {
  const by = new Map<string, string[]>();
  for (const row of rows) by.set(row.reaction, [...(by.get(row.reaction) ?? []), row.accountId]);
  return reactionNames
    .filter((name) => by.has(name))
    .map((name) => {
      const userIds = by.get(name) as string[];
      return { reaction: name as MessageReaction, count: userIds.length, userIds };
    });
};

/** A message as clients see it; `attachments` are its media as resolved for the one who reads. */
export const messageView = (
  m: Message,
  attachments: AttachmentView[] = [],
  reactions: ReactionView[] = [],
): MessageView => {
  const kind = m.deletedAt ? undefined : (m.attachments as { kind: MediaKind }[])[0]?.kind;
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    authorId: m.authorId,
    kind: kind ?? "text",
    text: m.deletedAt ? null : (m.text ?? (kind ? mediaFallbackText[kind] : null)),
    caption: m.deletedAt || !kind ? null : m.text,
    attachments: m.deletedAt ? [] : attachments,
    replyTo: m.replyTo,
    editedAt: iso(m.editedAt),
    editCount: m.editCount ?? 0,
    reactions: m.deletedAt ? [] : reactions,
    deletedAt: iso(m.deletedAt),
    createdAt: m.createdAt.toISOString(),
  };
};

/** Direct conversations between friends and groups made by a member: send, reply, react, edit for
 *  15 minutes (at most 20 times), unsend (one's own messages, at any time), delivered and read
 *  marks, unread counts, mute and pin. Every change reaches the members' gateway channels. */
export function messageRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const limit = rateLimiter(deps.valkey, deps.limits);
  const family = familyGuard(db);
  const mediaOf = mediaService(deps);

  /** The reactions of these messages, by "conversationId:seq". */
  const reactionsOf = async (rows: Message[]) => {
    const live = rows.filter((m) => !m.deletedAt);
    const found = live.length
      ? await db
          .select()
          .from(messageReactions)
          .where(
            sql`(${messageReactions.conversationId}, ${messageReactions.seq}) in (${sql.join(
              live.map((m) => sql`(${m.conversationId}::uuid, ${m.seq}::bigint)`),
              sql`, `,
            )})`,
          )
          .orderBy(asc(messageReactions.createdAt))
      : [];
    const by = new Map<string, (typeof found)[number][]>();
    for (const row of found) {
      const key = `${row.conversationId}:${row.seq}`;
      by.set(key, [...(by.get(key) ?? []), row]);
    }
    return new Map([...by].map(([key, list]) => [key, reactionViews(list)]));
  };

  /** Messages as `viewer` sees them, their media resolved for them. */
  const viewsFor = async (viewer: string, rows: Message[]) => {
    const attached = await mediaOf.attachmentsFor(viewer, rows);
    const reacted = await reactionsOf(rows);
    return rows.map((m) => messageView(m, attached.get(m.id), reacted.get(`${m.conversationId}:${m.seq}`)));
  };
  const viewFor = async (viewer: string, m: Message) => (await viewsFor(viewer, [m]))[0] as MessageView;
  /** A message event to every member, each with the media as they may see it. */
  const tellMessage = async (userIds: string[], type: "message.created" | "message.updated", m: Message) => {
    for (const userId of new Set(userIds))
      await publish(deps.valkey, userId, { type, data: await viewFor(userId, m) } as GatewayEvent);
  };

  const memberIds = async (conversationId: string) =>
    (
      await db
        .select({ id: conversationMembers.accountId })
        .from(conversationMembers)
        .where(eq(conversationMembers.conversationId, conversationId))
    ).map((m) => m.id);

  const tell = async (userIds: string[], event: GatewayEvent) => {
    for (const userId of new Set(userIds)) await publish(deps.valkey, userId, event);
  };

  /** The members as the gateway checks them for typing; dropped when they change, kept again the
   *  next time someone reads or writes there. */
  const remember = async (conversationId: string, members: string[]) => {
    const key = conversationMembersKey(conversationId);
    const write = deps.valkey.multi().del(key);
    if (members.length) write.sadd(key, ...members).expire(key, conversationMembersSeconds);
    await write.exec();
  };
  const forget = (conversationId: string) => deps.valkey.del(conversationMembersKey(conversationId));

  /** A message may not link to a domain on the deny-list. */
  const allowedText = (text: string) => {
    const domain = blockedLink(text, deps.blockedLinkDomains ?? []);
    if (domain)
      throw new HttpError(400, ErrorCode.linkBlocked, `Links to ${domain} are not allowed`, { domain });
  };

  /** The conversation and the asker's place in it; someone outside it learns nothing. */
  const membership = async (conversationId: string, me: string) => {
    if (!z.string().uuid().safeParse(conversationId).success)
      throw new HttpError(404, ErrorCode.notFound, "No such conversation");
    const [row] = await db
      .select({ conversation: conversations, member: conversationMembers })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.accountId, me)),
      );
    if (!row) throw new HttpError(404, ErrorCode.notFound, "No such conversation");
    return row;
  };

  /** The others' messages after `readSeq` that are still there, per conversation, for one member. */
  const unreadOf = async (viewer: string, rows: { conversation: Conversation; readSeq: number }[]) => {
    const due = rows.filter((r) => r.conversation.lastSeq > r.readSeq).map((r) => r.conversation.id);
    if (!due.length) return new Map<string, number>();
    const counts = await db
      .select({ id: messages.conversationId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.accountId, viewer),
        ),
      )
      .where(
        and(
          inArray(messages.conversationId, due),
          gt(messages.seq, conversationMembers.readSeq),
          isNull(messages.deletedAt),
          sql`${messages.authorId} is distinct from ${viewer}::uuid`,
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(counts.map((c) => [c.id, c.n]));
  };
  const unreadIn = async (viewer: string, conversation: Conversation) => {
    const [member] = await db
      .select({ readSeq: conversationMembers.readSeq })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversation.id),
          eq(conversationMembers.accountId, viewer),
        ),
      );
    return (
      (await unreadOf(viewer, [{ conversation, readSeq: member?.readSeq ?? 0 }])).get(conversation.id) ?? 0
    );
  };

  /** Whose read receipts are on, of these people. */
  const receiptsOn = async (ids: string[]) => {
    if (!ids.length) return new Set<string>();
    const rows = await db
      .select({ id: profiles.accountId })
      .from(profiles)
      .where(and(inArray(profiles.accountId, ids), eq(profiles.readReceipts, true)));
    return new Set(rows.map((r) => r.id));
  };

  /** Conversations as the list and the thread show them, for one member. */
  const views = async (
    rows: { conversation: Conversation; readSeq: number; muted?: boolean; pinnedAt?: Date | null }[],
    viewer: string,
  ) => {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.conversation.id);
    const members = await db
      .select({
        conversationId: conversationMembers.conversationId,
        id: conversationMembers.accountId,
        readSeq: conversationMembers.readSeq,
        deliveredSeq: conversationMembers.deliveredSeq,
      })
      .from(conversationMembers)
      .where(inArray(conversationMembers.conversationId, ids));
    const cards = await who.cards(members.map((m) => m.id));
    const others = [...new Set(members.map((m) => m.id).filter((id) => id !== viewer))];
    const sharing = await receiptsOn([viewer, ...others]);
    const blocked = await who.blockedAmong(viewer, others);
    const directOthers = members
      .filter(
        (m) =>
          m.id !== viewer &&
          rows.some((r) => r.conversation.id === m.conversationId && r.conversation.kind === "direct"),
      )
      .map((m) => m.id);
    const friends = await who.friendsAmong(viewer, [...new Set(directOthers)]);
    const unread = await unreadOf(viewer, rows);
    const withLast = rows.filter((r) => r.conversation.lastSeq > 0);
    const last = withLast.length
      ? await db
          .select()
          .from(messages)
          .where(
            sql`(${messages.conversationId}, ${messages.seq}) in (${sql.join(
              withLast.map((r) => sql`(${r.conversation.id}::uuid, ${r.conversation.lastSeq}::bigint)`),
              sql`, `,
            )})`,
          )
      : [];
    const lastViews = new Map((await viewsFor(viewer, last)).map((v) => [v.conversationId, v]));
    return rows.map(({ conversation: c, readSeq, muted, pinnedAt }): ConversationView => {
      const lastMessage = lastViews.get(c.id);
      const direct = c.kind === "direct";
      const receipts = members
        .filter((m) => m.conversationId === c.id && m.id !== viewer)
        .map((m): ReceiptView => {
          const related = !blocked.has(m.id) && (!direct || friends.has(m.id));
          return {
            userId: m.id,
            readSeq: related && sharing.has(viewer) && sharing.has(m.id) ? m.readSeq : null,
            deliveredSeq: related && direct ? m.deliveredSeq : null,
          };
        });
      return {
        id: c.id,
        kind: c.kind as ConversationView["kind"],
        title: c.title,
        createdBy: c.createdBy,
        members: members
          .filter((m) => m.conversationId === c.id)
          .map((m) => cards.get(m.id))
          .filter((card) => card !== undefined),
        lastSeq: c.lastSeq,
        readSeq,
        unread: unread.get(c.id) ?? 0,
        lastMessage: lastMessage ?? null,
        updatedAt: c.updatedAt.toISOString(),
        communityId: c.communityId,
        muted: muted ?? false,
        pinned: Boolean(pinnedAt),
        receipts,
      };
    });
  };

  const viewOne = async (me: string, conversationId: string) => {
    const { conversation, member } = await membership(conversationId, me);
    const [view] = await views(
      [{ conversation, readSeq: member.readSeq, muted: member.muted, pinnedAt: member.pinnedAt }],
      me,
    );
    return view as ConversationView;
  };

  /** A community's chat follows the community: its title and members change there. */
  const managedByCommunity = (conversation: Conversation) => {
    if (conversation.communityId)
      throw new HttpError(409, ErrorCode.conflict, "This chat belongs to a community: change it there", {
        communityId: conversation.communityId,
      });
  };

  /** Everyone added must be the adder's friend; strangers and blocked people are refused alike. */
  const mustBeFriends = async (me: string, userIds: string[]) => {
    const friends = await who.friendsAmong(me, userIds);
    if (userIds.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only message your friends");
  };

  /** One of `me`'s devices got the messages up to `upTo`: kept, and in a direct conversation told
   *  to the other person (never across a block). */
  const delivered = async (conversation: Conversation, me: string, upTo: number) => {
    const seq = Math.min(upTo, conversation.lastSeq);
    const moved = await db
      .update(conversationMembers)
      .set({ deliveredSeq: seq })
      .where(
        and(
          eq(conversationMembers.conversationId, conversation.id),
          eq(conversationMembers.accountId, me),
          lt(conversationMembers.deliveredSeq, seq),
        ),
      )
      .returning({ id: conversationMembers.accountId });
    if (!moved.length || conversation.kind !== "direct") return;
    await tellDelivered(conversation, me, seq);
  };
  const tellDelivered = async (conversation: Conversation, me: string, seq: number) => {
    const other = (await memberIds(conversation.id)).find((id) => id !== me);
    if (other && (await who.friends(me, other)))
      await publish(deps.valkey, other, {
        type: "conversation.delivered",
        data: { conversationId: conversation.id, userId: me, upToSeq: seq },
      });
  };

  app.get("/me/conversations", async (c) => {
    const me = c.get("userId");
    const before = c.req.query("before");
    const rows = await db
      .select({
        conversation: conversations,
        readSeq: conversationMembers.readSeq,
        deliveredSeq: conversationMembers.deliveredSeq,
        muted: conversationMembers.muted,
        pinnedAt: conversationMembers.pinnedAt,
      })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(
          eq(conversationMembers.accountId, me),
          // Pinned ones lead the first page; later pages are the rest by time.
          before && !Number.isNaN(Date.parse(before))
            ? and(lt(conversations.updatedAt, new Date(before)), isNull(conversationMembers.pinnedAt))
            : undefined,
        ),
      )
      .orderBy(sql`${conversationMembers.pinnedAt} is null`, desc(conversations.updatedAt))
      .limit(50);
    // The list carries each one's newest message: it reached this device.
    for (const row of rows)
      if (row.conversation.lastSeq > row.deliveredSeq)
        await delivered(row.conversation, me, row.conversation.lastSeq);
    return c.json({ conversations: await views(rows, me) });
  });

  /** The header's badge: conversations with something unread, and how many messages. */
  app.get("/me/conversations/unread", async (c) => {
    const me = c.get("userId");
    // The others' messages after one's read mark that are still there; unsent ones do not count.
    const [row] = await db
      .select({
        conversations: sql<number>`count(distinct ${messages.conversationId})::int`,
        messages: sql<number>`count(*)::int`,
      })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .innerJoin(
        messages,
        and(
          eq(messages.conversationId, conversationMembers.conversationId),
          gt(messages.seq, conversationMembers.readSeq),
        ),
      )
      .where(
        and(
          eq(conversationMembers.accountId, me),
          gt(conversations.lastSeq, conversationMembers.readSeq),
          isNull(messages.deletedAt),
          sql`${messages.authorId} is distinct from ${me}::uuid`,
        ),
      );
    return c.json({ conversations: row?.conversations ?? 0, messages: row?.messages ?? 0 });
  });

  app.post("/conversations", async (c) => {
    const me = c.get("userId");
    await assertNotMuted(deps.db, me);
    const input = await body(c, ConversationCreate);
    const others = input.members.filter((id) => id !== me);
    if (!others.length) throw new HttpError(400, ErrorCode.badRequest, "members: someone besides you");
    await mustBeFriends(me, others);
    await family.mayMessage(me, others);

    if (others.length === 1 && !input.group && !input.title) {
      const other = others[0] as string;
      const directKey = who.pair(me, other).join(":");
      const [made] = await db
        .insert(conversations)
        .values({ id: uuidv7(), kind: "direct", directKey, createdBy: me })
        .onConflictDoNothing()
        .returning();
      const conversation =
        made ?? (await db.select().from(conversations).where(eq(conversations.directKey, directKey)))[0];
      if (!conversation) throw new HttpError(409, ErrorCode.conflict, "Try again");
      await db
        .insert(conversationMembers)
        .values([
          { conversationId: conversation.id, accountId: me },
          { conversationId: conversation.id, accountId: other },
        ])
        .onConflictDoNothing();
      return c.json(await viewOne(me, conversation.id), made ? 201 : 200);
    }

    const id = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(conversations).values({ id, kind: "group", title: input.title ?? null, createdBy: me });
      await tx
        .insert(conversationMembers)
        .values([me, ...others].map((accountId) => ({ conversationId: id, accountId })));
    });
    await tell(others, { type: "conversation.updated", data: { conversationId: id } });
    return c.json(await viewOne(me, id), 201);
  });

  app.get("/conversations/:id", async (c) => c.json(await viewOne(c.get("userId"), c.req.param("id"))));

  app.patch("/conversations/:id", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    if (conversation.kind !== "group")
      throw new HttpError(400, ErrorCode.badRequest, "Only a group has a title");
    managedByCommunity(conversation);
    const { title } = await body(c, ConversationUpdate);
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    await tell(await memberIds(conversation.id), {
      type: "conversation.updated",
      data: { conversationId: conversation.id },
    });
    return c.json(await viewOne(me, conversation.id));
  });

  app.post("/conversations/:id/members", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    if (conversation.kind !== "group")
      throw new HttpError(400, ErrorCode.badRequest, "Start a group to talk with more people");
    managedByCommunity(conversation);
    const { userIds } = await body(c, ConversationMembers);
    const current = await memberIds(conversation.id);
    const added = [...new Set(userIds)].filter((id) => !current.includes(id));
    await mustBeFriends(me, added);
    if (added.length) await family.mayMessage(me, [...current, ...added]);
    if (current.length + added.length > maxGroupMembers)
      throw new HttpError(409, ErrorCode.full, `A group has at most ${maxGroupMembers} people`);
    if (added.length) {
      await db
        .insert(conversationMembers)
        .values(
          added.map((accountId) => ({
            conversationId: conversation.id,
            accountId,
            readSeq: conversation.lastSeq,
          })),
        )
        .onConflictDoNothing();
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
      await forget(conversation.id);
      await tell([...current, ...added], {
        type: "conversation.updated",
        data: { conversationId: conversation.id },
      });
    }
    return c.json(await viewOne(me, conversation.id));
  });

  /** Leaving (yourself) or, for the group's creator, removing someone. */
  app.delete("/conversations/:id/members/:userId", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const target = c.req.param("userId");
    if (conversation.kind !== "group")
      throw new HttpError(400, ErrorCode.badRequest, "A direct conversation cannot be left");
    managedByCommunity(conversation);
    if (target !== me && conversation.createdBy !== me)
      throw new HttpError(403, ErrorCode.forbidden, "Only the group's creator can remove people");
    const removed = await db
      .delete(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversation.id),
          eq(conversationMembers.accountId, target),
        ),
      )
      .returning();
    if (!removed.length) throw new HttpError(404, ErrorCode.notFound, "Not in this conversation");
    const left = await memberIds(conversation.id);
    await forget(conversation.id);
    if (!left.length) await db.delete(conversations).where(eq(conversations.id, conversation.id));
    await tell(left, { type: "conversation.updated", data: { conversationId: conversation.id } });
    await tell([target], {
      type: "conversation.updated",
      data: { conversationId: conversation.id, removed: true },
    });
    return c.body(null, 204);
  });

  /** History by sequence: the newest page by default, older with `before`, newer with `after`. */
  app.get("/conversations/:id/messages", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    await remember(conversation.id, await memberIds(conversation.id));
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    const after = c.req.query("after");
    const before = c.req.query("before");
    const where = eq(messages.conversationId, conversation.id);
    let rows: Message[];
    if (after !== undefined) {
      const seq = Seq.safeParse(after);
      if (!seq.success) throw new HttpError(400, ErrorCode.badRequest, "after: a message seq");
      rows = await db
        .select()
        .from(messages)
        .where(and(where, gt(messages.seq, seq.data)))
        .orderBy(asc(messages.seq))
        .limit(limit + 1);
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      const newest = page.at(-1);
      if (newest) await delivered(conversation, me, newest.seq);
      return c.json({ messages: await viewsFor(me, page), more });
    }
    const seq = before === undefined ? undefined : Seq.safeParse(before);
    if (seq && !seq.success) throw new HttpError(400, ErrorCode.badRequest, "before: a message seq");
    rows = await db
      .select()
      .from(messages)
      .where(and(where, seq ? lt(messages.seq, seq.data) : undefined))
      .orderBy(desc(messages.seq))
      .limit(limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const newest = page.at(-1);
    if (newest) await delivered(conversation, me, newest.seq);
    return c.json({ messages: await viewsFor(me, page), more });
  });

  app.post("/conversations/:id/messages", async (c) => {
    const me = c.get("userId");
    await assertNotMuted(deps.db, me);
    const { conversation } = await membership(c.req.param("id"), me);
    const input = await body(c, MessageSend);
    await limit("message", me);
    await limit("messageDay", me);
    if (input.text) allowedText(input.text);
    const members = await memberIds(conversation.id);
    await remember(conversation.id, members);
    if (conversation.kind === "direct") {
      const other = members.find((id) => id !== me);
      if (!other || !(await who.friends(me, other)))
        throw new HttpError(403, ErrorCode.forbidden, "You can only message your friends");
    }
    await family.mayMessage(me, members);
    const resent = async () => {
      const [existing] = await db.select().from(messages).where(eq(messages.id, input.clientId));
      if (!existing || existing.authorId !== me || existing.conversationId !== conversation.id)
        throw new HttpError(409, ErrorCode.conflict, "That message ID is taken");
      return c.json(await viewFor(me, existing), 200);
    };
    if ((await db.select({ id: messages.id }).from(messages).where(eq(messages.id, input.clientId))).length)
      return resent();
    if (input.replyTo !== undefined && input.replyTo > conversation.lastSeq)
      throw new HttpError(400, ErrorCode.badRequest, "replyTo: no such message");
    // Media: the sender's own, uploaded first; one piece per message, with the text as its caption.
    const attached = await mediaOf.attachable(
      me,
      (input.attachments ?? []).map((a) => a.mediaId),
    );
    const attachments = attached.map((m) => ({ mediaId: m.id, kind: m.kind as MediaKind }));

    const stored = await db
      .transaction(async (tx) => {
        const [bumped] = await tx
          .update(conversations)
          .set({ lastSeq: sql`${conversations.lastSeq} + 1`, updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id))
          .returning({ seq: conversations.lastSeq });
        if (!bumped) throw new HttpError(404, ErrorCode.notFound, "No such conversation");
        const [message] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            seq: bumped.seq,
            id: input.clientId,
            authorId: me,
            text: input.text || null,
            attachments,
            replyTo: input.replyTo ?? null,
          })
          .onConflictDoNothing({ target: messages.id })
          .returning();
        // Sent twice at once: undo this seq and answer with the first.
        if (!message) throw new Resent();
        await tx
          .update(conversationMembers)
          .set({ readSeq: bumped.seq, deliveredSeq: bumped.seq })
          .where(
            and(
              eq(conversationMembers.conversationId, conversation.id),
              eq(conversationMembers.accountId, me),
            ),
          );
        return message;
      })
      .catch((error) => {
        if (error instanceof Resent) return null;
        throw error;
      });
    if (!stored) return resent();
    const view = await viewFor(me, stored);
    await tellMessage(members, "message.created", stored);
    const said = view.text ?? "";
    // Writing in it means reading it; the others, unless they muted it, get a notification while
    // none of their devices is connected.
    await notes.settle(me, "message", conversation.id);
    const muted = new Set(
      (
        await db
          .select({ id: conversationMembers.accountId })
          .from(conversationMembers)
          .where(
            and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.muted, true)),
          )
      ).map((m) => m.id),
    );
    for (const member of members)
      if (member !== me && !muted.has(member))
        await notes.notify(member, {
          kind: "message",
          actorId: me,
          subjectId: conversation.id,
          data: {
            conversationId: conversation.id,
            title: conversation.title,
            group: conversation.kind === "group",
            text: said.length > 140 ? `${said.slice(0, 139)}…` : said,
          },
        });
    return c.json(view, 201);
  });

  /** The author's own message, not deleted. */
  const own = async (conversationId: string, me: string, rawSeq: string) => {
    const seq = Seq.safeParse(rawSeq);
    if (!seq.success) throw new HttpError(404, ErrorCode.notFound, "No such message");
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.seq, seq.data)));
    if (!message || message.deletedAt) throw new HttpError(404, ErrorCode.notFound, "No such message");
    if (message.authorId !== me) throw new HttpError(403, ErrorCode.forbidden, "Not your message");
    return message;
  };

  app.patch("/conversations/:id/messages/:seq", async (c) => {
    const me = c.get("userId");
    await assertNotMuted(deps.db, me);
    const { conversation } = await membership(c.req.param("id"), me);
    const message = await own(conversation.id, me, c.req.param("seq"));
    const { text } = await body(c, MessageEdit);
    await limit("messageChange", me);
    if (Date.now() - message.createdAt.getTime() > editWindowMs)
      throw new HttpError(403, ErrorCode.forbidden, "A message can be edited for 15 minutes");
    const tooMany = () =>
      new HttpError(409, ErrorCode.editLimit, `A message can be edited ${maxMessageEdits} times`, {
        max: maxMessageEdits,
      });
    if (message.editCount >= maxMessageEdits) throw tooMany();
    allowedText(text);
    const [updated] = await db
      .update(messages)
      .set({ text, editedAt: new Date(), editCount: sql`${messages.editCount} + 1` })
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          eq(messages.seq, message.seq),
          isNull(messages.deletedAt),
          lt(messages.editCount, maxMessageEdits),
        ),
      )
      .returning();
    if (!updated) throw tooMany();
    await tellMessage(await memberIds(conversation.id), "message.updated", updated as Message);
    return c.json(await viewFor(me, updated as Message));
  });

  app.delete("/conversations/:id/messages/:seq", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const message = await own(conversation.id, me, c.req.param("seq"));
    await limit("messageChange", me);
    // Unsent, at any time: emptied at once (text, media, reactions), only its place stays.
    const [deleted] = await db
      .update(messages)
      .set({ text: null, attachments: [], deletedAt: new Date() })
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.seq, message.seq)))
      .returning();
    await db
      .delete(messageReactions)
      .where(
        and(eq(messageReactions.conversationId, conversation.id), eq(messageReactions.seq, message.seq)),
      );
    await tell(await memberIds(conversation.id), {
      type: "message.deleted",
      data: messageView(deleted as Message),
    });
    // Its media goes with it, unless it is pinned or in another message.
    await mediaOf.releaseFrom(message);
    return c.body(null, 204);
  });

  /** A message still there (not unsent), by its seq. */
  const live = async (conversationId: string, rawSeq: string) => {
    const seq = Seq.safeParse(rawSeq);
    if (!seq.success) throw new HttpError(404, ErrorCode.notFound, "No such message");
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.seq, seq.data)));
    if (!message || message.deletedAt) throw new HttpError(404, ErrorCode.notFound, "No such message");
    return message;
  };
  const reactionName = (raw: string) => {
    const name = MessageReactionName.safeParse(raw);
    if (!name.success)
      throw new HttpError(400, ErrorCode.badRequest, `reaction: one of ${reactionNames.join(", ")}`);
    return name.data;
  };
  /** A message's reactions now, told to every member when they changed. */
  const reactionsChanged = async (conversationId: string, seq: number, changed: boolean) => {
    const rows = await db
      .select({ reaction: messageReactions.reaction, accountId: messageReactions.accountId })
      .from(messageReactions)
      .where(and(eq(messageReactions.conversationId, conversationId), eq(messageReactions.seq, seq)))
      .orderBy(asc(messageReactions.createdAt));
    const data = { conversationId, seq, reactions: reactionViews(rows) };
    if (changed) await tell(await memberIds(conversationId), { type: "message.reactions", data });
    return data;
  };

  /** A reaction is writing: refused while muted, across a block, or where a child's family rules
   *  do not allow messages. */
  app.put("/conversations/:id/messages/:seq/reactions/:reaction", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const reaction = reactionName(c.req.param("reaction"));
    await assertNotMuted(deps.db, me);
    const message = await live(conversation.id, c.req.param("seq"));
    await limit("messageChange", me);
    const members = await memberIds(conversation.id);
    if (conversation.kind === "direct") {
      const other = members.find((id) => id !== me);
      if (!other || !(await who.friends(me, other)))
        throw new HttpError(403, ErrorCode.forbidden, "You can only message your friends");
    }
    await family.mayMessage(me, members);
    const added = await db
      .insert(messageReactions)
      .values({ conversationId: conversation.id, seq: message.seq, accountId: me, reaction })
      .onConflictDoNothing()
      .returning();
    return c.json(await reactionsChanged(conversation.id, message.seq, added.length > 0));
  });

  /** Taking one's reaction back is always allowed. */
  app.delete("/conversations/:id/messages/:seq/reactions/:reaction", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const reaction = reactionName(c.req.param("reaction"));
    const message = await live(conversation.id, c.req.param("seq"));
    await limit("messageChange", me);
    const removed = await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.conversationId, conversation.id),
          eq(messageReactions.seq, message.seq),
          eq(messageReactions.accountId, me),
          eq(messageReactions.reaction, reaction),
        ),
      )
      .returning();
    return c.json(await reactionsChanged(conversation.id, message.seq, removed.length > 0));
  });

  /** A device got messages over the gateway; fetching them says so by itself. */
  app.post("/conversations/:id/delivered", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const { upToSeq } = await body(c, DeliveredUpTo);
    await delivered(conversation, me, upToSeq);
    return c.body(null, 204);
  });

  /** Pinned to the top of one's own list, at most five. */
  app.put("/conversations/:id/pin", async (c) => {
    const me = c.get("userId");
    const { conversation, member } = await membership(c.req.param("id"), me);
    const { pinned } = await body(c, PinSet);
    if (pinned && !member.pinnedAt) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.accountId, me), isNotNull(conversationMembers.pinnedAt)));
      if ((row?.n ?? 0) >= maxPinnedConversations)
        throw new HttpError(409, ErrorCode.full, `At most ${maxPinnedConversations} pinned conversations`, {
          max: maxPinnedConversations,
        });
    }
    if (pinned !== Boolean(member.pinnedAt))
      await db
        .update(conversationMembers)
        .set({ pinnedAt: pinned ? new Date() : null })
        .where(
          and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.accountId, me)),
        );
    await tell([me], { type: "conversation.updated", data: { conversationId: conversation.id } });
    return c.json(await viewOne(me, conversation.id));
  });

  /** Muted: no notifications for it (unread counts still show). A community's chat starts muted. */
  app.put("/conversations/:id/mute", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const { muted } = await body(c, MuteSet);
    await db
      .update(conversationMembers)
      .set({ muted })
      .where(
        and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.accountId, me)),
      );
    if (muted) await notes.settle(me, "message", conversation.id);
    // The person's other devices follow.
    await tell([me], { type: "conversation.updated", data: { conversationId: conversation.id } });
    return c.json(await viewOne(me, conversation.id));
  });

  app.post("/conversations/:id/read", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const { upToSeq } = await body(c, ReadUpTo);
    const upTo = Math.min(upToSeq, conversation.lastSeq);
    const [before] = await db
      .select({ deliveredSeq: conversationMembers.deliveredSeq })
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.accountId, me)),
      );
    // Read means delivered too.
    const moved = await db
      .update(conversationMembers)
      .set({ readSeq: upTo, deliveredSeq: sql`greatest(${conversationMembers.deliveredSeq}, ${upTo})` })
      .where(
        and(
          eq(conversationMembers.conversationId, conversation.id),
          eq(conversationMembers.accountId, me),
          lt(conversationMembers.readSeq, upTo),
        ),
      )
      .returning();
    if (moved.length) {
      const data = { conversationId: conversation.id, userId: me, upToSeq: upTo };
      // One's own devices hear it with what is left unread; the others only while both share read
      // receipts and neither blocked the other.
      await tell([me], {
        type: "conversation.read",
        data: { ...data, unread: await unreadIn(me, conversation) },
      });
      const others = (await memberIds(conversation.id)).filter((id) => id !== me);
      const sharing = await receiptsOn([me, ...others]);
      const blocked = await who.blockedAmong(me, others);
      const friends = conversation.kind === "direct" ? await who.friendsAmong(me, others) : null;
      const told = others.filter(
        (id) => sharing.has(me) && sharing.has(id) && !blocked.has(id) && (!friends || friends.has(id)),
      );
      await tell(told, { type: "conversation.read", data });
      // Read receipts off: the sender still learns it was delivered.
      if (conversation.kind === "direct" && !told.length && (before?.deliveredSeq ?? 0) < upTo)
        await tellDelivered(conversation, me, upTo);
    }
    if (upTo >= conversation.lastSeq) await notes.settle(me, "message", conversation.id);
    return c.body(null, 204);
  });

  return app;
}

class Resent extends Error {}
