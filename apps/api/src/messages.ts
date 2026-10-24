import { conversationMembers, conversations, messages } from "@anytogether/db";
import {
  ConversationCreate,
  ConversationMembers,
  ConversationUpdate,
  type ConversationView,
  ErrorCode,
  type GatewayEvent,
  MessageEdit,
  MessageSend,
  type MessageView,
  ReadUpTo,
  conversationMembersKey,
  conversationMembersSeconds,
  editWindowMs,
  maxGroupMembers,
} from "@anytogether/shared";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import { blockedLink } from "./links.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { people } from "./people.js";
import { rateLimiter } from "./ratelimit.js";

type Conversation = typeof conversations.$inferSelect;
type Message = typeof messages.$inferSelect;

const Seq = z.coerce.number().int().min(0);
const iso = (date: Date | null) => (date ? date.toISOString() : null);

export const messageView = (m: Message): MessageView => ({
  id: m.id,
  conversationId: m.conversationId,
  seq: m.seq,
  authorId: m.authorId,
  text: m.deletedAt ? null : m.text,
  replyTo: m.replyTo,
  editedAt: iso(m.editedAt),
  deletedAt: iso(m.deletedAt),
  createdAt: m.createdAt.toISOString(),
});

/** Direct conversations between friends and groups made by a member: send, edit for 15 minutes,
 *  delete, read state and unread counts. Every change reaches the members' gateway channels. */
