# Public ID, private name and private picture

Every account has a **public identity** and, optionally, a **friends-only identity**.

| Field | Who sees it | Notes |
| --- | --- | --- |
| `handle` | everyone | The public ID: unique, searchable, what games show. Changes once per 30 days. |
| `displayName` | everyone | Public name. |
| `avatar` | everyone | Public picture, a stable URL. Moderated (`reset_avatar`). |
| `privateName` | the person and their accepted friends | A real name, say. 0 to 40 characters. |
| `privateAvatar` | the person and their accepted friends | A **signed link** that runs out (see below). |

Clients should show `privateName` / `privateAvatar` when they are there and fall back to
`displayName` / `avatar` when they are not. Always show the `handle` next to a private name, so
people still see who it is.

## When the private fields are in an answer

Both keys appear on a person card (`{ userId, handle, displayName, avatar, ... }`) only when:

- the reader is signed in, **and**
- the card is the reader's own, or the reader and that person are accepted friends, with no block
  either way, and the person's account is active.

Then each is a value or `null` (not set). For anyone else the keys are **left out**. So a
missing key means "you may not see it", and `null` means "your friend has not set one".

Only these answers carry them (the server list is `revealedPaths` in
`apps/api/src/privateIdentity.ts`):

- `GET /me` (`profile.privateName`, `profile.privateAvatar`), and `PATCH /me/profile`
- `GET /me/friends`, `GET /users/search`, `GET /users/{handle}` (signed in),
  `GET /users/{handle}/friends`, `GET /users/{handle}/activity` (signed in)
- `GET /me/party`, `/parties/{id}` and its actions
- `GET /me/conversations`, `/conversations`, `/conversations/{id}` and its messages and actions
- `GET /me/game-session`, `/game-sessions`, `/game-sessions/{id}` and its actions (Play Together
  included)
- `/communities`, `/communities/{id}` and its members, events and actions; `GET /me/communities`
- `GET /me/feed`, `GET /me/notifications`
- capture posts: `GET /me/captures`, `/posts/{id}` and its likes, comments and actions,
  `GET /users/{handle}/posts`, `GET /games/{titleId}/posts`

Inside those answers only the cards of the reader and the reader's friends get them: a stranger in
the same party, conversation, game or community never does.

They are **never** in:

- realtime (WebSocket) events, even ones sent to friends. After an event, read the answer again
  over HTTP, or keep the values you already have by `userId`;
- signed-out (public) profiles, link previews, the showcase, discovery, leaderboards, Looking for
  Group, calls, share plays, admin pages (except a report about them, below);
- search matching: `GET /users/search` matches handles and display names only.

When a friendship ends, or either side blocks, the next answer leaves the keys out.

## The private picture's link

`privateAvatar` looks like
`https://<host>/api/v1/avatars/private/<hash>.jpg?e=<unix seconds>&s=<signature>`.

- It works until `e` (6 to 12 hours after it was handed out) and is the same for everyone within a
  6-hour window, so it caches. Answers `403` when the signature is wrong, `410` once expired, `404`
  once the picture was changed or removed. Served with `cache-control: private`.
- Do not store it for later: read it again from one of the answers above. A former friend's link
  stops working within 12 hours.
- The private picture is never served at the public `/api/v1/avatars/<hash>.jpg` address.

## Setting them

- `PATCH /me/profile` with `{ "privateName": "Selin Kaya" }`; `null` or `""` clears it. Same rules as
  the display name: no links, at most 40 characters, refused (`account_muted`) while muted (clearing
  is always allowed).
- `PUT /me/avatar/private` with the picture as the body (PNG or JPEG, at most 5 MB, at least 32 px,
  optional `?left=&top=&size=` crop), answered `{ "privateAvatar": "<signed link>" }`; the same
  checks, re-encoding and rate limit as `PUT /me/avatar`. `DELETE /me/avatar/private` removes it.
  Changing or removing one picture never touches the other.

## Reporting and moderation

- A friend reports them with `POST /reports` and
  `{ "targetKind": "private_profile", "targetId": "<their userId>", "reason": "..." }`. Anyone who is
  not an accepted friend gets `404`; the person themselves gets `400`.
- The report keeps what they were. On `GET /admin/reports` such a report has
  `privateProfile: { name, avatar, current }` (`avatar` is a link that works for an hour; `current`
  says whether they are still the same). The admin person cards stay public-only.
- Moderator actions: `reset_private_name` and `reset_private_avatar`. `reset_avatar` resets the
  public picture only.

## Data export

`GET /me/export` has the account's own `profile.privateName` and its `privateAvatar` (as a
`data:` URL, next to `avatar`). Friends' private fields are never in anyone's export.
