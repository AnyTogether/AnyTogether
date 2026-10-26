import { z } from "zod";
import { TitleId } from "./games.js";
import type { MemberView } from "./messages.js";
import type { Privacy } from "./profile.js";

/** Captures: screenshots and clips players share as posts, liked and commented on by the people
 *  who may see them. A post holds one to four pictures, or one clip, uploaded first as media
 *  (POST /me/media, checked and re-encoded there). */

/** friends: the author's friends (and the author); public: anyone signed in who is not blocked
 *  either way. A child's posts are always friends only. */
export const postVisibilities = ["friends", "public"] as const;
export type PostVisibility = (typeof postVisibilities)[number];

export const postLimits = {
  /** Pictures in one post. */
  images: 4,
  /** The longest clip a post takes (a clip is at most mediaLimits.clip bytes). */
  clipMs: 60_000,
  caption: 500,
  comment: 500,
  /** Replies under one comment. */
  replies: 100,
} as const;

/** Where a post was made from: the website, a launcher's captures gallery or the phone. */
export const postSources = ["web", "launcher", "phone"] as const;
export type PostSource = (typeof postSources)[number];

/** A new post's visibility when none is sent: the gallery setting's (public when the gallery is
 *  open to everyone, friends otherwise). */
export const defaultPostVisibility = (privacy: Privacy): PostVisibility =>
  privacy.gallery === "everyone" ? "public" : "friends";

const Caption = z.string().trim().max(postLimits.caption, `at most ${postLimits.caption} characters`);

/** POST /posts. `media` are the author's own photos or one clip, in the order shown. */
export const PostCreate = z.object({
  media: z.array(z.string().uuid()).min(1).max(postLimits.images),
  caption: Caption.optional(),
  /** The game the capture is from; launchers fill it in from the capture. */
  titleId: TitleId.optional(),
  visibility: z.enum(postVisibilities).optional(),
  commentsOff: z.boolean().optional(),
  source: z.enum(postSources).optional(),
});
export type PostCreate = z.infer<typeof PostCreate>;

/** PATCH /posts/:id (the author only): only what is sent changes; a caption of null or "" clears it. */
export const PostUpdate = z
  .object({
    caption: Caption.nullable().optional(),
    visibility: z.enum(postVisibilities).optional(),
    commentsOff: z.boolean().optional(),
  })
  .strict();

/** POST /posts/:id/comments: plain text, and the top-level comment it answers (one level only). */
export const CommentCreate = z.object({
  text: z.string().trim().min(1, "say something").max(postLimits.comment),
  replyTo: z.string().uuid().optional(),
});

export interface PostMedia {
  id: string;
  kind: "image" | "clip";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Signed links, working 12 to 24 hours: read the post again rather than keep them. */
  url: string;
  thumb: string | null;
  poster: string | null;
  /** Hidden by a moderator: shown to its owner alone. */
  hidden?: boolean;
}

export interface PostView {
  id: string;
  author: MemberView;
  caption: string | null;
  game: { titleId: string; names: Record<string, string>; iconUrl: string | null } | null;
  visibility: PostVisibility;
  commentsOff: boolean;
  media: PostMedia[];
  likes: number;
  liked: boolean;
  /** Comments and replies the reader may see. */
  comments: number;
  /** The reader wrote it: they may edit the caption, turn comments off and delete it. */
  mine: boolean;
  source: PostSource | null;
  createdAt: string;
  /** When the caption last changed; null when never. */
  editedAt: string | null;
}

export interface PostPage {
  items: PostView[];
  /** Pass as `before` for the next (older) page; null at the end. */
  next: string | null;
}

export interface CommentView {
  id: string;
  postId: string;
  author: MemberView;
  text: string;
  /** The top-level comment this answers; null for a top-level one. */
  replyTo: string | null;
  createdAt: string;
  /** The reader may delete it: its author, or the post's. */
  canDelete: boolean;
  /** A top-level comment's replies, oldest first. */
  replies?: CommentView[];
}

/** GET /posts/:id/comments: top-level comments newest first (with their replies), paged by
 *  `before`. */
export interface CommentPage {
  items: CommentView[];
  next: string | null;
}

/** GET /posts/:id/likes: the people who liked it that the reader may see (newest first), and how
 *  many more there are whom the reader may not see. */
export interface LikesPage {
  items: MemberView[];
  next: string | null;
  hidden: number;
}

/** Told to the author's friends who may see it when a post is made, and to the author when its
 *  likes or comments change. A removed post is told to the same friends. */
export type PostEvent =
  | { type: "post.new"; data: PostView }
  | { type: "post.counts"; data: { postId: string; likes: number; comments: number } }
  | { type: "post.removed"; data: { postId: string } };
