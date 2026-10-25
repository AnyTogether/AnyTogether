# AnyTogether

The online home of the AnyPS5 launchers: profiles, trophies, friends, parties, voice, messages,
share play, leaderboards, themes and downloads, at https://anytogether.kodla.agency.

The plan lives on the `anytogether` branch of
[AnyPS5-ARM](https://github.com/utkuhalis/AnyPS5-ARM/tree/anytogether) (English and Turkish).

## Screenshots

The website, with made-up demo people and data.

| Home | Profile |
|---|---|
| ![Home feed](docs/screenshots/web-home.jpg) | ![Profile](docs/screenshots/web-profile.jpg) |
| **Messages** | **Party** |
| ![Messages](docs/screenshots/web-messages.jpg) | ![Party](docs/screenshots/web-party.jpg) |
| **Leaderboards** | **Themes** |
| ![Leaderboards](docs/screenshots/web-leaderboards.jpg) | ![Themes](docs/screenshots/web-themes.jpg) |
| **Compatibility** | **Download** |
| ![Compatibility](docs/screenshots/web-compat.jpg) | ![Download](docs/screenshots/web-download.jpg) |
| **Photos, clips and voice notes** | **Profile gallery** |
| ![Media in messages](docs/screenshots/web-media-messages.jpg) | ![Profile gallery](docs/screenshots/web-gallery.jpg) |
| **Settings → Storage** | |
| ![Cloud saves and media in Settings](docs/screenshots/web-storage.jpg) | |

On a phone:

<img src="docs/screenshots/web-phone.jpg" alt="Messages on a phone" width="300">

## Layout

- `apps/api`: the REST API (`/api/v1`), TypeScript and Hono
- `apps/realtime`: the WebSocket gateway (`/rt`): presence, messages, signalling
- `apps/worker`: background jobs (pg-boss)
- `packages/shared`: schemas, error codes, gateway events
- `packages/db`: Drizzle schema and SQL migrations
- `infra/`: local development services and the Dockerfiles
- `deploy/`: Docker Compose for running your own AnyTogether ([docs/self-hosting.md](docs/self-hosting.md))
- [docs/cloud-storage.md](docs/cloud-storage.md): the API for cloud saves and media (off until the
  server has a folder or a bucket for them)

## Clients

Every AnyPS5 client talks to the same API and gateway, and they are tested together against one
real server (`e2e/`, last run 2026-10-24: every check passed).

| | macOS launcher | Phone (iOS, Android) | Windows/Linux launcher | Website |
|---|---|---|---|---|
| Sign-in: email code, passkey via the website, one tap from the phone | ✅ | ✅ | ✅ | ✅ |
| Friends and presence | ✅ | ✅ | ✅ | ✅ |
| Messages and group chats, typing | ✅ | ✅ | ✅ | ✅ |
| Parties | ✅ | ✅ | ✅ | ✅ |
| Voice chat and 1:1 calls, mute | ✅ | ✅ | ✅¹ | ✅ |
| Play time and trophies sync | ✅ | – | ✅ | ✅ (profiles) |
| Joining a friend's game | ✅ | – | ✅ | – |

"–": not a feature of that client. ¹ Built, not yet part of the cross-client run. The clients: [AnyPS5-ARM](https://github.com/utkuhalis/AnyPS5-ARM)
(macOS launcher, phone app), [AnyPS5-Desktop](https://github.com/utkuhalis/AnyPS5-Desktop) (Windows
and Linux). How to run the cross-client checks: [e2e/README.md](e2e/README.md).

## Development

```sh
pnpm install
pnpm dev:db                       # PostgreSQL and Valkey on the loopback (Docker)
pnpm --filter @anytogether/db migrate
pnpm test
```

## Running your own

`deploy/` runs the whole thing on one machine with `docker compose up -d`: PostgreSQL, Valkey, the
API, the gateway, the website, Caddy with automatic HTTPS, and optionally a TURN relay. See
[docs/self-hosting.md](docs/self-hosting.md).

## License

MIT (see `LICENSE`).
