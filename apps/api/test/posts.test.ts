import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { recordMeeting } from "../src/met.js";
import { mute } from "../src/moderation.js";
import { type StorageOptions, harness } from "./harness.js";
import { mp4, oggOpus, png } from "./mediaFixtures.js";

const v1 = "/api/v1";
const game = "PPSA01234";
let h: Awaited<ReturnType<typeof harness>>;
let dir: string;

async function start(options: Parameters<typeof harness>[0] = {}, storage: Partial<StorageOptions> = {}) {
  dir = await mkdtemp(join(tmpdir(), "at-posts-"));
  h = await harness({ ...options, storage: { dir, ...storage } });
}
afterEach(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

type User = Awaited<ReturnType<typeof h.user>>;
type Post = Record<string, unknown> & { id: string; likes: number; comments: number; liked: boolean };

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}
const block = (a: User, b: User) => h.call("POST", `${v1}/me/blocks`, { userId: b.id }, a.token);
async function upload(user: User, kind: "image" | "clip" | "voice", bytes?: Uint8Array) {
  const body = bytes ?? (kind === "image" ? await png() : kind === "clip" ? mp4() : oggOpus(3));
  const response = await h.send("POST", `${v1}/me/media?kind=${kind}`, { token: user.token, body });
  expect(response.status).toBe(201);
  return ((await response.json()) as { media: { id: string } }).media.id;
}
const post = (user: User, body: Record<string, unknown>) => h.call("POST", `${v1}/posts`, body, user.token);
async function share(user: User, body: Record<string, unknown> = {}) {
  const made = await post(user, { media: [await upload(user, "image")], ...body });
  expect(made.status).toBe(201);
  return made.body as Post;
}
const get = (user: User, path: string) => h.call("GET", `${v1}${path}`, undefined, user.token);
const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
const captures = async (user: User, query = "") => (await get(user, `/me/captures${query}`)).body;
const comment = (user: User, postId: string, text: string, replyTo?: string) =>
  h.call("POST", `${v1}/posts/${postId}/comments`, { text, ...(replyTo ? { replyTo } : {}) }, user.token);
const like = (user: User, postId: string) => h.call("PUT", `${v1}/posts/${postId}/like`, {}, user.token);
const notes = async (user: User) =>
  (await get(user, "/me/notifications")).body.notifications as {
    kind: string;
    actor: { handle: string } | null;
    data: Record<string, unknown>;
    subjectId: string;
  }[];
async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: Record<string, unknown> }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

