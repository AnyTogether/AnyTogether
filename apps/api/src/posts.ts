import { games, media, postComments, postLikes, postMedia, posts, profiles } from "@anytogether/db";
import {
  CommentCreate,
  type CommentPage,
  type CommentView,
  ErrorCode,
  type LikesPage,
  type MemberView,
  PostCreate,
  type PostMedia,
  type PostPage,
  type PostSource,
  PostUpdate,
  type PostView,
  type PostVisibility,
  TitleId,
  defaultPostVisibility,
  friendsKey,
  mediaLimits,
  postLimits,
  shownPrivacy,
} from "@anytogether/shared";
import { type SQL, and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { familyGuard, restricted } from "./family.js";
import { paging } from "./feed.js";
import { needFiles } from "./files.js";
import { body } from "./http.js";
import { blockedLink } from "./links.js";
import type { MediaService } from "./media.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { assertNotMuted } from "./moderation.js";
import type { Notifier } from "./notifications.js";
import { blockedBetween, findProfile, people } from "./people.js";
import {
  type PostRow,
  commentShown,
  friendIdsOf,
  seesPost,
  seesStrangers,
  unblocked,
  visibleComment,
  visiblePost,
} from "./postAccess.js";
import { rateLimiter } from "./ratelimit.js";

type Scope =
  | { kind: "captures" }
  | { kind: "author"; id: string }
  | { kind: "game"; titleId: string }
  | { kind: "ids"; ids: string[] };

type Row = {
  id: string;
  author_id: string;
  caption: string | null;
  title_id: string | null;
  visibility: PostVisibility;
  comments_off: boolean;
  source: PostSource | null;
  edited_at: string | Date | null;
  created_at: string | Date;
  likes: number;
  liked: boolean;
  comments: number;
};
type CommentSqlRow = {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  text: string;
  created_at: string | Date;
};

const iso = (value: string | Date) => new Date(value).toISOString();
const notFound = () => new HttpError(404, ErrorCode.notFound, "No such post");
const snippet = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text);

/** Capture posts: making, editing and deleting them, the feeds they show in, likes and comments,
 *  and who is told. Who may see a post is decided in postAccess.ts, in SQL, for every read. */
