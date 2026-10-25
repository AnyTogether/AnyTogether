# Cloud saves and media: the API for clients

For the launchers, the phone app and anyone writing a client. Everything is under `/api/v1`, needs
`Authorization: Bearer <access token>` unless it says otherwise, and answers errors as problem
details with a stable `code` (see `packages/shared/src/errors.ts`). Shapes are in
`packages/shared/src/storage.ts` and `messages.ts`.

## Is it on?

`GET /storage` (no sign-in): `{"enabled": false}` on a server that keeps no files: hide every
cloud-save and media feature. When on:

```json
{ "enabled": true, "quota": 104857600, "saveMax": 52428800, "saveVersions": 3, "partSize": 4194304,
  "media": { "image": 10485760, "clip": 26214400, "voice": 1048576, "poster": 2097152, "voiceMs": 60000, "pixels": 40000000 },
  "galleryMax": 12 }
```

Any storage call on a server without storage answers `503 storage_disabled`.

## The quota

One quota per account for saves and media together. The same bytes are kept and counted once per
account. Anything that would pass it is refused before it is accepted:

```json
{ "status": 413, "code": "quota_exceeded", "used": 99614720, "limit": 104857600, "needed": 7340032 }
```

`GET /me/storage` gives `usage` (`{used, limit, saves, media}` in bytes), `limits`, every save slot
and the newest media (60; `GET /me/media?before=<last id>` for more).

## Cloud saves

A save is one archive (a zip) of a game's save slot. A slot keeps its newest three versions.

**List**: `GET /me/saves` (or `?titleId=CUSA12345`) →
`{usage, slots: [{id, titleId, game, slot, updatedAt, versions: [{id, version, size, sha256, device, launcherVersion, createdAt, download}]}]}`,
versions newest first. `download` is a signed link good for 1-2 hours that needs no token.

**Upload**, in parts so a big save survives a dropped connection:

1. `POST /me/saves/uploads`
   `{titleId, slot, size, sha256, device?, launcherVersion?, baseVersion?, replaceLatest?}`
   → `201 {uploadId, size, sha256, partSize, parts, received: [], expiresAt}`.
   Checked before any byte is sent: the size (`413 payload_too_large` past `saveMax`), the
   conflict hint and the quota. At most 3 unfinished uploads per account; one expires after a day.
2. `PUT /me/saves/uploads/{uploadId}/parts/{n}` for n = 1…parts, the bytes as the body
   (`application/octet-stream`), each `partSize` long but the last. In any order, several at
   once, again if unsure. Optional `X-Part-SHA256` (hex) is checked: `400 checksum_mismatch` means
   send that part again. → `{part, sha256, received}`.
3. Lost track? `GET /me/saves/uploads/{uploadId}` says which parts arrived.
4. `POST /me/saves/uploads/{uploadId}/complete` `{baseVersion?, replaceLatest?}` →
   `201 {save, version, dropped, unchanged, usage}`. Missing parts: `409 conflict {missing: [n…]}`.
   Bytes that do not hash to `sha256`: `400 checksum_mismatch` and the upload is dropped (start
   again). The same bytes as the newest version: `200` with `unchanged: true`, nothing stored.
5. `DELETE /me/saves/uploads/{uploadId}` gives up.

**Conflicts**: send `baseVersion`, the version number this device last downloaded or uploaded
(`0` when it never had one). If the cloud's newest is another, init or complete answers
`409 save_conflict` with `latest` (the newer version, with its device and time) so the player can
choose: keep the cloud's (download `latest.download`) or keep theirs (complete the same upload
again with `baseVersion: latest.version`; nothing is sent twice).

**Room**: dropping happens only inside the same slot. Past three versions the oldest goes
(`reason: "kept"`); when the quota needs room, older versions go next (`"quota"`). The slot's
newest is never dropped silently: if only replacing it makes room the answer is
`413 quota_exceeded` with `canReplace: true` and `latest`; ask the player, then complete with
`replaceLatest: true` (`"replaced"`). Other slots and media are never touched. `dropped` lists
`[{id, version, size, reason}]`.