describe("making posts", () => {
  it("takes one to four pictures or one clip of one's own, with a caption and a game", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, utku.token);
    const pictures = [await upload(utku, "image"), await upload(utku, "image")];
    const made = await post(utku, {
      media: pictures,
      caption: "  Boss down on the first try  ",
      titleId: game,
      source: "launcher",
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      author: { userId: utku.id, handle: utku.handle },
      caption: "Boss down on the first try",
      game: { titleId: game, names: { en: "Cat Quest III" } },
      // The gallery is friends only by default, and so is a post.
      visibility: "friends",
      commentsOff: false,
      likes: 0,
      liked: false,
      comments: 0,
      mine: true,
      source: "launcher",
      editedAt: null,
    });
    expect(made.body.media.map((m: { id: string }) => m.id)).toEqual(pictures);
    expect(made.body.media[0]).toMatchObject({ kind: "image", width: 64, height: 64 });

    const clip = await post(utku, { media: [await upload(utku, "clip")] });
    expect(clip.status).toBe(201);
    expect(clip.body.media[0]).toMatchObject({ kind: "clip", durationMs: 5000 });

    // A clip with pictures, two clips, five pictures, a voice note or nothing: refused.
    const more = await Promise.all([1, 2, 3, 4, 5].map(() => upload(utku, "image")));
    const clipId = await upload(utku, "clip");
    for (const media of [
      [clipId, more[0]],
      [clipId, await upload(utku, "clip")],
      more,
      [await upload(utku, "voice")],
      [],
      [more[0], more[0]],
    ])
      expect((await post(utku, { media })).status).toBe(400);
  });

  it("refuses someone else's media, a clip over a minute and links to blocked domains", async () => {
    await start({ blockedLinkDomains: ["grabify.link"] });
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    expect((await post(utku, { media: [await upload(ayse, "image")] })).status).toBe(400);
    const long = await upload(utku, "clip", mp4({ seconds: 61 }));
    expect((await post(utku, { media: [long] })).status).toBe(400);
    const linked = await post(utku, {
      media: [await upload(utku, "image")],
      caption: "free skins at grabify.link/abc",
    });
    expect(linked.status).toBe(400);
    expect(linked.body.code).toBe("link_blocked");
  });

  it("takes the default visibility from the gallery setting", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    await h.call("PATCH", `${v1}/me/privacy`, { gallery: "everyone" }, utku.token);
    expect((await share(utku)).visibility).toBe("public");
    expect((await share(utku, { visibility: "friends" })).visibility).toBe("friends");
  });

  it("lets the author edit the caption, change who sees it, turn comments off and delete it", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = await share(utku, { caption: "first" });
    expect((await h.call("PATCH", `${v1}/posts/${made.id}`, { caption: "x" }, ayse.token)).status).toBe(404);
    const edited = await h.call(
      "PATCH",
      `${v1}/posts/${made.id}`,
      { caption: "second", commentsOff: true, visibility: "public" },
      utku.token,
    );
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ caption: "second", commentsOff: true, visibility: "public" });
    expect(edited.body.editedAt).not.toBeNull();
    expect((await h.call("DELETE", `${v1}/posts/${made.id}`, undefined, ayse.token)).status).toBe(404);
    expect((await h.call("DELETE", `${v1}/posts/${made.id}`, undefined, utku.token)).status).toBe(204);
    expect((await get(ayse, `/posts/${made.id}`)).status).toBe(404);
  });

  it("frees media that only the deleted post used, and keeps what is pinned", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const pinned = await upload(utku, "image");
    const only = await upload(utku, "image");
    await h.call("PUT", `${v1}/me/gallery`, { items: [pinned] }, utku.token);
    const made = await post(utku, { media: [pinned, only] });
    await h.call("DELETE", `${v1}/posts/${made.body.id}`, undefined, utku.token);
    const left = (await get(utku, "/me/media")).body.media.map((m: { id: string }) => m.id);
    expect(left).toEqual([pinned]);
  });

  it("keeps a muted account from posting and commenting", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const troll = await h.user("troll@example.com");
    await befriend(utku, troll);
    const made = await share(utku);
    const image = await upload(troll, "image");
    await mute(h.deps, troll.id);
    expect((await post(troll, { media: [image] })).status).toBe(403);
    expect((await comment(troll, made.id, "hi")).status).toBe(403);
  });

  it("limits how often one posts, likes and comments", async () => {
    await start({
      limits: {
        post: { max: 1, seconds: 3600 },
        postLike: { max: 1, seconds: 3600 },
        postComment: { max: 1, seconds: 3600 },
      },
    });
    const utku = await h.user("utku@example.com");
    const made = await share(utku);
    expect((await post(utku, { media: [await upload(utku, "image")] })).status).toBe(429);
    expect((await like(utku, made.id)).status).toBe(200);
    expect((await h.call("DELETE", `${v1}/posts/${made.id}/like`, undefined, utku.token)).status).toBe(429);
    expect((await comment(utku, made.id, "one")).status).toBe(201);
    expect((await comment(utku, made.id, "two")).status).toBe(429);
  });
});

