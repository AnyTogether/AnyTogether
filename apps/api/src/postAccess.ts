import { type Database, postComments, posts } from "@anytogether/db";
import { type SQL, eq, sql } from "drizzle-orm";
import { childRulesOf } from "./family.js";

type Querier = Parameters<typeof childRulesOf>[0];
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Who may see a capture post, as SQL over an alias `p` of posts. Every place a post or what hangs
 *  off it (its media, likes, comments) is read goes through `seesPost`, so a friends-only post can
 *  only reach the author and the author's friends, and nothing crosses a block. */

/** The reader's accepted friends. */
export const friendIdsOf = (viewer: string) => sql`(select case when f.user_a = ${viewer}::uuid then f.user_b
  else f.user_a end from friendships f
  where f.state = 'accepted' and (f.user_a = ${viewer}::uuid or f.user_b = ${viewer}::uuid))`;

/** Neither of the two blocked the other (`other` is a column). */
export const unblocked = (viewer: string, other: SQL) =>
  sql`not exists (select 1 from blocks b where (b.blocker = ${viewer}::uuid and b.blocked = ${other})
    or (b.blocker = ${other} and b.blocked = ${viewer}::uuid))`;

/** `viewer` may see post `p`: it stands (a moderator did not remove it) and it is theirs; or its
 *  author is in good standing, something is left to show, no block lies between them, and it is a
 *  friend's or (when the reader may see strangers' posts) public. A child whose family keeps
 *  discovery off sees no strangers' posts. */
export const seesPost = (viewer: string, strangers: boolean) => sql`(p.status = 'active' and (
  p.author_id = ${viewer}::uuid or (
    exists (select 1 from accounts pa where pa.id = p.author_id and pa.status = 'active')
    and exists (select 1 from post_media pm join media m on m.id = pm.media_id
      where pm.post_id = p.id and m.status = 'active')
    and ${unblocked(viewer, sql`p.author_id`)}
    and (p.author_id in ${friendIdsOf(viewer)}${strangers ? sql` or p.visibility = 'public'` : sql``}))))`;

/** Whether the reader may see strangers' public posts: anyone but a child whose family keeps
 *  discovery off. */
export async function seesStrangers(db: Querier, viewer: string) {
  const rules = (await childRulesOf(db, [viewer])).get(viewer);
  return !rules || rules.discovery;
}

export type PostRow = typeof posts.$inferSelect;

/** The post, if `viewer` may see it now. */
export async function visiblePost(db: Database, viewer: string, id: string): Promise<PostRow | null> {
  if (!isId(id)) return null;
  const strangers = await seesStrangers(db, viewer);
  const [row] = await db.execute<{ id: string }>(
    sql`select p.id from posts p where p.id = ${id}::uuid and ${seesPost(viewer, strangers)}`,
  );
  if (!row) return null;
  return (await db.select().from(posts).where(eq(posts.id, id)))[0] ?? null;
}

/** SQL: comment `c` shows to `viewer`: its author (and, for a reply, the author of the comment it
 *  answers) is in good standing and not blocked either way. */
export const commentShown = (viewer: string) => sql`(
  exists (select 1 from accounts ca where ca.id = c.author_id and ca.status = 'active')
  and ${unblocked(viewer, sql`c.author_id`)}
  and (c.parent_id is null or exists (select 1 from post_comments pc
    join accounts pca on pca.id = pc.author_id and pca.status = 'active'
    where pc.id = c.parent_id and ${unblocked(viewer, sql`pc.author_id`)})))`;

export type CommentRow = typeof postComments.$inferSelect;

/** The comment and its post, if `viewer` may see both now. */
export async function visibleComment(db: Database, viewer: string, id: string) {
  if (!isId(id)) return null;
  const [comment] = await db.select().from(postComments).where(eq(postComments.id, id));
  if (!comment) return null;
  const post = await visiblePost(db, viewer, comment.postId);
  if (!post) return null;
  const [shown] = await db.execute<{ id: string }>(
    sql`select c.id from post_comments c where c.id = ${id}::uuid and ${commentShown(viewer)}`,
  );
  return shown ? { comment, post } : null;
}
