import type { GameCard } from "./feed";
import type { Person } from "./people";
import type { MediaItem } from "./storage";

/** Capture posts as the API shows them (the website keeps its own copy of the shapes; the server's
 *  are in packages/shared/src/posts.ts), and the small rules the composer checks before posting. */

export type PostVisibility = "friends" | "public";

export interface PostMedia {
  id: string;
  kind: "image" | "clip";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  thumb: string | null;
  poster: string | null;
  hidden?: boolean;
}

export interface Post {
  id: string;
  author: Person;
  caption: string | null;
  game: GameCard | null;
  visibility: PostVisibility;
  commentsOff: boolean;
  media: PostMedia[];
  likes: number;
  liked: boolean;
  comments: number;
  mine: boolean;
  source: "web" | "launcher" | "phone" | null;
  createdAt: string;
  editedAt: string | null;
}

export interface PostPage {
  items: Post[];
  next: string | null;
}

export interface PostComment {
  id: string;
  postId: string;
  author: Person;
  text: string;
  replyTo: string | null;
  createdAt: string;
  canDelete: boolean;
  replies?: PostComment[];
}

export interface CommentPage {
  items: PostComment[];
  next: string | null;
}

export interface LikesPage {
  items: Person[];
  next: string | null;
  hidden: number;
}

export const postLimits = {
  images: 4,
  clipMs: 60_000,
  clipBytes: 25 * 1024 * 1024,
  caption: 500,
  comment: 500,
};

/** What may go in one post, from the chosen media: one to four pictures, or one clip of at most a
 *  minute. Returns why not, or null when it is fine. */
export function pickProblem(
  picked: Pick<MediaItem, "kind" | "durationMs">[],
): "empty" | "mixed" | "tooMany" | "oneClip" | "clipTooLong" | null {
  if (!picked.length) return "empty";
  const clips = picked.filter((m) => m.kind === "clip");
  if (picked.some((m) => m.kind !== "image" && m.kind !== "clip")) return "mixed";
  if (clips.length && picked.length > 1) return clips.length > 1 ? "oneClip" : "mixed";
  if (picked.length > postLimits.images) return "tooMany";
  const clip = clips[0];
  if (clip?.durationMs && clip.durationMs > postLimits.clipMs + 500) return "clipTooLong";
  return null;
}

/** Adds or takes away one item from the picked list, keeping the rule a post has: picking a clip
 *  replaces everything, picking a picture drops a clip, and at most four pictures. */
export function togglePick<T extends { id: string; kind: string }>(picked: T[], item: T): T[] {
  if (picked.some((p) => p.id === item.id)) return picked.filter((p) => p.id !== item.id);
  if (item.kind === "clip") return [item];
  const pictures = picked.filter((p) => p.kind === "image");
  return pictures.length >= postLimits.images ? pictures : [...pictures, item];
}

/** The like as it changes on a tap, before the server answers. */
export const toggledLike = (post: Pick<Post, "likes" | "liked">) => ({
  liked: !post.liked,
  likes: Math.max(0, post.likes + (post.liked ? -1 : 1)),
});

/** A count as people read it: 999, 1.2K, 3.4M (in the reader's language). */
export const compactCount = (n: number, language: string) =>
  new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** A clip's length as the badge shows it: 0:07, 1:00. */
export function clipLength(ms: number | null | undefined) {
  if (!ms) return null;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Puts a just-written comment where the thread shows it: a reply under its comment (oldest first),
 *  a top-level one first (newest first). */
export function withComment(items: PostComment[], made: PostComment): PostComment[] {
  if (!made.replyTo) return [{ ...made, replies: made.replies ?? [] }, ...items];
  return items.map((c) => (c.id === made.replyTo ? { ...c, replies: [...(c.replies ?? []), made] } : c));
}

/** Takes a comment (or a reply) out of the thread; a top-level one takes its replies with it.
 *  Returns the new list and how many comments went. */
export function withoutComment(items: PostComment[], id: string): { items: PostComment[]; removed: number } {
  const top = items.find((c) => c.id === id);
  if (top) return { items: items.filter((c) => c.id !== id), removed: 1 + (top.replies?.length ?? 0) };
  let removed = 0;
  const next = items.map((c) => {
    const replies = c.replies ?? [];
    if (!replies.some((r) => r.id === id)) return c;
    removed = 1;
    return { ...c, replies: replies.filter((r) => r.id !== id) };
  });
  return { items: next, removed };
}

/** Why a post or comment did not go through, as a key of the texts. */
export function postError(code: string | undefined, status: number) {
  if (code === "link_blocked") return "capLinkBlocked";
  if (code === "account_muted") return "capMuted";
  if (code === "restricted_by_family") return "capFamily";
  if (code === "comments_off") return "capCommentsOff";
  if (code === "rate_limited" || status === 429) return "capTooFast";
  if (code === "bad_media") return "capBadMedia";
  if (code === "quota_exceeded") return "quotaFull";
  return "failed";
}