describe("who sees a post", () => {
  it("shows friends-only posts to friends alone, everywhere they could show", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Cat Quest III" } }, utku.token);
    const made = await share(utku, { titleId: game, caption: "secret base" });

    expect((await get(ayse, `/posts/${made.id}`)).status).toBe(200);
    expect(ids(await captures(ayse))).toEqual([made.id]);
    expect(ids((await get(ayse, `/users/${utku.handle}/posts`)).body)).toEqual([made.id]);
    expect(ids((await get(ayse, `/games/${game}/posts`)).body)).toEqual([made.id]);

    expect((await get(stranger, `/posts/${made.id}`)).status).toBe(404);
    expect(ids(await captures(stranger))).toEqual([]);
    expect(ids((await get(stranger, `/users/${utku.handle}/posts`)).body)).toEqual([]);
    expect(ids((await get(stranger, `/games/${game}/posts`)).body)).toEqual([]);
    expect((await get(stranger, `/posts/${made.id}/comments`)).status).toBe(404);
    expect((await get(stranger, `/posts/${made.id}/likes`)).status).toBe(404);
    expect((await like(stranger, made.id)).status).toBe(404);
    expect((await comment(stranger, made.id, "hey")).status).toBe(404);
    // Its media cannot be reported (or learned of) by them either.
    const mediaId = (made.media as { id: string }[])[0]?.id;
    const reported = await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "media", targetId: mediaId, reason: "spam" },
      stranger.token,
    );
    expect(reported.status).toBe(404);
    // Nor is it in a search, a signed-out profile or the stranger's export.
    expect(JSON.stringify((await get(stranger, `/users/search?q=${utku.handle}`)).body)).not.toContain(
      "secret base",
    );
    const signedOut = await h.call("GET", `${v1}/users/${utku.handle}`);
    expect(JSON.stringify(signedOut.body)).not.toContain("secret base");
    expect(JSON.stringify((await get(stranger, "/me/export")).body)).not.toContain("secret base");

    // Once the friendship ends, so does seeing it.
    await h.call("DELETE", `${v1}/me/friends/${utku.id}`, undefined, ayse.token);
    expect((await get(ayse, `/posts/${made.id}`)).status).toBe(404);
  });

  it("shows public posts to anyone signed in, on the profile and the game's page", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const stranger = await h.user("stranger@example.com");
    const made = await share(utku, { visibility: "public", titleId: game });
    expect((await get(stranger, `/posts/${made.id}`)).status).toBe(200);
    expect(ids((await get(stranger, `/users/${utku.handle}/posts`)).body)).toEqual([made.id]);
    expect(ids((await get(stranger, `/games/${game}/posts`)).body)).toEqual([made.id]);
    // Not in their Captures feed: they are neither friends nor played together.
    expect(ids(await captures(stranger))).toEqual([]);
    await recordMeeting(h.deps, stranger.id, [utku.id], "party", game);
    expect(ids(await captures(stranger))).toEqual([made.id]);
    // Signed out, posts are not shown.
    expect((await h.call("GET", `${v1}/posts/${made.id}`)).status).toBe(401);
  });

  it("keeps blocked people's posts, likes and comments apart, both ways", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const troll = await h.user("troll@example.com");
    await befriend(utku, ayse);
    await befriend(utku, troll);
    await befriend(ayse, troll);
    const made = await share(utku, { visibility: "public" });
    const theirs = await share(troll, { visibility: "public", titleId: game });
    await like(troll, made.id);
    await like(ayse, made.id);
    const said = await comment(troll, made.id, "first!");
    await comment(ayse, made.id, "nice", said.body.id);
    await comment(ayse, made.id, "great shot");

    await block(ayse, troll);
    const seen = (await get(ayse, `/posts/${made.id}`)).body as Post;
    expect(seen.likes).toBe(1);
    // The troll's comment and the reply under it are gone for her.
    expect(seen.comments).toBe(1);
    const thread = (await get(ayse, `/posts/${made.id}/comments`)).body;
    expect(thread.items.map((c: { text: string }) => c.text)).toEqual(["great shot"]);
    const likers = (await get(ayse, `/posts/${made.id}/likes`)).body;
    expect(likers.items.map((p: { handle: string }) => p.handle)).toEqual([ayse.handle]);

    // And the other way: the troll sees none of hers.
    const trollSees = (await get(troll, `/posts/${made.id}/comments`)).body;
    expect(trollSees.items.map((c: { text: string }) => c.text)).toEqual(["first!"]);
    expect(trollSees.items[0].replies).toEqual([]);
    expect((await get(troll, `/posts/${made.id}`)).body.likes).toBe(1);

    // Posts of the blocked never show, wherever she looks.
    expect((await get(ayse, `/posts/${theirs.id}`)).status).toBe(404);
    expect(ids(await captures(ayse))).toEqual([made.id]);
    expect(ids((await get(ayse, `/games/${game}/posts`)).body)).toEqual([]);
    expect((await get(ayse, `/users/${troll.handle}/posts`)).status).toBe(404);
  });

  it("pages the Captures feed newest first with before", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await share(i % 2 ? ayse : utku)).id);
    const first = await captures(ayse, "?limit=2");
    expect(ids(first)).toEqual([made[2], made[1]]);
    expect(first.next).toBe(made[1]);
    const second = await captures(ayse, `?limit=2&before=${first.next}`);
    expect(ids(second)).toEqual([made[0]]);
    expect(second.next).toBeNull();
  });

  it("tells friends of a new post as it is made, and no one else", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const stranger = await h.user("stranger@example.com");
    await befriend(utku, ayse);
    const friend = await listen(ayse.id);
    const other = await listen(stranger.id);
    const made = await share(utku);
    await settle();
    expect(friend.heard.filter((e) => e.type === "post.new").map((e) => e.data.id)).toEqual([made.id]);
    expect(other.heard.filter((e) => e.type.startsWith("post."))).toEqual([]);
    await h.call("DELETE", `${v1}/posts/${made.id}`, undefined, utku.token);
    await settle();
    expect(friend.heard.some((e) => e.type === "post.removed" && e.data.postId === made.id)).toBe(true);
    friend.stop();
    other.stop();
  });
});

