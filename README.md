# AnyTogether

The online home of the AnyPS5 launchers: profiles, trophies, friends, parties, voice, messages,
share play, leaderboards, themes and downloads, at https://anytogether.kodla.agency.

The plan lives on the `anytogether` branch of
[AnyPS5-ARM](https://github.com/utkuhalis/AnyPS5-ARM/tree/anytogether) (English and Turkish).

## Layout

- `apps/api`: the REST API (`/api/v1`), TypeScript and Hono
- `apps/realtime`: the WebSocket gateway (`/rt`): presence, messages, signalling
- `apps/worker`: background jobs (pg-boss)
- `packages/shared`: schemas, error codes, gateway events
- `packages/db`: Drizzle schema and SQL migrations
- `infra/`: local development services and the Dockerfiles
- `deploy/`: Docker Compose for running your own AnyTogether ([docs/self-hosting.md](docs/self-hosting.md))

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

AGPL-3.0 (see `LICENSE`). If you run a modified AnyTogether for other people, you must publish
your changes.
