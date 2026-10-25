import { describe, expect, it, vi } from "vitest";
import {
  byPinnedThenUpdated,
  canEditMessage,
  hasReacted,
  reactionLabel,
  receiptOf,
  replyTarget,
  withEvent,
  withReactions,
} from "../lib/chat";
import { chatEn, chatTr } from "../lib/i18n-chat";
import type { Conversation, Message } from "../lib/social";

const me = "me";
const message = (seq: number, extra: Partial<Message> = {}): Message => ({
  id: `m${seq}`,
  conversationId: "c1",
  seq,
  authorId: me,
  text: `text ${seq}`,
  replyTo: null,
  editedAt: null,
  editCount: 0,
  reactions: [],
  deletedAt: null,
  createdAt: new Date(1_800_000_000_000).toISOString(),
  ...extra,
});
const conversation = (extra: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  kind: "direct",
  title: null,
  createdBy: me,
  members: [],
  lastSeq: 5,
  readSeq: 5,
  unread: 0,
  lastMessage: null,
  updatedAt: "2026-10-26T10:00:00.000Z",
  receipts: [{ userId: "ayse", readSeq: 2, deliveredSeq: 4 }],
  ...extra,
});

describe("receipts on one's own messages", () => {
  it("say sent, delivered or read in a direct chat", () => {
    const c = conversation();
    expect(receiptOf(c, message(2), me)).toEqual({ kind: "read" });
    expect(receiptOf(c, message(4), me)).toEqual({ kind: "delivered" });
    expect(receiptOf(c, message(5), me)).toEqual({ kind: "sent" });
    // Not for someone else's message or a removed one.
    expect(receiptOf(c, message(3, { authorId: "ayse" }), me)).toBeNull();
    expect(receiptOf(c, message(3, { deletedAt: "2026-10-26T10:00:00Z" }), me)).toBeNull();
    // Read receipts hidden: delivered is as far as it goes.
    const hidden = conversation({ receipts: [{ userId: "ayse", readSeq: null, deliveredSeq: 5 }] });
    expect(receiptOf(hidden, message(2), me)).toEqual({ kind: "delivered" });
    // An older API answer has no receipts at all.
    expect(receiptOf(conversation({ receipts: undefined }), message(2), me)).toBeNull();
  });

  it("count who has seen it in a group", () => {
    const c = conversation({
      kind: "group",
      receipts: [
        { userId: "a", readSeq: 7, deliveredSeq: null },
        { userId: "b", readSeq: 3, deliveredSeq: null },
        { userId: "c", readSeq: null, deliveredSeq: null },
      ],
    });
    expect(receiptOf(c, message(3), me)).toEqual({ kind: "seen", count: 2, everyone: false });
    expect(receiptOf(c, message(8), me)).toEqual({ kind: "seen", count: 0, everyone: false });
    const all = conversation({ kind: "group", receipts: [{ userId: "a", readSeq: 9, deliveredSeq: null }] });
    expect(receiptOf(all, message(3), me)).toEqual({ kind: "seen", count: 1, everyone: true });
  });
});

describe("gateway events", () => {
  it("move the others' read and delivered marks, never backwards", () => {
    const c = conversation();
    const read = withEvent(
      c,
      { type: "conversation.read", data: { conversationId: "c1", userId: "ayse", upToSeq: 5 } },
      me,
    );
    expect(read.receipts).toEqual([{ userId: "ayse", readSeq: 5, deliveredSeq: 5 }]);
    const back = withEvent(
      read,
      { type: "conversation.delivered", data: { conversationId: "c1", userId: "ayse", upToSeq: 3 } },
      me,
    );
    expect(back.receipts).toEqual(read.receipts);
    const other = withEvent(
      c,
      { type: "conversation.read", data: { conversationId: "c9", userId: "ayse", upToSeq: 5 } },
      me,
    );
    expect(other).toBe(c);
  });

  it("take one's own read mark and unread count from another device", () => {
    const c = conversation({ lastSeq: 9, readSeq: 2, unread: 6 });
    const read = withEvent(
      c,
      { type: "conversation.read", data: { conversationId: "c1", userId: me, upToSeq: 7, unread: 1 } },
      me,
    );
    expect(read).toMatchObject({ readSeq: 7, unread: 1 });
    // An older API answer without the count: everything up to the newest is read.
    const all = withEvent(
      c,
      { type: "conversation.read", data: { conversationId: "c1", userId: me, upToSeq: 9 } },
      me,
    );
    expect(all).toMatchObject({ readSeq: 9, unread: 0 });
  });
});