describe("likes", () => {
  it("counts likes once per person, lists who liked and gathers the author's notification", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const mert = await h.user("mert@example.com");
    const hidden = await h.user("hidden@example.com");
    for (const friend of [ayse, mert, hidden]) await befriend(utku, friend);
    await h.call("PATCH", `${v1}/me/privacy`, { search: "nobody" }, hidden.token);
    const made = await share(utku);

    expect((await like(ayse, made.id)).body).toEqual({ likes: 1, liked: true });
    expect((await like(ayse, made.id)).body).toEqual({ likes: 1, liked: true });
    await like(mert, made.id);
    await like(hidden, made.id);
    expect((await get(utku, `/posts/${made.id}`)).body).toMatchObject({ likes: 3, liked: false });

    const list = await get(mert, `/posts/${made.id}/likes`);
    // Mert is not friends with Ayşe, and the hidden one keeps out of lists: Mert sees himself
    // and Ayşe (findable by anyone), and one more he may not see.
    expect(list.body.items.map((p: { handle: string }) => p.handle)).toEqual([mert.handle, ayse.handle]);
    expect(list.body.hidden).toBe(1);
    // The author sees everyone who liked it who is a friend.
    expect((await get(utku, `/posts/${made.id}/likes`)).body.items).toHaveLength(3);

    const liked = (await notes(utku)).filter((n) => n.kind === "post_like");
    expect(liked).toHaveLength(1);
    expect(liked[0]).toMatchObject({ subjectId: made.id, actor: { handle: hidden.handle } });
    expect(liked[0]?.data).toMatchObject({ postId: made.id, count: 3 });

    const unliked = await h.call("DELETE", `${v1}/posts/${made.id}/like`, undefined, ayse.token);
    expect(unliked.body).toEqual({ likes: 2, liked: false });
    // Liking one's own post tells no one.
    await like(utku, made.id);
    expect((await notes(utku)).filter((n) => n.kind === "post_like")).toHaveLength(1);
  });

  it("tells the author of new counts as they change", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = await share(utku);
    const author = await listen(utku.id);
    await like(ayse, made.id);
    await comment(ayse, made.id, "wow");
    await settle();
    const counts = author.heard.filter((e) => e.type === "post.counts").map((e) => e.data);
    expect(counts).toEqual([
      { postId: made.id, likes: 1, comments: 0 },
      { postId: made.id, likes: 1, comments: 1 },
    ]);
    author.stop();
  });
});