**Download**: `GET /me/saves/versions/{id}/download` (with the token) or the signed `download`
link. `Range` works (`206`), so a broken download can resume; `ETag` is the SHA-256.

**Restore** an older version as the newest (same bytes, nothing more counted):
`POST /me/saves/versions/{id}/restore` → `{save, version, dropped, usage}`.
**Delete**: `DELETE /me/saves/versions/{id}` or a whole slot `DELETE /me/saves/slots/{id}` →
`{usage}`. Saves are their owner's alone: anyone else gets `404`.

## Media

**Upload**: `POST /me/media?kind=image|clip|voice`, the file as the body (any content type; the
bytes decide) → `201 {media, usage}`.

| kind | accepted | kept as |
|---|---|---|
| `image` | PNG, JPEG, WebP up to 10 MB, 40 megapixels | WebP, turned upright, no metadata, plus a 640 px `thumb` |
| `clip` | MP4 with H.264 (`avc1`/`avc3`) video and AAC or no sound, up to 25 MB | as sent |
| `voice` | Opus in Ogg or WebM, or AAC in MP4/M4A, up to 1 MB and 60 s | as sent |

Refusals: `415 unsupported_media_type` (not that kind of file), `400 bad_image` / `400 bad_media`
(damaged, wrong codec, too long), `413 payload_too_large`, `413 quota_exceeded`.

A clip's still: `PUT /me/media/{id}/poster` with a PNG/JPEG/WebP (up to 2 MB, e.g. a frame the
client grabbed) → `{media, usage}`.

`media` is `{id, kind, contentType, size, width, height, durationMs, url, thumb, poster, createdAt}`
(the owner also sees `gallery` and `hidden`). `url`, `thumb` and `poster` are signed links that
expire (12-24 hours in messages and galleries, 1-2 hours in the owner's lists); fetch the list or
the message again for new ones. They support `Range` (clips seek) and need no token.

Media nobody sent or pinned within a day of its upload is deleted. `DELETE /me/media/{id}` deletes
it everywhere (`{usage}`).

## Media in messages

Upload first, then send it: `POST /conversations/{id}/messages`
`{clientId, text?, attachments: [{mediaId}]}`. One piece per message, the sender's own; `text` is
its caption. A message is now:

```json
{ "id": "…", "seq": 12, "kind": "image", "text": "[photo]", "caption": null,
  "attachments": [{ "id": "…", "kind": "image", "url": "…", "thumb": "…", "width": 1920, "height": 1080, … }], … }
```

`kind` is `text`, `image`, `clip` or `voice`. Clients that know no media keep working: they show
`text`, which is the caption or a stand-in (`[photo]`, `[clip]`, `[voice note]`). An attachment can
also be `{id, kind, removed: true}` (deleted by its owner or hidden by a moderator) or
`{id, kind, blocked: true}` (one of you blocked the other). Each member gets the attachments as
they may see them, in the list, the history and the gateway's `message.created` and
`message.updated` events. Deleting the message deletes its media unless it is pinned or in
another message. Editing changes the caption.

## The gallery

Up to 12 pinned photos and clips on the profile, shown as the owner's `gallery` privacy setting
allows (`PATCH /me/privacy {"gallery": "everyone" | "friends" | "nobody"}`; friends by default).

- `GET /users/{handle}/gallery` → `{items: [media…]}` in order; `403 forbidden` when private to
  the asker, `404` across a block.
- `GET /me/gallery`, `PUT /me/gallery {items: [mediaId…]}` (the whole list, in order; only one's
  own photos and clips).

Links to items of a gallery open to everyone may be cached by anyone until they expire.

## Reporting

`POST /reports {targetKind: "media", targetId: <media id>, reason, note?}`: anyone who can see it
but its owner. Moderators can hide it (only its owner still sees it) or delete it.

## The data export

`GET /me/export` has a `storage` part: the usage, every save version and every piece of media,
with links good for a week.
