import { describe, expect, it } from "vitest";
import { postsEn, postsTr } from "../lib/i18n-posts";
import {
  type PostComment,
  clipLength,
  compactCount,
  pickProblem,
  postError,
  togglePick,
  toggledLike,
  withComment,
  withoutComment,
} from "../lib/posts";

type Pick = { id: string; kind: "image" | "clip"; durationMs: number | null };
const image = (id: string): Pick => ({ id, kind: "image", durationMs: null });
const clip = (id: string, seconds = 10): Pick => ({ id, kind: "clip", durationMs: seconds * 1000 });
const person = { userId: "u", handle: "utku", displayName: "Utku", avatar: null };
const comment = (id: string, replyTo: string | null = null, replies?: PostComment[]): PostComment => ({
  id,
  postId: "p",
  author: person,
  text: id,
  replyTo,
  createdAt: "2026-10-26T12:00:00Z",
  canDelete: true,
  ...(replies ? { replies } : {}),
});

describe("what a post may hold", () => {
  it("takes one to four pictures or one clip up to a minute", () => {
    expect(pickProblem([])).toBe("empty");
    expect(pickProblem([image("a")])).toBeNull();
    expect(pickProblem(["a", "b", "c", "d"].map(image))).toBeNull();
    expect(pickProblem(["a", "b", "c", "d", "e"].map(image))).toBe("tooMany");
    expect(pickProblem([clip("a")])).toBeNull();
    expect(pickProblem([clip("a"), image("b")])).toBe("mixed");
    expect(pickProblem([clip("a"), clip("b")])).toBe("oneClip");
    expect(pickProblem([clip("a", 60)])).toBeNull();
    expect(pickProblem([clip("a", 61)])).toBe("clipTooLong");
    expect(pickProblem([{ kind: "voice", durationMs: 3000 }])).toBe("mixed");
  });

  it("keeps the picked list to what a post may hold as one taps", () => {
    let picked = togglePick([], image("a"));
    picked = togglePick(picked, image("b"));
    expect(picked.map((p) => p.id)).toEqual(["a", "b"]);
    // A clip replaces the pictures; a picture then replaces the clip.
    picked = togglePick(picked, clip("c"));
    expect(picked.map((p) => p.id)).toEqual(["c"]);
    picked = togglePick(picked, image("d"));
    expect(picked.map((p) => p.id)).toEqual(["d"]);
    for (const id of ["e", "f", "g", "h"]) picked = togglePick(picked, image(id));
    expect(picked.map((p) => p.id)).toEqual(["d", "e", "f", "g"]);
    expect(togglePick(picked, image("e")).map((p) => p.id)).toEqual(["d", "f", "g"]);
  });
});

describe("post helpers", () => {
  it("flips a like at once and never counts below zero", () => {
    expect(toggledLike({ likes: 3, liked: false })).toEqual({ likes: 4, liked: true });
    expect(toggledLike({ likes: 4, liked: true })).toEqual({ likes: 3, liked: false });
    expect(toggledLike({ likes: 0, liked: true })).toEqual({ likes: 0, liked: false });
  });

  it("writes counts and clip lengths short", () => {
    expect(compactCount(999, "en")).toBe("999");
    expect(compactCount(1234, "en")).toBe("1.2K");
    expect(clipLength(7000)).toBe("0:07");
    expect(clipLength(60_000)).toBe("1:00");
    expect(clipLength(null)).toBeNull();
  });

  it("puts new comments where the thread shows them, and takes them out with their replies", () => {
    const thread = [comment("b", null, []), comment("a", null, [comment("a1", "a")])];
    const withTop = withComment(thread, comment("c"));
    expect(withTop.map((c) => c.id)).toEqual(["c", "b", "a"]);
    const withReply = withComment(thread, comment("a2", "a"));
    expect(withReply[1]?.replies?.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(withoutComment(withReply, "a")).toMatchObject({ removed: 3 });
    const one = withoutComment(withReply, "a1");
    expect(one.removed).toBe(1);
    expect(one.items[1]?.replies?.map((r) => r.id)).toEqual(["a2"]);
  });

  it("names every refusal with a text that exists in both languages", () => {
    const codes = [
      "link_blocked",
      "account_muted",
      "restricted_by_family",
      "comments_off",
      "rate_limited",
      "bad_media",
    ];
    for (const code of codes) {
      const key = postError(code, 400);
      expect(key in postsEn, key).toBe(true);
      expect(key in postsTr, key).toBe(true);
    }
    expect(postError(undefined, 429)).toBe("capTooFast");
    expect(postError(undefined, 500)).toBe("failed");
  });

  it("has the same texts in English and Turkish", () => {
    expect(Object.keys(postsTr).sort()).toEqual(Object.keys(postsEn).sort());
  });
});