describe("comments", () => {
  it("threads one level, notifies the author and the one answered, and deletes", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const mert = await h.user("mert@example.com");
    await befriend(utku, ayse);
    await befriend(utku, mert);
    const made = await share(utku);

    const top = await comment(ayse, made.id, "  where is this?  ");
    expect(top.status).toBe(201);
    expect(top.body).toMatchObject({ text: "where is this?", replyTo: null, canDelete: true });
    const reply = await comment(mert, made.id, "the north cave", top.body.id);
    expect(reply.status).toBe(201);
    expect(reply.body.replyTo).toBe(top.body.id);
    // A reply to a reply is not threaded deeper.
    expect((await comment(utku, made.id, "deeper", reply.body.id)).status).toBe(400);
    expect((await comment(utku, made.id, "")).status).toBe(400);

    const thread = (await get(utku, `/posts/${made.id}/comments`)).body;
    expect(thread.items).toHaveLength(1);
    expect(thread.items[0]).toMatchObject({ text: "where is this?", canDelete: true });
    expect(thread.items[0].replies.map((r: { text: string }) => r.text)).toEqual(["the north cave"]);
    expect((await get(utku, `/posts/${made.id}`)).body.comments).toBe(2);

    const toAuthor = (await notes(utku)).filter((n) => n.kind === "post_comment");
    expect(toAuthor).toHaveLength(1);
    expect(toAuthor[0]?.data).toMatchObject({ postId: made.id, count: 2, text: "the north cave" });
    const toAyse = (await notes(ayse)).filter((n) => n.kind === "comment_reply");
    expect(toAyse[0]).toMatchObject({ subjectId: top.body.id, actor: { handle: mert.handle } });

    // Mert may not delete Ayşe's comment; the post's author may delete any.
    const mertSees = (await get(mert, `/posts/${made.id}/comments`)).body.items[0];
    expect(mertSees.canDelete).toBe(false);
    expect(
      (await h.call("DELETE", `${v1}/posts/${made.id}/comments/${top.body.id}`, undefined, mert.token))
        .status,
    ).toBe(404);
    expect(
      (await h.call("DELETE", `${v1}/posts/${made.id}/comments/${reply.body.id}`, undefined, mert.token))
        .status,
    ).toBe(204);
    expect(
      (await h.call("DELETE", `${v1}/posts/${made.id}/comments/${top.body.id}`, undefined, utku.token))
        .status,
    ).toBe(204);
    expect((await get(utku, `/posts/${made.id}`)).body.comments).toBe(0);
  });

  it("tells no one of a reply to their comment once they may not see the post", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const mert = await h.user("mert@example.com");
    await befriend(utku, ayse);
    await befriend(utku, mert);
    const made = await share(utku);
    const said = await comment(ayse, made.id, "nice");
    await h.call("DELETE", `${v1}/me/friends/${ayse.id}`, undefined, utku.token);
    expect((await comment(mert, made.id, "agreed", said.body.id)).status).toBe(201);
    expect((await notes(ayse)).filter((n) => n.kind === "comment_reply")).toEqual([]);
  });

  it("refuses comments once the author turns them off", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const made = await share(utku, { commentsOff: true });
    const refused = await comment(ayse, made.id, "hi");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("comments_off");
    await h.call("PATCH", `${v1}/posts/${made.id}`, { commentsOff: false }, utku.token);
    expect((await comment(ayse, made.id, "hi")).status).toBe(201);
  });
});

