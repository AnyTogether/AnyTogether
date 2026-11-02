# Presence and the status

A person picks one of four statuses, the way Discord has them:

| Status | `status` | Friends see |
| --- | --- | --- |
| Online | `online` | online (or in a game) |
| Idle | `idle` | idle, a yellow moon |
| Do Not Disturb | `dnd` | Do Not Disturb, a red dot with a bar |
| Invisible | `invisible` | offline, exactly as anyone who is offline |

Invisible is the old "appear offline". The account stays signed in and everything keeps working.

## Setting it

`PATCH /api/v1/me/presence` takes `{ "status": "online" | "idle" | "dnd" | "invisible" }`.
Clients that know only the old switch keep sending `{ "appearOffline": true | false }`: `true` is
Invisible and `false` is Online. A body may carry both, and then `status` wins. The answer is
`{ "appearOffline": boolean, "status": "…" }`.

`GET /api/v1/me` has `profile.presenceStatus` (the status) beside `profile.appearOffline`
(`true` exactly when the status is `invisible`).

Each change counts against the `setting` limit of its own (150 an hour per setting), so flipping
the status does not lock it or any other switch.

## Gateway events

- `presence.mode`, to the person's own devices after a change on any of them:
  `{ "appearOffline": boolean, "status": "online" | "idle" | "dnd" | "invisible" }`.
  `appearOffline` stays for older clients.
- `presence.updated`, to friends: as before (`userId`, `state`, `titleId`, `since`, `party`,
  `game`, `share`), and while the person is not offline also
  `"status": "online" | "idle" | "dnd"`. Invisible is never sent to anyone else. The person is
  shown `{ "state": "offline" }` with no status, as anyone who is offline.

The same `status` is in every presence the API returns about other people: `/me/friends`,
profiles (`/users/:handle`), players met and the game hubs. It comes from the one merged presence
the gateway keeps, so it is the same everywhere.

## What `state` says for older clients

- A picked Idle shows as `state: "away"` (in a game it stays `in_game`, so the game still shows).
- Do Not Disturb leaves `state` as it is: older clients see the person online or in a game.
- A device that says `away` itself (a hidden browser tab, an idle launcher) while the picked status
  is Online shows `status: "idle"`.

Clients that draw a dot: `dnd` is red even in a game, then `in_game` is the game's colour, then
`idle` (or `state: "away"`) is the yellow moon, else green.

## Where it is kept

`profiles.appear_offline` (Invisible) and `profiles.presence_status` (`idle`, `dnd`, or null for
Online). The gateway reads the picked Idle or Do Not Disturb from the `status` field of the
`presence-extra:<userId>` hash in Valkey (`withExtras` in `packages/shared/src/presence.ts`). The
API writes it on every change and again on every sign-in and token refresh (as it does for
Invisible), so a restarted Valkey gets it back.