export function messageRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const who = people(db);
  const limit = rateLimiter(deps.valkey, deps.limits);

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

  /** Conversations as the list and the thread show them, for one member. */
  const views = async (rows: { conversation: Conversation; readSeq: number }[]) => {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.conversation.id);
    const members = await db
      .select({ conversationId: conversationMembers.conversationId, id: conversationMembers.accountId })
      .from(conversationMembers)
      .where(inArray(conversationMembers.conversationId, ids));
    const cards = await who.cards(members.map((m) => m.id));
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
    const lastBy = new Map(last.map((m) => [m.conversationId, m]));
    return rows.map(({ conversation: c, readSeq }): ConversationView => {
      const lastMessage = lastBy.get(c.id);
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
        unread: Math.max(0, c.lastSeq - readSeq),
        lastMessage: lastMessage ? messageView(lastMessage) : null,
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  };

  const viewOne = async (me: string, conversationId: string) => {
    const { conversation, member } = await membership(conversationId, me);
    const [view] = await views([{ conversation, readSeq: member.readSeq }]);
    return view as ConversationView;
  };

  /** Everyone added must be the adder's friend; strangers and blocked people are refused alike. */
  const mustBeFriends = async (me: string, userIds: string[]) => {
    const friends = await who.friendsAmong(me, userIds);
    if (userIds.some((id) => !friends.has(id)))
      throw new HttpError(403, ErrorCode.forbidden, "You can only message your friends");
  };

  app.get("/me/conversations", async (c) => {
    const me = c.get("userId");
    const before = c.req.query("before");
    const rows = await db
      .select({ conversation: conversations, readSeq: conversationMembers.readSeq })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(
          eq(conversationMembers.accountId, me),
          before && !Number.isNaN(Date.parse(before))
            ? lt(conversations.updatedAt, new Date(before))
            : undefined,
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    return c.json({ conversations: await views(rows) });
  });

  /** The header's badge: conversations with something unread, and how many messages. */
  app.get("/me/conversations/unread", async (c) => {
    const me = c.get("userId");
    const [row] = await db
      .select({
        conversations: sql<number>`count(*) filter (where ${conversations.lastSeq} > ${conversationMembers.readSeq})::int`,
        messages: sql<number>`coalesce(sum(greatest(${conversations.lastSeq} - ${conversationMembers.readSeq}, 0)), 0)::int`,
      })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversationMembers.accountId, me));
    return c.json({ conversations: row?.conversations ?? 0, messages: row?.messages ?? 0 });
  });

  app.post("/conversations", async (c) => {
    const me = c.get("userId");
    const input = await body(c, ConversationCreate);
    const others = input.members.filter((id) => id !== me);
    if (!others.length) throw new HttpError(400, ErrorCode.badRequest, "members: someone besides you");
    await mustBeFriends(me, others);

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
    const { userIds } = await body(c, ConversationMembers);
    const current = await memberIds(conversation.id);
    const added = [...new Set(userIds)].filter((id) => !current.includes(id));
    await mustBeFriends(me, added);
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
      return c.json({ messages: rows.slice(0, limit).map(messageView), more });
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
    return c.json({ messages: rows.slice(0, limit).reverse().map(messageView), more });
  });

  app.post("/conversations/:id/messages", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const input = await body(c, MessageSend);
    await limit("message", me);
    await limit("messageDay", me);
    allowedText(input.text);
    const members = await memberIds(conversation.id);
    await remember(conversation.id, members);
    if (conversation.kind === "direct") {
      const other = members.find((id) => id !== me);
      if (!other || !(await who.friends(me, other)))
        throw new HttpError(403, ErrorCode.forbidden, "You can only message your friends");
    }
    const resent = async () => {
      const [existing] = await db.select().from(messages).where(eq(messages.id, input.clientId));
      if (!existing || existing.authorId !== me || existing.conversationId !== conversation.id)
        throw new HttpError(409, ErrorCode.conflict, "That message ID is taken");
      return c.json(messageView(existing), 200);
    };
    if ((await db.select({ id: messages.id }).from(messages).where(eq(messages.id, input.clientId))).length)
      return resent();
    if (input.replyTo !== undefined && input.replyTo > conversation.lastSeq)
      throw new HttpError(400, ErrorCode.badRequest, "replyTo: no such message");

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
            text: input.text,
            replyTo: input.replyTo ?? null,
          })
          .onConflictDoNothing({ target: messages.id })
          .returning();
        // Sent twice at once: undo this seq and answer with the first.
        if (!message) throw new Resent();
        await tx
          .update(conversationMembers)
          .set({ readSeq: bumped.seq })
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
    const view = messageView(stored);
    await tell(members, { type: "message.created", data: view });
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
    const { conversation } = await membership(c.req.param("id"), me);
    const message = await own(conversation.id, me, c.req.param("seq"));
    const { text } = await body(c, MessageEdit);
    if (Date.now() - message.createdAt.getTime() > editWindowMs)
      throw new HttpError(403, ErrorCode.forbidden, "A message can be edited for 15 minutes");
    allowedText(text);
    const [updated] = await db
      .update(messages)
      .set({ text, editedAt: new Date() })
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.seq, message.seq)))
      .returning();
    const view = messageView(updated as Message);
    await tell(await memberIds(conversation.id), { type: "message.updated", data: view });
    return c.json(view);
  });

  app.delete("/conversations/:id/messages/:seq", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const message = await own(conversation.id, me, c.req.param("seq"));
    // Emptied at once: the text is gone, only the place in the thread stays.
    const [deleted] = await db
      .update(messages)
      .set({ text: null, attachments: [], deletedAt: new Date() })
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.seq, message.seq)))
      .returning();
    await tell(await memberIds(conversation.id), {
      type: "message.deleted",
      data: messageView(deleted as Message),
    });
    return c.body(null, 204);
  });

  app.post("/conversations/:id/read", async (c) => {
    const me = c.get("userId");
    const { conversation } = await membership(c.req.param("id"), me);
    const { upToSeq } = await body(c, ReadUpTo);
    const upTo = Math.min(upToSeq, conversation.lastSeq);
    const moved = await db
      .update(conversationMembers)
      .set({ readSeq: upTo })
      .where(
        and(
          eq(conversationMembers.conversationId, conversation.id),
          eq(conversationMembers.accountId, me),
          lt(conversationMembers.readSeq, upTo),
        ),
      )
      .returning();
    if (moved.length)
      await tell(await memberIds(conversation.id), {
        type: "conversation.read",
        data: { conversationId: conversation.id, userId: me, upToSeq: upTo },
      });
    return c.body(null, 204);
  });

  return app;
}

class Resent extends Error {}
