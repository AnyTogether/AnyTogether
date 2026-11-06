import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return {
    heard,
    of: (type: string) => heard.filter((e) => e.type === type),
    stop: () => events.disconnect(),
  };
}
const say = (user: User, chatId: string, text: string, extra: Record<string, unknown> = {}) =>
  h.call(
    "POST",
    `${v1}/conversations/${chatId}/messages`,
    { clientId: crypto.randomUUID(), text, ...extra },
    user.token,
  );

/** A party led by `leader` with `others` in it, all friends of the leader. */
async function party(leader: User, ...others: User[]) {
  const made = await h.call("POST", `${v1}/parties`, {}, leader.token);
  const id = made.body.id as string;
  for (const other of others) {
    await befriend(leader, other);
    await h.call("POST", `${v1}/parties/${id}/invites`, { userIds: [other.id] }, leader.token);
    await h.call("POST", `${v1}/parties/${id}/join`, {}, other.token);
  }
  return { id, chatId: made.body.conversationId as string };
}

describe("party chat", () => {
  it("comes with the party, and its members talk there with replies and reactions", async () => {
    const ana = await h.user("ana@example.com");
    const ben = await h.user("ben@example.com");
    const { id, chatId } = await party(ana, ben);
    expect(chatId).toBeTruthy();
    const seen = await h.call("GET", `${v1}/parties/${id}`, undefined, ben.token);
    expect(seen.body.conversationId).toBe(chatId);

    const chat = await h.call("GET", `${v1}/conversations/${chatId}`, undefined, ben.token);
    expect(chat.body).toMatchObject({ kind: "group", partyId: id, muted: true });
    expect(chat.body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [ana.id, ben.id].sort(),
    );

    const benHears = await listen(ben.id);
    const first = await say(ana, chatId, "Ready?");
    expect(first.status).toBe(201);
    await settle();
    expect(benHears.of("message.created")[0]?.data).toMatchObject({ conversationId: chatId, text: "Ready?" });
    benHears.stop();

    const reply = await say(ben, chatId, "Yes", { replyTo: first.body.seq });
    expect(reply.body).toMatchObject({ replyTo: first.body.seq });
    const reacted = await h.call(
      "PUT",
      `${v1}/conversations/${chatId}/messages/${first.body.seq}/reactions/gg`,
      undefined,
      ben.token,
    );
    expect(reacted.body.reactions).toEqual([{ reaction: "gg", count: 1, userIds: [ben.id] }]);
  });

  it("stays out of the conversation list and the unread badge", async () => {
    const ana = await h.user("ana2@example.com");
    const ben = await h.user("ben2@example.com");
    const { chatId } = await party(ana, ben);
    await say(ana, chatId, "Hi");
    const list = await h.call("GET", `${v1}/me/conversations`, undefined, ben.token);
    expect(list.body.conversations.map((c: { id: string }) => c.id)).not.toContain(chatId);
    const badge = await h.call("GET", `${v1}/me/conversations/unread`, undefined, ben.token);
    expect(badge.body).toEqual({ conversations: 0, messages: 0 });
    // Its own unread count is there for the party's chat button.
    const chat = await h.call("GET", `${v1}/conversations/${chatId}`, undefined, ben.token);
    expect(chat.body.unread).toBe(1);
  });

  it("someone who joins reads the history, starting with nothing unread", async () => {
    const ana = await h.user("ana3@example.com");
    const ben = await h.user("ben3@example.com");
    const cem = await h.user("cem3@example.com");
    const { id, chatId } = await party(ana, ben);
    await say(ana, chatId, "One");
    await say(ben, chatId, "Two");
    await befriend(ana, cem);
    await h.call("POST", `${v1}/parties/${id}/invites`, { userIds: [cem.id] }, ana.token);
    // Not in it yet: nothing to read.
    expect((await h.call("GET", `${v1}/conversations/${chatId}/messages`, undefined, cem.token)).status).toBe(
      404,
    );
    const joined = await h.call("POST", `${v1}/parties/${id}/join`, {}, cem.token);
    expect(joined.body.conversationId).toBe(chatId);
    const history = await h.call("GET", `${v1}/conversations/${chatId}/messages`, undefined, cem.token);
    expect(history.body.messages.map((m: { text: string }) => m.text)).toEqual(["One", "Two"]);
    expect((await h.call("GET", `${v1}/conversations/${chatId}`, undefined, cem.token)).body.unread).toBe(0);
  });

  it("leaving or being kicked ends reading and writing; the last one out ends the chat", async () => {
    const ana = await h.user("ana4@example.com");
    const ben = await h.user("ben4@example.com");
    const cem = await h.user("cem4@example.com");
    const { id, chatId } = await party(ana, ben, cem);
    await say(ana, chatId, "Hello");
    expect((await h.call("POST", `${v1}/parties/${id}/leave`, {}, ben.token)).status).toBe(204);
    expect((await say(ben, chatId, "Still here?")).status).toBe(404);
    expect((await h.call("GET", `${v1}/conversations/${chatId}/messages`, undefined, ben.token)).status).toBe(
      404,
    );
    expect((await h.call("POST", `${v1}/parties/${id}/kick`, { userId: cem.id }, ana.token)).status).toBe(
      204,
    );
    expect((await say(cem, chatId, "Hey")).status).toBe(404);
    const left = await h.call("GET", `${v1}/conversations/${chatId}`, undefined, ana.token);
    expect(left.body.members.map((m: { userId: string }) => m.userId)).toEqual([ana.id]);

    expect((await h.call("POST", `${v1}/parties/${id}/leave`, {}, ana.token)).status).toBe(204);
    const rows = await h.deps.db.execute(sql`select id from conversations where id = ${chatId}`);
    expect(rows).toHaveLength(0);
  });

  it("follows the party: no renaming, adding or leaving it from the chat, and no media", async () => {
    const ana = await h.user("ana5@example.com");
    const ben = await h.user("ben5@example.com");
    const cem = await h.user("cem5@example.com");
    const { id, chatId } = await party(ana, ben);
    await befriend(ana, cem);
    expect(
      (await h.call("PATCH", `${v1}/conversations/${chatId}`, { title: "Ours" }, ana.token)).status,
    ).toBe(409);
    const added = await h.call(
      "POST",
      `${v1}/conversations/${chatId}/members`,
      { userIds: [cem.id] },
      ana.token,
    );
    expect(added.status).toBe(409);
    expect(added.body).toMatchObject({ partyId: id });
    expect(
      (await h.call("DELETE", `${v1}/conversations/${chatId}/members/${ben.id}`, undefined, ben.token))
        .status,
    ).toBe(409);
    const media = await say(ana, chatId, "Look", { attachments: [{ mediaId: crypto.randomUUID() }] });
    expect(media.status).toBe(400);
  });

  it("a party from before party chat gets its chat with every member", async () => {
    const ana = await h.user("ana6@example.com");
    const ben = await h.user("ben6@example.com");
    const { id, chatId } = await party(ana, ben);
    await h.deps.db.execute(sql`delete from conversations where id = ${chatId}`);
    const seen = await h.call("GET", `${v1}/me/party`, undefined, ben.token);
    const fresh = seen.body.party.conversationId as string;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(chatId);
    const chat = await h.call("GET", `${v1}/conversations/${fresh}`, undefined, ana.token);
    expect(chat.body).toMatchObject({ partyId: id });
    expect(chat.body.members).toHaveLength(2);
  });

  it("a member can report a message there; a visitor of a public party sees no chat", async () => {
    const ana = await h.user("ana7@example.com");
    const ben = await h.user("ben7@example.com");
    const dan = await h.user("dan7@example.com");
    const { id, chatId } = await party(ana, ben);
    await h.call("PATCH", `${v1}/parties/${id}`, { public: { join: "request" } }, ana.token);
    const rude = await say(ana, chatId, "Rude words");
    const report = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "message", targetId: rude.body.id, reason: "harassment" },
      ben.token,
    );
    expect(report.status).toBe(201);
    const visitor = await h.call("GET", `${v1}/parties/${id}`, undefined, dan.token);
    expect(visitor.status).toBe(200);
    expect(visitor.body.conversationId).toBeUndefined();
  });

  it("typing is passed on to the party's members", async () => {
    const ana = await h.user("ana8@example.com");
    const ben = await h.user("ben8@example.com");
    const { chatId } = await party(ana, ben);
    await h.call("GET", `${v1}/conversations/${chatId}/messages`, undefined, ana.token);
    const members = await h.valkey.smembers(`conversation:${chatId}:members`);
    expect(members.sort()).toEqual([ana.id, ben.id].sort());
  });
});
