# The public profile switch

Every account has one switch, **Public profile** (`profiles.public_profile`), on top of the
per-part privacy settings (library, trophies, friends, presence, gallery, search).

| Reader | Switch off (the default) | Switch on |
| --- | --- | --- |
| The person | everything | everything |
| An accepted friend | what each part allows friends | what each part allows friends |
| A signed-in stranger (no friendship, or a request still pending) | the **minimal card** | the card, and each part set to *everyone* |
| Signed out (a link preview, a search engine) | the **minimal card** | the card, and each part set to *everyone* |
| Someone blocked, either way | 404, as before | 404, as before |

The **minimal card** is the handle, display name and avatar, with the same keys as a full answer
(launchers decode them): `bio` and `country` are `null`, `connections` is empty, `trophyLevel`,
`cover` and `accent` are `null`, `visible` is all `false`, `publicProfile` is `false`, and there is
no `presence` or `trophyCounts`. A signed-in reader also gets `userId` and `friendship`, so they can
send a friend request.

## How the server enforces it

- **One gate for every profile answer.** `profileGate` (`apps/api/src/publicProfiles.ts`) is
  mounted on `/users/:handle/*`, which takes the card too, before every route. While the switch is
  off and the reader is neither the person nor an accepted friend, it turns a 200 for
  `GET /users/:handle` into the minimal card and a 200 for anything under it (library, trophies,
  friends, activity, showcase, gallery, posts, trophy comparison, and whatever is added later) into
  `403 forbidden` with `section: "profile"`. It only looks at answers the routes already gave, so a
  404 (no such handle, a block) stays exactly what it was.
- **"Everyone" means friends while the switch is off.** `shownPrivacy(privacy, publicProfile)` in
  `packages/shared/src/profile.ts`, and `sectionSetting(alias, section)` for SQL in
  `apps/api/src/people.ts`, cap every part but *search* at friends. Every answer that shows
  strangers something "open to everyone" reads them: the global leaderboards, players of a game and
  suggestions in discovery, who plays a game now, levels in other people's lists (a public person's
  friends list, community members), the activity feed (an item about a new friend too), the gallery and
  its cache headers, and the default audience of a new capture post (friends).
- **Search** is not part of the profile: being found by name stays as set, and a search result is a
  name card anyway.
- **Explicit discovery** (`discoverable: true`) still lists the person in discovery, as they chose;
  what the card there shows follows the capped settings. With `discoverable` unset, discovery
  follows the library, capped.
- **Children** in a family cannot turn it on (`restricted_by_family`, `profile_visibility`), and a
  family's limit turns it off when a child joins (`enforceStored`).
- The global leaderboards are cached for a minute, so turning the switch either way shows there
  within a minute.

## The API

- `GET /me` → `profile.publicProfile`.
- `PATCH /me/public-profile` with `{ "publicProfile": true | false }` → `{ "publicProfile": … }`.
- `GET /users/:handle` → `publicProfile` (also for the person and friends, so a client can say
  "only your friends see this page").
- The account export carries `profile.publicProfile`.

## Existing accounts (migration 0023)

New accounts start **off**: it is the safer default. Accounts that were already there when the
switch came keep what strangers saw of them if they had chosen to show strangers something, and
start off otherwise:

- **On**, if any of: a part set to *everyone* (library, trophies, friends, presence, gallery),
  discovery turned on (`discoverable = true`), or a linked Steam or Discord account shown on the
  profile (`connections.hidden = false`). Their pages look exactly as before.
- **Off**, for everyone else, and for every child in a family. Before, strangers saw these people's
  card alone (name, picture, bio, country, cover and accent); now they see the minimal card. Nothing
  that was friends-only before is shown to anyone new, and the person can turn the switch on in
  Settings → Privacy at any time.

Why not everyone on: an account on the defaults never chose to show anything to strangers, and the
switch exists to make "not public" the norm; why not everyone off: people who opened parts of their
profile to everyone, turned on discovery or linked an account to show it did choose, and their
shared links and leaderboard places should keep working.

The migration is `packages/db/drizzle/0023_public_profile.sql`; its rule is tested in
`apps/api/test/publicProfileSwitch.test.ts`.

## The website

- Settings → Privacy: the switch (`#public-profile`), above the per-part settings; while it is off,
  a line says that *Everyone* works like *Friends*.
- `/u/<handle>`: a stranger gets the minimal card and a way to become friends (or to sign in). The
  person sees a note that only friends see the page while it is off. Each part has an address of
  its own (`#showcase`, `#gallery`, `#captures`, `#activity`, `#games`, `#trophies`, `#friends`) and a
  row of links to them; the games played, with their art, sit in the card when the library may be
  seen.
- Link previews (`opengraph-image`, the page's metadata) read the profile signed out, so they show
  the minimal card's name and picture and nothing else while the switch is off.