describe("reactions", () => {
  it("replace a message's reactions from the event and tell whether I reacted", () => {
    const m = message(3);
    const reactions = [{ reaction: "gg" as const, count: 2, userIds: ["ayse", me] }];
    const changed = withReactions(m, { conversationId: "c1", seq: 3, reactions });
    expect(changed.reactions).toEqual(reactions);
    expect(withReactions(m, { conversationId: "c1", seq: 4, reactions })).toBe(m);
    expect(hasReacted(changed, "gg", me)).toBe(true);
    expect(hasReacted(changed, "like", me)).toBe(false);
    expect(hasReacted(message(1, { reactions: undefined }), "like", me)).toBe(false);
  });

  it("are labelled with who reacted, in the reader's language", () => {
    const names = new Map([
      ["ayse", "Ayşe"],
      [me, "Utku"],
    ]);
    expect(reactionLabel(chatEn, { reaction: "love", count: 2, userIds: ["ayse", me] }, names)).toBe(
      "Love: Ayşe, Utku",
    );
    expect(reactionLabel(chatTr, { reaction: "love", count: 1, userIds: ["x"] }, names)).toBe("Sevgi: ?");
  });
});

describe("editing", () => {
  it("is for one's own text within the window and under the limit", () => {
    const now = Date.parse(message(1).createdAt) + 60_000;
    expect(canEditMessage(message(1), me, now)).toBe(true);
    expect(canEditMessage(message(1, { editCount: 20 }), me, now)).toBe(false);
    expect(canEditMessage(message(1), me, now + 15 * 60_000)).toBe(false);
    expect(canEditMessage(message(1, { authorId: "ayse" }), me, now)).toBe(false);
    expect(canEditMessage(message(1, { kind: "voice", caption: null }), me, now)).toBe(false);
    expect(canEditMessage(message(1, { kind: "image", caption: "hi" }), me, now)).toBe(true);
  });
});

describe("replies", () => {
  it("find the message replied to, or say it is not loaded or removed", () => {
    const thread = [
      message(1, { authorId: "ayse", text: "first" }),
      message(2, { deletedAt: "x", text: null }),
    ];
    expect(replyTarget(thread, 1)).toEqual({ authorId: "ayse", text: "first", removed: false, found: true });
    expect(replyTarget(thread, 2)).toMatchObject({ removed: true, found: true });
    expect(replyTarget(thread, 9)).toEqual({ authorId: null, text: null, removed: false, found: false });
    expect(replyTarget(thread, null)).toBeNull();
  });
});

describe("the list", () => {
  it("has pinned conversations first, then the newest", () => {
    const list = [
      conversation({ id: "old", updatedAt: "2026-10-01T00:00:00Z" }),
      conversation({ id: "pinned", pinned: true, updatedAt: "2026-09-01T00:00:00Z" }),
      conversation({ id: "new", updatedAt: "2026-10-20T00:00:00Z" }),
    ];
    expect(list.sort(byPinnedThenUpdated).map((c) => c.id)).toEqual(["pinned", "new", "old"]);
  });
});

describe("texts", () => {
  it("are all there in English and Turkish", () => {
    expect(Object.keys(chatTr).sort()).toEqual(Object.keys(chatEn).sort());
    for (const [key, text] of Object.entries(chatEn)) expect(text, key).not.toBe("");
    expect(chatTr.readReceipts).toBe("Okundu bilgisi gönder");
  });
});

describe("the read-receipts setting on the website", () => {
  it("passes the choice on to the API's PATCH /me/read-receipts", async () => {
    const relayBody = vi.fn(async () => Response.json({ readReceipts: false }));
    vi.doMock("@/lib/session", () => ({ relayBody }));
    const { PATCH } = await import("../app/me/read-receipts/route");
    const request = new Request("https://anytogether.test/me/read-receipts", {
      method: "PATCH",
      body: JSON.stringify({ readReceipts: false }),
    });
    const response = await PATCH(request);
    expect(relayBody).toHaveBeenCalledWith(request, "/me/read-receipts", "PATCH");
    expect(await response.json()).toEqual({ readReceipts: false });
  });

  it("lets the messages page reach reactions, delivered marks and pins, and nothing like them", async () => {
    const relay = vi.fn(async () => Response.json({}));
    vi.doMock("@/lib/session", () => ({ relay }));
    vi.doMock("@/lib/origin", () => ({ fromThisSite: () => true }));
    const route = await import("../app/me/social/[...path]/route");
    const id = "0198c0de-0000-7000-8000-000000000001";
    type Handler = (request: Request, context: unknown) => Promise<Response>;
    const call = (method: string, path: string) => {
      const handler = (route as unknown as Record<string, Handler>)[method] as Handler;
      return handler(
        new Request(`https://anytogether.test/me/social/${path}`, {
          method,
          ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
        }),
        { params: Promise.resolve({ path: path.split("/") }) },
      );
    };
    for (const [method, path] of [
      ["PUT", `conversations/${id}/messages/12/reactions/gg`],
      ["DELETE", `conversations/${id}/messages/12/reactions/love`],
      ["POST", `conversations/${id}/delivered`],
      ["PUT", `conversations/${id}/pin`],
    ] as const)
      expect((await call(method, path)).status, `${method} ${path}`).toBe(200);
    for (const [method, path] of [
      ["PUT", `conversations/${id}/messages/12/reactions/thumbsup`],
      ["POST", `conversations/${id}/messages/12/reactions/gg`],
      ["PUT", `conversations/${id}/pin/x`],
    ] as const)
      expect((await call(method, path)).status, `${method} ${path}`).toBe(404);
  });
});