describe("reports and moderators", () => {
  it("takes reports of posts and comments, and removes them", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const admin = await h.user("admin@example.com");
    await h.deps.db.execute(sql`update accounts set role = 'admin' where id = ${admin.id}`);
    await befriend(utku, ayse);
    const made = await share(utku, { caption: "look at this" });
    const said = await comment(utku, made.id, "rude words");

    const report = (targetKind: string, targetId: string, user: User) =>
      h.call("POST", `${v1}/reports`, { targetKind, targetId, reason: "harassment" }, user.token);
    expect((await report("post", made.id, utku)).status).toBe(400);
    expect((await report("post", made.id, admin)).status).toBe(404);
    expect((await report("post", made.id, ayse)).status).toBe(201);
    expect((await report("comment", said.body.id, ayse)).status).toBe(201);

    const queue = (await h.call("GET", `${v1}/admin/reports`, undefined, admin.token)).body.reports;
    const postReport = queue.find((r: { targetKind: string }) => r.targetKind === "post");
    const commentReport = queue.find((r: { targetKind: string }) => r.targetKind === "comment");
    expect(postReport).toMatchObject({
      target: { handle: utku.handle },
      capture: { caption: "look at this", removed: false },
    });
    expect(postReport.capture.media).toHaveLength(1);
    expect(commentReport).toMatchObject({ comment: { text: "rude words", removed: false } });

    const act = (id: string, action: string) =>
      h.call("POST", `${v1}/admin/reports/${id}`, { action }, admin.token);
    expect((await act(commentReport.id, "remove_comment")).status).toBe(200);
    expect((await get(ayse, `/posts/${made.id}/comments`)).body.items).toEqual([]);
    expect((await act(postReport.id, "remove_post")).status).toBe(200);
    expect((await get(ayse, `/posts/${made.id}`)).status).toBe(404);
    expect(ids(await captures(ayse))).toEqual([]);
  });
});

describe("children", () => {
  async function familyWithChild() {
    const mom = await h.user("mom@example.com");
    await h.call("POST", `${v1}/families`, { name: "Home" }, mom.token);
    const kid = await h.user("kid@example.com");
    const { body } = await h.call("POST", `${v1}/me/family/link-codes`, {}, mom.token);
    await h.call("POST", `${v1}/me/family/join`, { code: body.code, timeZone: "Europe/Istanbul" }, kid.token);
    return { mom, kid };
  }
  const restrict = (mom: User, kid: User, update: Record<string, unknown>) =>
    h.call("PATCH", `${v1}/me/family/children/${kid.id}/restrictions`, update, mom.token);

  it("follows the family settings: sharing off by default, friends only, no strangers", async () => {
    await start();
    const { mom, kid } = await familyWithChild();
    const friend = await h.user("friend@example.com");
    const stranger = await h.user("stranger@example.com");
    await restrict(mom, kid, { approvedContacts: [friend.id] });
    await befriend(kid, friend);
    const image = await upload(kid, "image");
    const off = await post(kid, { media: [image] });
    expect(off.status).toBe(403);
    expect(off.body.code).toBe("restricted_by_family");

    await restrict(mom, kid, { mediaSharing: true });
    expect((await post(kid, { media: [image], visibility: "public" })).status).toBe(403);
    const made = await post(kid, { media: [image] });
    expect(made.status).toBe(201);
    expect(made.body.visibility).toBe("friends");
    expect(
      (await h.call("PATCH", `${v1}/posts/${made.body.id}`, { visibility: "public" }, kid.token)).status,
    ).toBe(403);

    // Strangers' public posts stay out of the game page while discovery is off, and a child may
    // not comment where strangers read.
    const open = await share(stranger, { visibility: "public", titleId: game });
    const friendsOpen = await share(friend, { visibility: "public", titleId: game });
    expect(ids((await get(kid, `/games/${game}/posts`)).body)).toEqual([friendsOpen.id]);
    expect((await get(kid, `/posts/${open.id}`)).status).toBe(404);
    expect((await comment(kid, friendsOpen.id, "cool")).status).toBe(403);
    expect((await like(kid, friendsOpen.id)).status).toBe(200);
    const friendsOnly = await share(friend);
    expect((await comment(kid, friendsOnly.id, "cool")).status).toBe(201);
  });
});

describe("the data export", () => {
  it("carries one's own posts, comments and likes", async () => {
    await start();
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    const mine = await share(utku, { caption: "my capture" });
    const hers = await share(ayse, { caption: "her capture" });
    await comment(utku, hers.id, "my comment");
    await like(utku, hers.id);
    const data = (await get(utku, "/me/export")).body;
    expect(data.posts).toMatchObject([{ id: mine.id, caption: "my capture", visibility: "friends" }]);
    expect(data.postComments).toMatchObject([{ postId: hers.id, text: "my comment" }]);
    expect(data.postLikes).toMatchObject([{ postId: hers.id }]);
    expect(JSON.stringify(data)).not.toContain("her capture");
  });
});
