# Challenges and the public API

## Challenges

A challenge is a race on one game between a start and an end. Someone makes it for their friends,
for a community they are in, or for everyone. People join, and the standings count only what
happened inside the window:

- `points`: trophy points (bronze 15, silver 30, gold 90, platinum 300) of trophies earned in the
  window,
- `trophies`: how many trophies were earned in the window,
- `time`: seconds played in the window. Sessions on two computers at the same time count once
  (the union of the sessions), and a session counts once the launcher sends it, when it ends.

A trophy or session counts only when the server received it after the start. Flagged trophies
(the anti-cheat flag that keeps people off the global leaderboards) never count. Standings are kept
for 30 seconds. One hour after the end the sweep (`sweepChallenges`, every minute in `main.ts`)
writes the final value and place of everyone in it, and from then on the standings never change.

Who sees one: everyone for a public challenge, the maker's accepted friends for a friends
challenge, the members of the community for a community challenge, and always whoever is in it.
Nobody sees a challenge across a block with its maker, or one made by an account that is banned
or being deleted. In the standings, someone blocked either way with the reader keeps their place
with `user: null`. Joining shows one's progress in that challenge to everyone who can see it,
whatever the profile's privacy settings say; the join button says so.

A child's family settings apply: public challenges count as public matchmaking, community ones as
communities.

Notifications: `challenge_invite` (a friend invited you), `challenge_started` (to everyone in it
but its maker, when it starts) and `challenge_ended` (to everyone in it, with their place and the
winner, once final). Each can be turned off in the notification settings.

Limits: a challenge runs 1 hour to 90 days and starts within 90 days. One person has at most 10
running or coming at once and makes at most 20 a day. At most 1000 people are in one.

### Tournaments

Bracket tournaments are left out. A bracket needs the result of each match (who beat whom), and
the server never learns that: games report trophies and play time, not match results. A bracket
would rest on players typing in their own results, which nothing could check and the anti-cheat
flags could not cover. Time-boxed challenges give the same race with numbers the server can
check.

## The public API

Read only, under `/api/v1/public`, described in `apps/api/src/publicApi.openapi.json` (served at
`/api/v1/public/openapi.json`) and on the website at `/developers`.

- Personal API tokens are made and revoked in the account settings (`/me/api-tokens`), at most 10
  per account. A token starts with `atp_`. The server keeps only its SHA-256 hash and shows the
  token once. A token never signs in to the rest of the API, and an account that is no longer
  active loses the use of its tokens.
- Scopes: `profiles:read`, `leaderboards:read`, `challenges:read`.
- A token reads as a stranger signed out would: profiles behind the public profile switch, the
  parts opened to everyone, the global leaderboards (never the friends ones), and challenges made
  for everyone. In a challenge's standings, an entrant who keeps that part of their profile from
  everyone (the library for play time, trophies otherwise) keeps their place with `user: null`.
  People blocked either way with the token's owner are left out everywhere. Answers carry handles,
  never account IDs.
- Rate limits: 60 requests a minute and 10,000 a day per token, 120 a minute per account across
  its tokens, on top of the per-address limit every request has. Answers carry `RateLimit-Limit`,
  `RateLimit-Remaining` and `RateLimit-Reset`; a refusal is 429 with `Retry-After`.
- CORS is open (`Access-Control-Allow-Origin: *`): the API takes no cookies, only the token.

Nothing new needs configuring on a self-hosted server.
