import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
type User = Awaited<ReturnType<typeof h.user>>;
type Heard = { type: string; data: Record<string, unknown> }[];

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: Heard = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const of = (heard: Heard, type: string) => heard.filter((e) => e.type === type).map((e) => e.data);

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const direct = async (a: User, b: User) =>
  (await h.call("POST", `${v1}/conversations`, { members: [b.id] }, a.token)).body.id as string;
const group = async (a: User, members: User[]) =>
  (
    await h.call(
      "POST",
      `${v1}/conversations`,
      { members: members.map((m) => m.id), group: true, title: "Squad" },
      a.token,
    )
  ).body.id as string;
const send = (user: User, conversationId: string, text: string, extra: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/conversations/${conversationId}/messages`,
    { clientId: uuidv7(), text, ...extra },
    user.token,
  );
const react = (user: User, conversationId: string, seq: number, reaction: string, method = "PUT") =>
  h.call(
    method,
    `${v1}/conversations/${conversationId}/messages/${seq}/reactions/${reaction}`,
    undefined,
    user.token,
  );
const history = async (user: User, conversationId: string) =>
  (await h.call("GET", `${v1}/conversations/${conversationId}/messages`, undefined, user.token)).body
    .messages as Record<string, unknown>[];
const conversation = async (user: User, conversationId: string) =>
  (await h.call("GET", `${v1}/conversations/${conversationId}`, undefined, user.token)).body;
const unread = async (user: User) =>
  (await h.call("GET", `${v1}/me/conversations/unread`, undefined, user.token)).body;

describe("reactions", () => {
  it("are one of each per person, toggled, counted with who, and heard by every member", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const { body: message } = await send(utku, chat, "gg wp");
    const utkuHears = await listen(utku.id);

    const liked = await react(ayse, chat, message.seq, "like");
    expect(liked.status).toBe(200);
    expect(liked.body).toEqual({
      conversationId: chat,
      seq: message.seq,
      reactions: [{ reaction: "like", count: 1, userIds: [ayse.id] }],
    });
    // The same one again changes nothing; another one is added beside it.
    expect((await react(ayse, chat, message.seq, "like")).body.reactions).toHaveLength(1);
    await react(ayse, chat, message.seq, "gg");
    const both = await react(utku, chat, message.seq, "like");
    expect(both.body.reactions).toEqual([
      { reaction: "like", count: 2, userIds: [ayse.id, utku.id] },
      { reaction: "gg", count: 1, userIds: [ayse.id] },
    ]);
    await settle();
    expect(of(utkuHears.heard, "message.reactions").at(-1)).toEqual(both.body);
    utkuHears.stop();

    // The thread and the list carry them.
    expect((await history(utku, chat))[0]?.reactions).toEqual(both.body.reactions);
    const list = await h.call("GET", `${v1}/me/conversations`, undefined, ayse.token);
    expect(list.body.conversations[0].lastMessage.reactions).toEqual(both.body.reactions);

    // Taking one back.
    const off = await react(ayse, chat, message.seq, "like", "DELETE");
    expect(off.status).toBe(200);
    expect(off.body.reactions).toEqual([
      { reaction: "like", count: 1, userIds: [utku.id] },
      { reaction: "gg", count: 1, userIds: [ayse.id] },
    ]);
    expect((await react(ayse, chat, message.seq, "like", "DELETE")).status).toBe(200);
  });

  it("are refused for unknown names, missing or unsent messages, outsiders and after a block", async () => {
    const a = await h.user("ra@example.com");
    const b = await h.user("rb@example.com");
    const c = await h.user("rc@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(a, chat, "hi");
    expect((await react(b, chat, m.seq, "thumbsup")).status).toBe(400);
    expect((await react(b, chat, 99, "like")).status).toBe(404);
    expect((await react(c, chat, m.seq, "like")).status).toBe(404);
    expect((await react(c, chat, m.seq, "like", "DELETE")).status).toBe(404);

    await react(b, chat, m.seq, "love");
    // Unsent: the reactions go with the text, and nothing more can be added.
    const listening = await listen(b.id);
    expect(
      (await h.call("DELETE", `${v1}/conversations/${chat}/messages/${m.seq}`, undefined, a.token)).status,
    ).toBe(204);
    await settle();
    expect(of(listening.heard, "message.deleted")[0]).toMatchObject({
      seq: m.seq,
      reactions: [],
      text: null,
    });
    listening.stop();
    expect((await history(b, chat))[0]).toMatchObject({ reactions: [], deletedAt: expect.any(String) });
    expect((await react(b, chat, m.seq, "like")).status).toBe(404);

    const { body: m2 } = await send(a, chat, "still there?");
    await h.call("POST", `${v1}/me/blocks`, { userId: a.id }, b.token);
    expect((await react(b, chat, m2.seq, "like")).status).toBe(403);
    expect((await react(a, chat, m2.seq, "like")).status).toBe(403);
  });

  it("are writing: a muted account may not add one, but may take one back", async () => {
    const troll = await h.user("troll@example.com");
    const ayse = await h.user("ayse@example.com");
    const mod = await h.user("boss@example.com");
    await run(["grant", "@boss"], h.deps);
    await befriend(troll, ayse);
    const chat = await direct(troll, ayse);
    const { body: m } = await send(ayse, chat, "hey");
    await react(troll, chat, m.seq, "fire");
    await h.call("POST", `${v1}/admin/users/${troll.id}/mute`, { days: 1, publicReason: "Spam" }, mod.token);
    const refused = await react(troll, chat, m.seq, "laugh");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("account_muted");
    expect((await react(troll, chat, m.seq, "fire", "DELETE")).status).toBe(200);
  });

  it("follow a child's message rule", async () => {
    const mom = await h.user("mom@example.com");
    await h.call("POST", `${v1}/families`, { name: "Family" }, mom.token);
    const kid = await h.user("kid@example.com");
    const { body: code } = await h.call("POST", `${v1}/me/family/link-codes`, {}, mom.token);
    await h.call("POST", `${v1}/me/family/join`, { code: code.code, timeZone: "Europe/Istanbul" }, kid.token);
    const friend = await h.user("friend@example.com");
    await h.call(
      "PATCH",
      `${v1}/me/family/children/${kid.id}/restrictions`,
      { friendRequests: "everyone" },
      mom.token,
    );
    await befriend(kid, friend);
    const chat = await direct(kid, friend);
    const { body: m } = await send(friend, chat, "hi");
    expect((await react(kid, chat, m.seq, "like")).status).toBe(200);
    await h.call(
      "PATCH",
      `${v1}/me/family/children/${kid.id}/restrictions`,
      { messages: "nobody" },
      mom.token,
    );
    const refused = await react(kid, chat, m.seq, "love");
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "restricted_by_family", feature: "messages" });
    expect((await react(friend, chat, m.seq, "love")).body.code).toBe("restricted_by_family");
  });

  it("are rate limited with edits and unsends", async () => {
    await h.close();
    h = await harness({ limits: { messageChange: { max: 3, seconds: 60 } } });
    const a = await h.user("la@example.com");
    const b = await h.user("lb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(a, chat, "hi");
    await react(b, chat, m.seq, "like");
    await react(b, chat, m.seq, "love");
    await react(b, chat, m.seq, "wow");
    expect((await react(b, chat, m.seq, "sad")).status).toBe(429);
  });
});

describe("unsend", () => {
  it("is for the author only, at any time, and leaves a placeholder every member hears", async () => {
    const a = await h.user("ua@example.com");
    const b = await h.user("ub@example.com");
    const c = await h.user("uc@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(a, chat, "oops");
    const del = (user: User, seq: number) =>
      h.call("DELETE", `${v1}/conversations/${chat}/messages/${seq}`, undefined, user.token);
    expect((await del(b, m.seq)).status).toBe(403);
    expect((await del(c, m.seq)).status).toBe(404);
    // Long after the edit window: still the author's to take back.
    await h.deps.db.execute(
      sql`update messages set created_at = now() - interval '2 days' where id = ${m.id}`,
    );
    expect((await del(a, m.seq)).status).toBe(204);
    expect((await del(a, m.seq)).status).toBe(404);
    expect((await history(b, chat))[0]).toMatchObject({
      seq: m.seq,
      text: null,
      attachments: [],
      reactions: [],
      deletedAt: expect.any(String),
    });
  });

  it("takes an unread message out of the unread counts", async () => {
    const a = await h.user("na@example.com");
    const b = await h.user("nb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    await send(a, chat, "one");
    const { body: two } = await send(a, chat, "two");
    expect(await unread(b)).toEqual({ conversations: 1, messages: 2 });
    await h.call("DELETE", `${v1}/conversations/${chat}/messages/${two.seq}`, undefined, a.token);
    expect(await unread(b)).toEqual({ conversations: 1, messages: 1 });
    expect((await conversation(b, chat)).unread).toBe(1);
    const list = await h.call("GET", `${v1}/me/conversations`, undefined, b.token);
    expect(list.body.conversations[0].unread).toBe(1);
  });
});

describe("edits", () => {
  it("are counted and stop at twenty", async () => {
    const a = await h.user("ea@example.com");
    const b = await h.user("eb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(a, chat, "v0");
    expect(m.editCount).toBe(0);
    const edit = (n: number) =>
      h.call("PATCH", `${v1}/conversations/${chat}/messages/${m.seq}`, { text: `v${n}` }, a.token);
    for (let n = 1; n <= 20; n++) {
      const edited = await edit(n);
      expect(edited.status, `edit ${n}`).toBe(200);
      expect(edited.body).toMatchObject({ editCount: n, text: `v${n}`, editedAt: expect.any(String) });
    }
    const refused = await edit(21);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("edit_limit");
    expect((await history(b, chat))[0]).toMatchObject({ text: "v20", editCount: 20 });
  });
});

describe("delivered and read receipts", () => {
  it("in a direct chat: delivered on fetch or acknowledgement, read on opening, heard by the sender", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    const { body: m1 } = await send(utku, chat, "are you there?");
    expect((await conversation(utku, chat)).receipts).toEqual([
      { userId: ayse.id, readSeq: 0, deliveredSeq: 0 },
    ]);

    const utkuHears = await listen(utku.id);
    // Ayşe's launcher fetches the list: the message reached a device of hers.
    await h.call("GET", `${v1}/me/conversations`, undefined, ayse.token);
    await settle();
    expect(of(utkuHears.heard, "conversation.delivered")).toEqual([
      { conversationId: chat, userId: ayse.id, upToSeq: m1.seq },
    ]);
    expect((await conversation(utku, chat)).receipts[0]).toMatchObject({ deliveredSeq: m1.seq, readSeq: 0 });

    // Over the gateway: the device says so itself; saying it twice is quiet.
    const { body: m2 } = await send(utku, chat, "hello?");
    const ack = () =>
      h.call("POST", `${v1}/conversations/${chat}/delivered`, { upToSeq: m2.seq }, ayse.token);
    expect((await ack()).status).toBe(204);
    expect((await ack()).status).toBe(204);
    await settle();
    expect(of(utkuHears.heard, "conversation.delivered").map((d) => d.upToSeq)).toEqual([m1.seq, m2.seq]);

    // Opening it reads it; reading implies delivered.
    const { body: m3 } = await send(utku, chat, "ok");
    await h.call("POST", `${v1}/conversations/${chat}/read`, { upToSeq: m3.seq }, ayse.token);
    await settle();
    expect(of(utkuHears.heard, "conversation.read").at(-1)).toMatchObject({
      userId: ayse.id,
      upToSeq: m3.seq,
    });
    expect((await conversation(utku, chat)).receipts[0]).toEqual({
      userId: ayse.id,
      readSeq: m3.seq,
      deliveredSeq: m3.seq,
    });
    utkuHears.stop();

    // A fetch of the thread marks delivered too; and nobody outside can acknowledge.
    const { body: m4 } = await send(utku, chat, "later");
    await h.call("GET", `${v1}/conversations/${chat}/messages`, undefined, ayse.token);
    expect((await conversation(utku, chat)).receipts[0].deliveredSeq).toBe(m4.seq);
    const stranger = await h.user("x@example.com");
    expect(
      (await h.call("POST", `${v1}/conversations/${chat}/delivered`, { upToSeq: 1 }, stranger.token)).status,
    ).toBe(404);
  });

  it("are not told across a block", async () => {
    const a = await h.user("ba@example.com");
    const b = await h.user("bb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(a, chat, "hi");
    await h.call("POST", `${v1}/me/blocks`, { userId: a.id }, b.token);
    const aHears = await listen(a.id);
    await h.call("GET", `${v1}/conversations/${chat}/messages`, undefined, b.token);
    await h.call("POST", `${v1}/conversations/${chat}/read`, { upToSeq: m.seq }, b.token);
    await settle();
    expect(of(aHears.heard, "conversation.delivered")).toEqual([]);
    expect(of(aHears.heard, "conversation.read")).toEqual([]);
    aHears.stop();
    expect((await conversation(a, chat)).receipts).toEqual([
      { userId: b.id, readSeq: null, deliveredSeq: null },
    ]);
  });

  it("follow the read-receipts setting both ways, while one's own devices stay in step", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const chat = await direct(utku, ayse);
    expect((await h.call("GET", `${v1}/me`, undefined, ayse.token)).body.profile.readReceipts).toBe(true);

    const ayseHears = await listen(ayse.id);
    const off = await h.call("PATCH", `${v1}/me/read-receipts`, { readReceipts: false }, ayse.token);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ readReceipts: false });
    expect((await h.call("PATCH", `${v1}/me/read-receipts`, { readReceipts: "no" }, ayse.token)).status).toBe(
      400,
    );
    expect((await h.call("GET", `${v1}/me`, undefined, ayse.token)).body.profile.readReceipts).toBe(false);

    await send(utku, chat, "one");
    const { body: m2 } = await send(utku, chat, "two");
    const utkuHears = await listen(utku.id);
    await h.call("POST", `${v1}/conversations/${chat}/read`, { upToSeq: 1 }, ayse.token);
    await settle();
    // Utku does not learn it; Ayşe's other devices do, with what is left unread.
    expect(of(utkuHears.heard, "conversation.read")).toEqual([]);
    expect(of(utkuHears.heard, "conversation.delivered")).toEqual([
      { conversationId: chat, userId: ayse.id, upToSeq: 1 },
    ]);
    expect(of(ayseHears.heard, "messages.settings")).toEqual([{ readReceipts: false }]);
    expect(of(ayseHears.heard, "conversation.read")).toEqual([
      { conversationId: chat, userId: ayse.id, upToSeq: 1, unread: 1 },
    ]);
    // Delivered still shows (reading up to 1 delivered up to 1); reading does not, and Ayşe sees
    // no one's reading either.
    expect((await conversation(utku, chat)).receipts).toEqual([
      { userId: ayse.id, readSeq: null, deliveredSeq: 1 },
    ]);
    await h.call("GET", `${v1}/conversations/${chat}/messages`, undefined, ayse.token);
    expect((await conversation(utku, chat)).receipts[0].deliveredSeq).toBe(m2.seq);
    await h.call("POST", `${v1}/conversations/${chat}/read`, { upToSeq: m2.seq }, utku.token);
    expect((await conversation(ayse, chat)).receipts[0].readSeq).toBeNull();

    await h.call("PATCH", `${v1}/me/read-receipts`, { readReceipts: true }, ayse.token);
    expect((await conversation(utku, chat)).receipts[0].readSeq).toBe(1);
    ayseHears.stop();
    utkuHears.stop();
  });

  it("in a group: everyone's read marks for 'seen by', no delivered marks", async () => {
    const a = await h.user("ga@example.com");
    const b = await h.user("gb@example.com");
    const c = await h.user("gc@example.com");
    await befriend(a, b);
    await befriend(a, c);
    const squad = await group(a, [b, c]);
    const { body: m } = await send(a, squad, "tonight?");
    const aHears = await listen(a.id);
    await h.call("GET", `${v1}/conversations/${squad}/messages`, undefined, b.token);
    await h.call("POST", `${v1}/conversations/${squad}/read`, { upToSeq: m.seq }, b.token);
    await h.call("POST", `${v1}/conversations/${squad}/delivered`, { upToSeq: m.seq }, c.token);
    await settle();
    expect(of(aHears.heard, "conversation.delivered")).toEqual([]);
    expect(of(aHears.heard, "conversation.read")).toEqual([
      { conversationId: squad, userId: b.id, upToSeq: m.seq },
    ]);
    aHears.stop();
    const receipts = (await conversation(a, squad)).receipts as { userId: string }[];
    expect(receipts.sort((x, y) => x.userId.localeCompare(y.userId))).toEqual(
      [
        { userId: b.id, readSeq: m.seq, deliveredSeq: null },
        { userId: c.id, readSeq: 0, deliveredSeq: null },
      ].sort((x, y) => x.userId.localeCompare(y.userId)),
    );
  });
});

describe("unread counts", () => {
  it("leave out one's own messages and follow reading on any device", async () => {
    const a = await h.user("ca@example.com");
    const b = await h.user("cb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    await send(a, chat, "1");
    await send(a, chat, "2");
    await send(b, chat, "mine");
    // Writing reads everything before it.
    expect(await unread(b)).toEqual({ conversations: 0, messages: 0 });
    await send(a, chat, "3");
    expect((await conversation(b, chat)).unread).toBe(1);
    expect(await unread(a)).toEqual({ conversations: 0, messages: 0 });
  });
});

describe("pinned conversations", () => {
  it("come first, five at most, and the person's other devices hear it", async () => {
    const me = await h.user("pin@example.com");
    const friends: User[] = [];
    for (let i = 0; i < 6; i++) {
      const friend = await h.user(`p${i}@example.com`);
      await befriend(me, friend);
      friends.push(friend);
    }
    const chats: string[] = [];
    for (const friend of friends) {
      const chat = await direct(me, friend);
      await send(friend, chat, "hi");
      chats.push(chat);
    }
    const pin = (id: string, pinned = true, user = me) =>
      h.call("PUT", `${v1}/conversations/${id}/pin`, { pinned }, user.token);
    const hears = await listen(me.id);
    const pinned = await pin(chats[0] as string);
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({ id: chats[0], pinned: true });
    await settle();
    expect(of(hears.heard, "conversation.updated")).toEqual([{ conversationId: chats[0] }]);
    hears.stop();
    const list = await h.call("GET", `${v1}/me/conversations`, undefined, me.token);
    expect(list.body.conversations[0]).toMatchObject({ id: chats[0], pinned: true });
    expect(list.body.conversations[1].pinned).toBe(false);

    for (const id of chats.slice(1, 5)) expect((await pin(id)).status).toBe(200);
    const sixth = await pin(chats[5] as string);
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe("full");
    // Pinning one already pinned is fine; unpinning makes room.
    expect((await pin(chats[0] as string)).status).toBe(200);
    expect((await pin(chats[0] as string, false)).body.pinned).toBe(false);
    expect((await pin(chats[5] as string)).status).toBe(200);

    // Only the pinner's list changes; outsiders get nothing.
    expect((await conversation(friends[5] as User, chats[5] as string)).pinned).toBe(false);
    const stranger = await h.user("stranger@example.com");
    expect((await pin(chats[0] as string, true, stranger)).status).toBe(404);
  });

  it("muting tells the person's other devices too", async () => {
    const a = await h.user("ma@example.com");
    const b = await h.user("mb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const hears = await listen(a.id);
    const muted = await h.call("PUT", `${v1}/conversations/${chat}/mute`, { muted: true }, a.token);
    expect(muted.body.muted).toBe(true);
    await settle();
    expect(of(hears.heard, "conversation.updated")).toEqual([{ conversationId: chat }]);
    hears.stop();
  });
});

describe("the data export", () => {
  it("lists one's message reactions, edits and the read-receipts setting", async () => {
    const a = await h.user("xa@example.com");
    const b = await h.user("xb@example.com");
    await befriend(a, b);
    const chat = await direct(a, b);
    const { body: m } = await send(b, chat, "hi");
    await react(a, chat, m.seq, "gg");
    const { body: mine } = await send(a, chat, "typo");
    await h.call("PATCH", `${v1}/conversations/${chat}/messages/${mine.seq}`, { text: "fixed" }, a.token);
    await h.call("PATCH", `${v1}/me/read-receipts`, { readReceipts: false }, a.token);
    await h.call("PUT", `${v1}/conversations/${chat}/pin`, { pinned: true }, a.token);
    const exported = await h.call("GET", `${v1}/me/export`, undefined, a.token);
    expect(exported.status).toBe(200);
    const data = exported.body;
    expect(data.messageReactions).toEqual([
      { conversationId: chat, seq: m.seq, reaction: "gg", createdAt: expect.any(String) },
    ]);
    expect(data.messages.find((x: { seq: number }) => x.seq === mine.seq)).toMatchObject({
      text: "fixed",
      editCount: 1,
    });
    expect(data.conversations[0]).toMatchObject({ pinned: true, deliveredSeq: expect.any(Number) });
    expect(data.profile.readReceipts).toBe(false);
  });
});
