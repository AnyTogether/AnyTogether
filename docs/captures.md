# Captures: the API for clients

Players share screenshots and clips as posts; the people who may see a post like it and comment
on it. Every call needs a signed-in user (`401` otherwise) and cloud storage on the server
(`503 storage_disabled` otherwise, see `GET /storage`). Types are in
`packages/shared/src/posts.ts`.

## Making a post

1. Upload each picture or the clip: `POST /me/media?kind=image|clip` (see `cloud-storage.md`;
   pictures are re-encoded without metadata, clips are checked). For a clip, `PUT
   /me/media/{id}/poster` with a still is a good idea.
2. `POST /posts`:

```json
{ "media": ["<media id>", "..."], "caption": "optional, up to 500", "titleId": "PPSA01234",
  "visibility": "friends" | "public", "commentsOff": false, "source": "launcher" | "phone" | "web" }
```

- `media`: one to four pictures, or one clip of at most 60 s (`postLimits.clipMs`) and
  `mediaLimits.clip` bytes, all the author's own and active. Anything else is `400`.
- `caption`: the same rules as messages: `400 link_blocked` for a link to a blocked domain,
  `403 account_muted` while muted.
- `titleId`: the game the capture is from. A launcher fills it in from the capture.
- `visibility`: left out, it follows the gallery privacy setting (`public` when the gallery is
  open to everyone, `friends` otherwise).
- `→ 201 PostView`. Rate limited (`429` with `Retry-After`).

A child (family) needs the parent's "Sharing screenshots and clips" (`mediaSharing`), and posts
for friends only: `403 restricted_by_family` otherwise.

`PostView` is `{id, author, caption, game: {titleId, names, iconUrl} | null, visibility,
commentsOff, media: [{id, kind: image|clip, width, height, durationMs, url, thumb, poster}],
likes, liked, comments, mine, source, createdAt, editedAt}`. Media links are signed and work 12
to 24 hours: read again rather than keep them.

`PATCH /posts/{id}` (the author): `{caption?: string | null, visibility?, commentsOff?}` →
`PostView`. `DELETE /posts/{id}` → `204`; media only that post used is deleted with it.

## Reading

All newest first, `?before=<last id>&limit=<1-50>` (30 by default), answering `{items, next}`;
`next` is null at the end.

- `GET /me/captures`: one's own posts, friends' posts, and public posts of people one played with
  (`/me/players-met`).
- `GET /users/{handle}/posts`: someone's posts the reader may see (public ones only for a
  non-friend). `404` across a block.
- `GET /games/{titleId}/posts`: the game's posts the reader may see (public ones, and friends').
- `GET /posts/{id}`: one post, `404` when the reader may not see it.

Who sees what is decided by the server on every read: a friends-only post reaches the author and
the author's friends only; nothing crosses a block; a removed post (moderator) is gone for everyone.
A child whose family keeps discovery off sees no strangers' posts.

## Likes

`PUT /posts/{id}/like`, `DELETE /posts/{id}/like` → `{likes, liked}`. `GET /posts/{id}/likes` →
`{items: [MemberView], next, hidden}`: the likers the reader may see (themselves, friends, and
anyone whose search setting is everyone), and how many others there are.

## Comments

- `GET /posts/{id}/comments` → `{items, next}`: top-level comments newest first, each with
  `replies` (oldest first). A comment is `{id, postId, author, text, replyTo, createdAt,
  canDelete}`.
- `POST /posts/{id}/comments {text, replyTo?}` → `201 CommentView`. `replyTo` is a top-level
  comment (replies are one level: `400` otherwise). `403 comments_off` when the author turned
  them off. Plain text up to 500; the same link and mute rules as captions.
- `DELETE /posts/{id}/comments/{commentId}` → `204`: one's own comment, or any comment on one's
  own post. A top-level comment takes its replies with it.

## Reports

`POST /reports {targetKind: "post" | "comment", targetId, reason, note?}`. Moderators can
`remove_post` and `remove_comment` from the admin page.

## Notifications and events

Notifications (each can be turned off in the settings): `post_like` (one per post while unread:
the latest liker, `data.count` how many others like it), `post_comment` (gathers, `data.count`,
`data.text`), `comment_reply` (gathers per comment answered). `data.postId` is always there; the
website opens `/p/{postId}`.

Realtime events: `post.new` (a `PostView`, to the author's friends), `post.removed`
(`{postId}`), and `post.counts` (`{postId, likes, comments}`, to the author).