export function postService(deps: Deps, notes: Notifier, mediaOf: MediaService) {
  const { db, valkey } = deps;
  const who = people(db);

  /** Posts as `viewer` may see them, newest first. */
  async function read(
    viewer: string,
    scope: Scope,
    options: { before?: string | undefined; limit?: number } = {},
  ): Promise<PostView[]> {
    const f = needFiles(deps.files);
    const strangers = await seesStrangers(db, viewer);
    const met = sql`(select m.other_id from met_players m where m.account_id = ${viewer}::uuid)`;
    const where: SQL[] = [seesPost(viewer, strangers)];
    if (scope.kind === "captures")
      where.push(
        sql`(p.author_id = ${viewer}::uuid or p.author_id in ${friendIdsOf(viewer)}${
          strangers ? sql` or (p.visibility = 'public' and p.author_id in ${met})` : sql``
        })`,
      );
    if (scope.kind === "author") where.push(sql`p.author_id = ${scope.id}::uuid`);
    if (scope.kind === "game") where.push(sql`p.title_id = ${scope.titleId}`);
    if (scope.kind === "ids") {
      if (!scope.ids.length) return [];
      where.push(
        sql`p.id in (${sql.join(
          scope.ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    }
    if (options.before) where.push(sql`p.id < ${options.before}::uuid`);
    const rows = await db.execute<Row>(sql`select p.id, p.author_id, p.caption, p.title_id, p.visibility,
        p.comments_off, p.source, p.edited_at, p.created_at,
        (select count(*) from post_likes l join accounts la on la.id = l.account_id and la.status = 'active'
          where l.post_id = p.id and ${unblocked(viewer, sql`l.account_id`)})::int likes,
        exists (select 1 from post_likes l where l.post_id = p.id and l.account_id = ${viewer}::uuid) liked,
        (select count(*) from post_comments c where c.post_id = p.id and ${commentShown(viewer)})::int comments
      from posts p where ${sql.join(where, sql` and `)}
      order by p.id desc limit ${options.limit ?? 30}`);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const pictures = await db
      .select({ postId: postMedia.postId, row: media })
      .from(postMedia)
      .innerJoin(media, eq(media.id, postMedia.mediaId))
      .where(inArray(postMedia.postId, ids))
      .orderBy(postMedia.position);
    const titleIds = [...new Set(rows.flatMap((r) => (r.title_id ? [r.title_id] : [])))];
    const gameOf = new Map(
      (titleIds.length ? await db.select().from(games).where(inArray(games.titleId, titleIds)) : []).map(
        (g) => [g.titleId, g],
      ),
    );
    const cards = await who.cards(rows.map((r) => r.author_id));
    return rows.flatMap((r): PostView[] => {
      const author = cards.get(r.author_id);
      if (!author) return [];
      const mine = r.author_id === viewer;
      const shown = pictures
        .filter((p) => p.postId === r.id && (mine || p.row.status === "active"))
        .map(({ row }): PostMedia => {
          const view = mediaOf.view(f, row, { owner: mine });
          return {
            id: row.id,
            kind: row.kind as "image" | "clip",
            width: row.width,
            height: row.height,
            durationMs: row.durationMs,
            url: view.url,
            thumb: view.thumb,
            poster: view.poster,
            ...(view.hidden ? { hidden: true } : {}),
          };
        });
      const game = r.title_id ? gameOf.get(r.title_id) : undefined;
      return [
        {
          id: r.id,
          author,
          caption: r.caption,
          game: r.title_id
            ? { titleId: r.title_id, names: game?.names ?? {}, iconUrl: game?.iconUrl ?? null }
            : null,
          visibility: r.visibility,
          commentsOff: r.comments_off,
          media: shown,
          likes: Number(r.likes),
          liked: Boolean(r.liked),
          comments: Number(r.comments),
          mine,
          source: r.source,
          createdAt: iso(r.created_at),
          editedAt: r.edited_at ? iso(r.edited_at) : null,
        },
      ];
    });
  }

  const one = async (viewer: string, id: string) => {
    if (!(await visiblePost(db, viewer, id))) throw notFound();
    const [view] = await read(viewer, { kind: "ids", ids: [id] });
    if (!view) throw notFound();
    return view;
  };

  /** The author's own post, as written (404 for anyone else). */
  const own = async (me: string, id: string) => {
    const post = await visiblePost(db, me, id);
    if (!post || post.authorId !== me) throw notFound();
    return post;
  };

  /** Tells the author's friends who may see the post (all of them: a friend sees both kinds). */
  async function fanOut(post: PostRow, event: "new" | "removed") {
    const friends = await valkey.smembers(friendsKey(post.authorId));
    for (const friend of friends) {
      if (event === "removed") {
        await publish(valkey, friend, { type: "post.removed", data: { postId: post.id } });
        continue;
      }
      const [view] = await read(friend, { kind: "ids", ids: [post.id] });
      if (view) await publish(valkey, friend, { type: "post.new", data: view });
    }
  }

  /** Tells the author the counts as they see them now. */
  async function countsChanged(post: Pick<PostRow, "id" | "authorId">) {
    const [view] = await read(post.authorId, { kind: "ids", ids: [post.id] });
    if (view)
      await publish(valkey, post.authorId, {
        type: "post.counts",
        data: { postId: post.id, likes: view.likes, comments: view.comments },
      });
    return view;
  }

  /** Comments as `viewer` sees them: top-level ones, newest first, with their replies. */
  async function comments(
    viewer: string,
    post: PostRow,
    options: { before?: string | undefined; limit: number },
  ): Promise<CommentPage> {
    const top = await db.execute<CommentSqlRow>(sql`select c.id, c.post_id, c.author_id, c.parent_id, c.text,
        c.created_at from post_comments c
      where c.post_id = ${post.id}::uuid and c.parent_id is null and ${commentShown(viewer)}
        ${options.before ? sql`and c.id < ${options.before}::uuid` : sql``}
      order by c.id desc limit ${options.limit}`);
    const replies = top.length
      ? await db.execute<CommentSqlRow>(sql`select c.id, c.post_id, c.author_id, c.parent_id, c.text,
          c.created_at from post_comments c
        where c.parent_id in (${sql.join(
          top.map((t) => sql`${t.id}::uuid`),
          sql`, `,
        )}) and ${commentShown(viewer)}
        order by c.id asc`)
      : [];
    const cards = await who.cards([...top, ...replies].map((c) => c.author_id));
    const view = (c: CommentSqlRow): CommentView | null => {
      const author = cards.get(c.author_id);
      if (!author) return null;
      return {
        id: c.id,
        postId: c.post_id,
        author,
        text: c.text,
        replyTo: c.parent_id,
        createdAt: iso(c.created_at),
        canDelete: c.author_id === viewer || post.authorId === viewer,
      };
    };
    const items = top.flatMap((t) => {
      const shown = view(t);
      if (!shown) return [];
      const under = replies.filter((r) => r.parent_id === t.id).flatMap((r) => view(r) ?? []);
      return [{ ...shown, replies: under }];
    });
    return { items, next: top.length === options.limit ? (top[top.length - 1]?.id ?? null) : null };
  }

  return { read, one, own, fanOut, countsChanged, comments };
}

export type PostService = ReturnType<typeof postService>;

/** POST/PATCH/DELETE /posts, the Captures feed, a profile's and a game's posts, likes, comments. */
export function postRoutes(deps: Deps, notes: Notifier, mediaOf: MediaService) {
  const app = new Hono<{ Variables: AuthVariables }>();
  for (const path of ["/posts", "/posts/*", "/me/captures", "/users/:handle/posts", "/games/:titleId/posts"])
    app.use(path, requireUser(deps));
  const { db } = deps;
  const service = postService(deps, notes, mediaOf);
  const family = familyGuard(db);
  const limit = rateLimiter(deps.valkey, deps.limits);

  /** A caption or comment may not link to a domain on the deny-list. */
  const allowedText = (text: string) => {
    const domain = blockedLink(text, deps.blockedLinkDomains ?? []);
    if (domain)
      throw new HttpError(400, ErrorCode.linkBlocked, `Links to ${domain} are not allowed`, { domain });
  };

  /** A child's posts are for friends only (their profile never shows past friends). */
  const childPublic = async (me: string) => {
    if (await family.rulesOf(me))
      throw restricted("profile_visibility", "Your family settings keep your posts to friends");
  };

  app.post("/posts", async (c) => {
    const me = c.get("userId");
    needFiles(deps.files);
    const input = await body(c, PostCreate);
    await assertNotMuted(db, me);
    await family.need(me, "media_sharing", "Your family settings keep sharing screenshots and clips off");
    if (input.visibility === "public") await childPublic(me);
    await limit("post", me);
    const caption = input.caption?.trim() || null;
    if (caption) allowedText(caption);
    if (new Set(input.media).size !== input.media.length)
      throw new HttpError(400, ErrorCode.badRequest, "media: each one once");
    const rows = await db
      .select()
      .from(media)
      .where(and(inArray(media.id, input.media), eq(media.accountId, me), eq(media.status, "active")));
    if (rows.length !== input.media.length)
      throw new HttpError(400, ErrorCode.badRequest, "media: only your own photos and clips, uploaded first");
    const clips = rows.filter((r) => r.kind === "clip");
    if (rows.some((r) => r.kind === "voice") || (clips.length && rows.length > 1))
      throw new HttpError(400, ErrorCode.badRequest, "media: one to four pictures, or one clip");
    const clip = clips[0];
    if (clip?.durationMs && clip.durationMs > postLimits.clipMs + 500)
      throw new HttpError(
        400,
        ErrorCode.badMedia,
        `A clip in a post is at most ${postLimits.clipMs / 1000} seconds`,
        {
          maxMs: postLimits.clipMs,
          maxBytes: mediaLimits.clip,
        },
      );
    const [profile] = await db
      .select({ privacy: profiles.privacy, publicProfile: profiles.publicProfile })
      .from(profiles)
      .where(eq(profiles.accountId, me));
    const child = Boolean(await family.rulesOf(me));
    const visibility: PostVisibility = child
      ? "friends"
      : (input.visibility ?? defaultPostVisibility(shownPrivacy(profile?.privacy, profile?.publicProfile)));
    const id = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(posts).values({
        id,
        authorId: me,
        caption,
        titleId: input.titleId ?? null,
        visibility,
        commentsOff: input.commentsOff ?? false,
        source: input.source ?? null,
      });
      await tx
        .insert(postMedia)
        .values(input.media.map((mediaId, position) => ({ postId: id, mediaId, position })));
      await tx
        .update(media)
        .set({ usedAt: sql`coalesce(${media.usedAt}, now())` })
        .where(inArray(media.id, input.media));
    });
    const view = await service.one(me, id);
    const [row] = await db.select().from(posts).where(eq(posts.id, id));
    if (row) await service.fanOut(row, "new");
    return c.json(view, 201);
  });

  app.get("/posts/:id", async (c) => c.json(await service.one(c.get("userId"), c.req.param("id"))));

  app.patch("/posts/:id", async (c) => {
    const me = c.get("userId");
    const post = await service.own(me, c.req.param("id"));
    const input = await body(c, PostUpdate);
    if (input.visibility === "public") await childPublic(me);
    const changes: Partial<typeof posts.$inferInsert> = {};
    if (input.caption !== undefined) {
      const caption = input.caption?.trim() || null;
      if (caption) {
        await assertNotMuted(db, me);
        allowedText(caption);
      }
      if (caption !== post.caption) {
        changes.caption = caption;
        changes.editedAt = new Date();
      }
    }
    if (input.visibility) changes.visibility = input.visibility;
    if (input.commentsOff !== undefined) changes.commentsOff = input.commentsOff;
    if (Object.keys(changes).length) await db.update(posts).set(changes).where(eq(posts.id, post.id));
    return c.json(await service.one(me, post.id));
  });

  app.delete("/posts/:id", async (c) => {
    const me = c.get("userId");
    const post = await service.own(me, c.req.param("id"));
    const used = await db
      .select({ id: postMedia.mediaId })
      .from(postMedia)
      .where(eq(postMedia.postId, post.id));
    await db.delete(posts).where(eq(posts.id, post.id));
    await mediaOf.releaseUnused(
      me,
      used.map((u) => u.id),
    );
    await service.fanOut(post, "removed");
    return c.body(null, 204);
  });

  /** The Captures feed: one's own posts, friends' posts, and public posts of people one played
   *  with. */
  app.get("/me/captures", async (c) => {
    const options = paging((name) => c.req.query(name));
    const items = await service.read(c.get("userId"), { kind: "captures" }, options);
    return c.json(pageOf(items, options.limit));
  });

  app.get("/users/:handle/posts", async (c) => {
    const me = c.get("userId");
    const options = paging((name) => c.req.query(name));
    const owner = await findProfile(db, c.req.param("handle"));
    if (!owner || (owner.accountId !== me && (await blockedBetween(db, me, owner.accountId))))
      throw new HttpError(404, ErrorCode.notFound, "No one with that handle");
    const items = await service.read(me, { kind: "author", id: owner.accountId }, options);
    return c.json(pageOf(items, options.limit));
  });

  app.get("/games/:titleId/posts", async (c) => {
    const titleId = c.req.param("titleId");
    if (!TitleId.safeParse(titleId).success) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const options = paging((name) => c.req.query(name));
    const items = await service.read(c.get("userId"), { kind: "game", titleId }, options);
    return c.json(pageOf(items, options.limit));
  });

  // Likes.

  const likeAnswer = async (me: string, id: string) => {
    const view = await service.one(me, id);
    return { likes: view.likes, liked: view.liked };
  };

  app.put("/posts/:id/like", async (c) => {
    const me = c.get("userId");
    const post = await visiblePost(db, me, c.req.param("id"));
    if (!post) throw notFound();
    await limit("postLike", me);
    const [added] = await db
      .insert(postLikes)
      .values({ postId: post.id, accountId: me })
      .onConflictDoNothing()
      .returning();
    if (added) {
      const view = await service.countsChanged(post);
      if (view && post.authorId !== me)
        // One notification per post while it is unread: the latest liker, and how many like it.
        await notes.notify(post.authorId, {
          kind: "post_like",
          actorId: me,
          subjectId: post.id,
          data: { postId: post.id, count: view.likes - (view.liked ? 1 : 0) },
        });
    }
    return c.json(await likeAnswer(me, post.id));
  });

  app.delete("/posts/:id/like", async (c) => {
    const me = c.get("userId");
    const post = await visiblePost(db, me, c.req.param("id"));
    if (!post) throw notFound();
    await limit("postLike", me);
    const removed = await db
      .delete(postLikes)
      .where(and(eq(postLikes.postId, post.id), eq(postLikes.accountId, me)))
      .returning();
    if (removed.length) await service.countsChanged(post);
    return c.json(await likeAnswer(me, post.id));
  });

  /** Who liked it, as the reader may see them: the post's author sees everyone; anyone else
   *  themselves, their friends, and anyone whose search setting lets everyone find them; the rest
   *  are counted. Never anyone across a block. */
  app.get("/posts/:id/likes", async (c) => {
    const me = c.get("userId");
    const post = await visiblePost(db, me, c.req.param("id"));
    if (!post) throw notFound();
    const { before, limit: size } = paging((name) => c.req.query(name));
    const rows = await db.execute<{ account_id: string; shown: boolean }>(sql`select l.account_id,
        (${post.authorId === me} or l.account_id = ${me}::uuid or l.account_id in ${friendIdsOf(me)}
          or coalesce(pr.privacy ->> 'search', 'everyone') = 'everyone') shown
      from post_likes l
      join accounts a on a.id = l.account_id and a.status = 'active'
      join profiles pr on pr.account_id = l.account_id
      where l.post_id = ${post.id}::uuid and ${unblocked(me, sql`l.account_id`)}
      order by l.created_at desc, l.account_id desc`);
    const shown = rows.filter((r) => r.shown).map((r) => r.account_id);
    const from = before ? shown.indexOf(before) + 1 : 0;
    const slice = shown.slice(from, from + size);
    const cards = await people(db).cards(slice);
    const items = slice.flatMap((id) => cards.get(id) ?? []) as MemberView[];
    const answer: LikesPage = {
      items,
      next: from + size < shown.length ? (slice[slice.length - 1] ?? null) : null,
      hidden: rows.length - shown.length,
    };
    return c.json(answer);
  });

  // Comments.

  app.get("/posts/:id/comments", async (c) => {
    const me = c.get("userId");
    const post = await visiblePost(db, me, c.req.param("id"));
    if (!post) throw notFound();
    const options = paging((name) => c.req.query(name));
    return c.json(await service.comments(me, post, options));
  });

  app.post("/posts/:id/comments", async (c) => {
    const me = c.get("userId");
    const post = await visiblePost(db, me, c.req.param("id"));
    if (!post) throw notFound();
    const input = await body(c, CommentCreate);
    await assertNotMuted(db, me);
    // A child comments only where friends read, and only on posts of people they may message.
    if (post.authorId !== me && (await family.rulesOf(me))) {
      if (post.visibility === "public")
        throw restricted("profile_visibility", "Your family settings keep your comments to friends' posts");
      await family.mayMessage(me, [post.authorId]);
    }
    if (post.commentsOff) throw new HttpError(403, ErrorCode.commentsOff, "Comments are off for this post");
    allowedText(input.text);
    let parent: { id: string; authorId: string } | null = null;
    if (input.replyTo) {
      const found = await visibleComment(db, me, input.replyTo);
      if (!found || found.post.id !== post.id)
        throw new HttpError(404, ErrorCode.notFound, "No such comment");
      if (found.comment.parentId)
        throw new HttpError(
          400,
          ErrorCode.badRequest,
          "replyTo: a top-level comment (replies are one level)",
        );
      const [{ n } = { n: 0 }] = await db.execute<{ n: number }>(
        sql`select count(*)::int n from post_comments where parent_id = ${found.comment.id}::uuid`,
      );
      if (Number(n) >= postLimits.replies)
        throw new HttpError(409, ErrorCode.conflict, `At most ${postLimits.replies} replies`);
      parent = { id: found.comment.id, authorId: found.comment.authorId };
    }
    await limit("postComment", me);
    const [made] = await db
      .insert(postComments)
      .values({ id: uuidv7(), postId: post.id, authorId: me, parentId: parent?.id ?? null, text: input.text })
      .returning();
    if (!made) throw new Error("comment not stored");
    await service.countsChanged(post);
    const text = snippet(input.text);
    // The one answered hears of it only while they may still see the post.
    if (parent && parent.authorId !== me && (await visiblePost(db, parent.authorId, post.id)))
      await notes.notify(parent.authorId, {
        kind: "comment_reply",
        actorId: me,
        subjectId: parent.id,
        data: { postId: post.id, commentId: parent.id, text },
      });
    if (post.authorId !== me && post.authorId !== parent?.authorId)
      await notes.notify(post.authorId, {
        kind: "post_comment",
        actorId: me,
        subjectId: post.id,
        data: { postId: post.id, text },
      });
    const author = await people(db).card(me);
    const view: CommentView = {
      id: made.id,
      postId: post.id,
      author: author as MemberView,
      text: made.text,
      replyTo: made.parentId,
      createdAt: made.createdAt.toISOString(),
      canDelete: true,
      ...(made.parentId ? {} : { replies: [] }),
    };
    return c.json(view, 201);
  });

  /** Its author deletes a comment, or the post's author any comment on it; a top-level comment
   *  takes its replies with it. */
  app.delete("/posts/:id/comments/:commentId", async (c) => {
    const me = c.get("userId");
    const found = await visibleComment(db, me, c.req.param("commentId"));
    if (!found || found.post.id !== c.req.param("id"))
      throw new HttpError(404, ErrorCode.notFound, "No such comment");
    if (found.comment.authorId !== me && found.post.authorId !== me)
      throw new HttpError(404, ErrorCode.notFound, "No such comment");
    await db.delete(postComments).where(eq(postComments.id, found.comment.id));
    await service.countsChanged(found.post);
    return c.body(null, 204);
  });

  return Object.assign(app, { service });
}

const pageOf = (items: PostView[], count: number): PostPage => ({
  items,
  next: items.length === count ? (items[items.length - 1]?.id ?? null) : null,
});

/** The account's own posts, comments and likes, for the data export. */
export async function postsExport(db: Deps["db"], accountId: string) {
  const own = await db.select().from(posts).where(eq(posts.authorId, accountId)).orderBy(posts.id);
  const pictures = own.length
    ? await db
        .select()
        .from(postMedia)
        .where(
          inArray(
            postMedia.postId,
            own.map((p) => p.id),
          ),
        )
        .orderBy(postMedia.position)
    : [];
  return {
    posts: own.map((p) => ({
      id: p.id,
      caption: p.caption,
      titleId: p.titleId,
      visibility: p.visibility,
      commentsOff: p.commentsOff,
      source: p.source,
      status: p.status,
      media: pictures.filter((m) => m.postId === p.id).map((m) => m.mediaId),
      createdAt: p.createdAt,
      editedAt: p.editedAt,
    })),
    postComments: (
      await db
        .select()
        .from(postComments)
        .where(eq(postComments.authorId, accountId))
        .orderBy(postComments.id)
    ).map((c) => ({ id: c.id, postId: c.postId, replyTo: c.parentId, text: c.text, createdAt: c.createdAt })),
    postLikes: (await db.select().from(postLikes).where(eq(postLikes.accountId, accountId))).map((l) => ({
      postId: l.postId,
      createdAt: l.createdAt,
    })),
  };
}
