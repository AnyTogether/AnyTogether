import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
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

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

async function befriend(a: User, b: User) {
  await h.call("POST", "/api/v1/me/friends/requests", { handle: b.handle }, a.token);
  await h.call("POST", `/api/v1/me/friends/requests/${a.id}/accept`, {}, b.token);
}

const send = (user: User, conversationId: string, text: string, clientId = uuidv7()) =>
  h.call("POST", `/api/v1/conversations/${conversationId}/messages`, { clientId, text }, user.token);

describe("direct conversations", () => {
  it("are made once between friends, carry messages both ways, and count unread", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = await h.call("POST", "/api/v1/conversations", { members: [ayse.id] }, utku.token);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ kind: "direct", unread: 0, lastMessage: null });
    const again = await h.call("POST", "/api/v1/conversations", { members: [utku.id] }, ayse.token);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(made.body.id);
    const id = made.body.id as string;

    const ayseHears = await listen(ayse.id);
    const sent = await send(utku, id, "  merhaba  ");
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ seq: 1, text: "merhaba", authorId: utku.id });
    await settle();
    expect(ayseHears.heard.find((e) => e.type === "message.created")?.data).toMatchObject({
      conversationId: id,
      seq: 1,
      text: "merhaba",
    });
    ayseHears.stop();

    await send(utku, id, "nasılsın?");
    const list = await h.call("GET", "/api/v1/me/conversations", undefined, ayse.token);
    expect(list.body.conversations).toHaveLength(1);
    expect(list.body.conversations[0]).toMatchObject({ unread: 2, lastSeq: 2 });
    expect(list.body.conversations[0].lastMessage.text).toBe("nasılsın?");
    expect(list.body.conversations[0].members.map((m: { handle: string }) => m.handle).sort()).toEqual([
      "ayse",
      "utku",
    ]);
    expect((await h.call("GET", "/api/v1/me/conversations/unread", undefined, ayse.token)).body).toEqual({
      conversations: 1,
      messages: 2,
    });
    // The sender has read their own messages.
    expect((await h.call("GET", "/api/v1/me/conversations/unread", undefined, utku.token)).body).toEqual({
      conversations: 0,
      messages: 0,
    });

    const utkuHears = await listen(utku.id);
    expect(
      (await h.call("POST", `/api/v1/conversations/${id}/read`, { upToSeq: 99 }, ayse.token)).status,
    ).toBe(204);
    await settle();
    expect(utkuHears.heard.find((e) => e.type === "conversation.read")?.data).toMatchObject({
      userId: ayse.id,
      upToSeq: 2,
    });
    utkuHears.stop();
    expect(
      (await h.call("GET", "/api/v1/me/conversations/unread", undefined, ayse.token)).body.messages,
    ).toBe(0);
  });

  it("only between friends, and never after a block", async () => {
    const a = await h.user("a@example.com");
    const b = await h.user("b@example.com");
    const stranger = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    expect(stranger.status).toBe(403);
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    expect((await send(a, body.id, "hi")).status).toBe(201);
    await h.call("POST", "/api/v1/me/blocks", { userId: a.id }, b.token);
    expect((await send(a, body.id, "hello?")).status).toBe(403);
    expect((await send(b, body.id, "bye")).status).toBe(403);
  });

  it("stores a resent message once", async () => {
    const a = await h.user("r1@example.com");
    const b = await h.user("r2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    const clientId = uuidv7();
    const [first, second] = await Promise.all([
      send(a, body.id, "once", clientId),
      send(a, body.id, "once", clientId),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.seq).toBe(second.body.seq);
    const history = await h.call("GET", `/api/v1/conversations/${body.id}/messages`, undefined, a.token);
    expect(history.body.messages).toHaveLength(1);
    // Someone else's ID is not theirs to reuse.
    expect((await send(b, body.id, "mine", clientId)).status).toBe(409);
  });

  it("keeps outsiders out", async () => {
    const a = await h.user("o1@example.com");
    const b = await h.user("o2@example.com");
    const c = await h.user("o3@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    expect((await h.call("GET", `/api/v1/conversations/${body.id}`, undefined, c.token)).status).toBe(404);
    expect((await send(c, body.id, "let me in")).status).toBe(404);
    expect(
      (await h.call("GET", `/api/v1/conversations/${body.id}/messages`, undefined, c.token)).status,
    ).toBe(404);
    expect((await h.call("GET", "/api/v1/conversations/not-an-id", undefined, c.token)).status).toBe(404);
  });
});

describe("messages", () => {
  it("are edited and deleted by their author only, and every member hears it", async () => {
    const a = await h.user("e1@example.com");
    const b = await h.user("e2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    await send(a, body.id, "helo");
    const bHears = await listen(b.id);
    const edited = await h.call(
      "PATCH",
      `/api/v1/conversations/${body.id}/messages/1`,
      { text: "hello" },
      a.token,
    );
    expect(edited.status).toBe(200);
    expect(edited.body.text).toBe("hello");
    expect(edited.body.editedAt).not.toBeNull();
    expect(
      (await h.call("PATCH", `/api/v1/conversations/${body.id}/messages/1`, { text: "x" }, b.token)).status,
    ).toBe(403);
    expect(
      (await h.call("DELETE", `/api/v1/conversations/${body.id}/messages/1`, undefined, b.token)).status,
    ).toBe(403);
    expect(
      (await h.call("DELETE", `/api/v1/conversations/${body.id}/messages/1`, undefined, a.token)).status,
    ).toBe(204);
    await settle();
    expect(bHears.heard.map((e) => e.type)).toEqual(["message.updated", "message.deleted"]);
    bHears.stop();
    const history = await h.call("GET", `/api/v1/conversations/${body.id}/messages`, undefined, b.token);
    expect(history.body.messages[0]).toMatchObject({ seq: 1, text: null });
    expect(history.body.messages[0].deletedAt).not.toBeNull();
    expect(
      (await h.call("PATCH", `/api/v1/conversations/${body.id}/messages/1`, { text: "back" }, a.token))
        .status,
    ).toBe(404);
  });

  it("are not edited after 15 minutes", async () => {
    const a = await h.user("late1@example.com");
    const b = await h.user("late2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    await send(a, body.id, "old");
    await h.deps.db.execute(
      sql`update messages set created_at = now() - interval '16 minutes' where conversation_id = ${body.id}`,
    );
    expect(
      (await h.call("PATCH", `/api/v1/conversations/${body.id}/messages/1`, { text: "new" }, a.token)).status,
    ).toBe(403);
  });

  it("page by sequence, oldest first within a page", async () => {
    const a = await h.user("p1@example.com");
    const b = await h.user("p2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    for (let i = 1; i <= 7; i++) await send(i % 2 ? a : b, body.id, `m${i}`);
    const path = `/api/v1/conversations/${body.id}/messages`;
    const newest = await h.call("GET", `${path}?limit=3`, undefined, a.token);
    expect(newest.body.messages.map((m: { seq: number }) => m.seq)).toEqual([5, 6, 7]);
    expect(newest.body.more).toBe(true);
    const older = await h.call("GET", `${path}?limit=3&before=5`, undefined, a.token);
    expect(older.body.messages.map((m: { seq: number }) => m.seq)).toEqual([2, 3, 4]);
    const oldest = await h.call("GET", `${path}?limit=3&before=2`, undefined, a.token);
    expect(oldest.body).toMatchObject({ more: false });
    expect(oldest.body.messages.map((m: { text: string }) => m.text)).toEqual(["m1"]);
    const newer = await h.call("GET", `${path}?after=5`, undefined, a.token);
    expect(newer.body.messages.map((m: { seq: number }) => m.seq)).toEqual([6, 7]);
    expect((await h.call("GET", `${path}?before=x`, undefined, a.token)).status).toBe(400);
  });

  it("refuse empty and overlong text", async () => {
    const a = await h.user("t1@example.com");
    const b = await h.user("t2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    expect((await send(a, body.id, "   ")).status).toBe(400);
    expect((await send(a, body.id, "x".repeat(4001))).status).toBe(400);
    expect((await send(a, body.id, "x".repeat(4000))).status).toBe(201);
  });
});

describe("groups", () => {
  it("are made by a member with friends, grow, and lose people", async () => {
    const owner = await h.user("g1@example.com");
    const b = await h.user("g2@example.com");
    const c = await h.user("g3@example.com");
    const d = await h.user("g4@example.com");
    await befriend(owner, b);
    await befriend(owner, c);
    await befriend(b, d);
    const bHears = await listen(b.id);
    const made = await h.call(
      "POST",
      "/api/v1/conversations",
      { members: [b.id, c.id], title: "Co-op night" },
      owner.token,
    );
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ kind: "group", title: "Co-op night", createdBy: owner.id });
    expect(made.body.members).toHaveLength(3);
    await settle();
    expect(bHears.heard.some((e) => e.type === "conversation.updated")).toBe(true);
    bHears.stop();
    const id = made.body.id as string;
    await send(owner, id, "hi all");

    // The owner cannot add a stranger; b can add their own friend, who starts with nothing unread.
    expect(
      (await h.call("POST", `/api/v1/conversations/${id}/members`, { userIds: [d.id] }, owner.token)).status,
    ).toBe(403);
    const grown = await h.call("POST", `/api/v1/conversations/${id}/members`, { userIds: [d.id] }, b.token);
    expect(grown.body.members).toHaveLength(4);
    expect((await h.call("GET", "/api/v1/me/conversations/unread", undefined, d.token)).body.messages).toBe(
      0,
    );
    expect((await send(d, id, "hey")).status).toBe(201);

    // Only the creator removes others; anyone can leave.
    expect(
      (await h.call("DELETE", `/api/v1/conversations/${id}/members/${c.id}`, undefined, b.token)).status,
    ).toBe(403);
    const dHears = await listen(d.id);
    expect(
      (await h.call("DELETE", `/api/v1/conversations/${id}/members/${d.id}`, undefined, owner.token)).status,
    ).toBe(204);
    await settle();
    expect(dHears.heard.find((e) => e.type === "conversation.updated")?.data).toMatchObject({
      removed: true,
    });
    dHears.stop();
    expect((await send(d, id, "still here?")).status).toBe(404);
    expect(
      (await h.call("DELETE", `/api/v1/conversations/${id}/members/${c.id}`, undefined, c.token)).status,
    ).toBe(204);
    expect(
      (await h.call("PATCH", `/api/v1/conversations/${id}`, { title: "Two of us" }, b.token)).body.title,
    ).toBe("Two of us");
  });

  it("one person and a title is a group, not the direct conversation", async () => {
    const a = await h.user("x1@example.com");
    const b = await h.user("x2@example.com");
    await befriend(a, b);
    const direct = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    const group = await h.call("POST", "/api/v1/conversations", { members: [b.id], group: true }, a.token);
    expect(group.body.kind).toBe("group");
    expect(group.body.id).not.toBe(direct.body.id);
    expect((await h.call("POST", "/api/v1/conversations", { members: [a.id] }, a.token)).status).toBe(400);
  });
});

describe("moderation and accounts", () => {
  it("lets a member report a message, keeping what it said even after it is deleted", async () => {
    const a = await h.user("rep1@example.com");
    const b = await h.user("rep2@example.com");
    const outsider = await h.user("rep3@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    const sent = await send(b, body.id, "something nasty");
    const report = (user: User, targetId: string) =>
      h.call(
        "POST",
        "/api/v1/reports",
        { targetKind: "message", targetId, reason: "harassment" },
        user.token,
      );
    expect((await report(outsider, sent.body.id)).status).toBe(404);
    expect((await report(b, sent.body.id)).status).toBe(400);
    expect((await report(a, "not-a-message")).status).toBe(404);
    expect((await report(a, sent.body.id)).status).toBe(201);
    await h.call("DELETE", `/api/v1/conversations/${body.id}/messages/${sent.body.seq}`, undefined, b.token);
    const { run } = await import("../src/admin.js");
    const listed = await run(["reports"], h.deps);
    expect(listed).toContain("message @rep2");
    expect(listed).toContain("said: “something nasty”");
  });

  it("limits how many messages someone sends", async () => {
    await h.close();
    h = await harness({ limits: { message: { max: 2, seconds: 60 } } });
    const a = await h.user("lim1@example.com");
    const b = await h.user("lim2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    expect((await send(a, body.id, "1")).status).toBe(201);
    expect((await send(a, body.id, "2")).status).toBe(201);
    const third = await send(a, body.id, "3");
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("empties a deleted account's messages and puts them in its export", async () => {
    const a = await h.user("gone1@example.com");
    const b = await h.user("gone2@example.com");
    await befriend(a, b);
    const { body } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    await send(a, body.id, "remember me");
    await send(b, body.id, "I will");
    const exported = await h.call("GET", "/api/v1/me/export", undefined, a.token);
    expect(exported.body.messages).toMatchObject([{ conversationId: body.id, seq: 1, text: "remember me" }]);
    expect((await h.call("POST", "/api/v1/me/deletion", {}, a.token)).status).toBe(202);
    await h.call(
      "DELETE",
      "/api/v1/me",
      { code: h.mailer.lastCode("gone1@example.com", "deletion") },
      a.token,
    );
    const { purgeDeletedAccounts } = await import("../src/account.js");
    expect(await purgeDeletedAccounts(h.deps, new Date(Date.now() + 15 * 86_400_000))).toBe(1);
    const history = await h.call("GET", `/api/v1/conversations/${body.id}/messages`, undefined, b.token);
    expect(history.body.messages.map((m: { text: string | null }) => m.text)).toEqual([null, "I will"]);
    expect(history.body.messages[0].authorId).toBeNull();
  });
});

describe("links", () => {
  it("to a blocked domain are refused, in any spelling, and allowed ones pass", async () => {
    await h.close();
    h = await harness({ blockedLinkDomains: ["grabify.link", "iplogger.org"] });
    const a = await h.user("la@example.com");
    const b = await h.user("lb@example.com");
    await befriend(a, b);
    const { body: chat } = await h.call("POST", "/api/v1/conversations", { members: [b.id] }, a.token);
    for (const text of [
      "look https://grabify.link/AB12CD",
      "grabify.link/x",
      "www.IPLOGGER.org/abc",
      "a.b.iplogger.org",
      "grabify[.]link/x",
      "grabify (dot) link",
      "ｇｒａｂｉｆｙ．ｌｉｎｋ",
      // Inside another link too: a redirect could take the reader there.
      "https://example.com/out?to=grabify.link/x",
    ]) {
      const refused = await send(a, chat.id, text);
      expect(refused.status, text).toBe(400);
      expect(refused.body.code).toBe("link_blocked");
    }
    for (const text of ["notgrabify.link", "grabify.linked.example", "grabify link"]) {
      const sent = await send(a, chat.id, text);
      expect(sent.status, text).toBe(201);
    }
    const ok = await send(a, chat.id, "fine");
    const edited = await h.call(
      "PATCH",
      `/api/v1/conversations/${chat.id}/messages/${ok.body.seq}`,
      { text: "now https://grabify.link/x" },
      a.token,
    );
    expect(edited.body.code).toBe("link_blocked");
  });
});

describe("typing", () => {
  it("is checked against the members the API keeps for the gateway", async () => {
    const a = await h.user("ta@example.com");
    const b = await h.user("tb@example.com");
    const c = await h.user("tc@example.com");
    await befriend(a, b);
    await befriend(a, c);
    const { body: group } = await h.call(
      "POST",
      "/api/v1/conversations",
      { members: [b.id], title: "Two of us" },
      a.token,
    );
    const key = `conversation:${group.id}:members`;
    await h.call("GET", `/api/v1/conversations/${group.id}/messages`, undefined, b.token);
    expect((await h.valkey.smembers(key)).sort()).toEqual([a.id, b.id].sort());
    expect(await h.valkey.ttl(key)).toBeGreaterThan(80_000);
    await h.call("POST", `/api/v1/conversations/${group.id}/members`, { userIds: [c.id] }, a.token);
    expect(await h.valkey.exists(key)).toBe(0);
    await send(c, group.id, "hi");
    expect((await h.valkey.smembers(key)).sort()).toEqual([a.id, b.id, c.id].sort());
    await h.call("DELETE", `/api/v1/conversations/${group.id}/members/${b.id}`, undefined, b.token);
    await h.call("GET", `/api/v1/conversations/${group.id}/messages`, undefined, a.token);
    expect((await h.valkey.smembers(key)).sort()).toEqual([a.id, c.id].sort());
  });
});
