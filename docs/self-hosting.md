# Running your own AnyTogether

Everything AnyTogether runs on is in this repository
([github.com/utkuhalis/AnyTogether](https://github.com/utkuhalis/AnyTogether)), and `deploy/` puts it
on one machine with Docker Compose:

| Service | What it is |
|---|---|
| `caddy` | the reverse proxy: HTTPS for your host name (certificates from Let's Encrypt, renewed by itself), `/api` to the API, `/rt` to the gateway, the rest to the website |
| `web` | the website (Next.js) |
| `api` | the REST API under `/api/v1`; it applies the database migrations when it starts |
| `realtime` | the WebSocket gateway on `/rt`: presence, messages, call signalling |
| `postgres` | PostgreSQL 17, the only place data is kept |
| `valkey` | Valkey: rate limits, sign-in challenges, presence, the event bus (nothing kept on disk) |
| `coturn` | optional: a STUN/TURN relay so voice calls connect behind strict networks |

AnyTogether is MIT licensed: use it, change it and run it however you like.

## Requirements

- A Linux machine with a public IPv4 address (IPv6 as well is fine), 2 GB of memory or more
  (building the website needs most of it; running everything takes far less), 10 GB of disk.
- [Docker Engine](https://docs.docker.com/engine/install/) 24 or newer with the Compose plugin
  (`docker compose version` prints v2.x).
- A host name, such as `together.example.org`, whose DNS A (and AAAA, if the machine has IPv6)
  record points at the machine.
- Open ports: 80/tcp and 443/tcp and 443/udp (HTTP/3). With the TURN relay also 3478/udp,
  3478/tcp and 49160-49200/udp.
- For real sign-in mail: an SMTP account or a [Resend](https://resend.com) API key. Without one
  the codes go to the API's log, which is enough for trying it out.

## Steps

```sh
git clone https://github.com/utkuhalis/AnyTogether.git
cd AnyTogether/deploy
cp .env.example .env
```

Edit `.env`: at least `DOMAIN`, `ACME_EMAIL` and `POSTGRES_PASSWORD` (`openssl rand -hex 24`), and a
signing key (below). Then:

```sh
docker compose up -d --build     # builds the three app images, then starts everything
docker compose ps                # every service "healthy" after a minute or two
```

Open `https://<your DOMAIN>`, sign in with your email, and read the code from the log while
`MAIL_TRANSPORT=log`:

```sh
docker compose logs api | grep "sign-in code"
```

The first sign-in makes the account. Add a passkey in Settings and later sign-ins need no email
at all.

**Just trying it on your own computer**: `DOMAIN=localhost` works without DNS. Caddy then uses
its own certificate authority and the browser warns about the certificate. To stop the warning,
trust Caddy's root on your computer: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .`
and add `root.crt` to the system's trusted certificates.

### The signing key

Access tokens are signed with an Ed25519 key. Without `JWT_PRIVATE_KEY` the API makes a new key
each time it starts, and everyone is signed out on every restart. Make one, as a single line with
`\n` for the line breaks:

```sh
docker run --rm node:22-alpine node -e 'const { generateKeyPairSync } = require("node:crypto"); console.log(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"))'
```

and put it in `.env` between single quotes:

```sh
JWT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI…\n-----END PRIVATE KEY-----\n'
```

Keep it secret: whoever has it can sign in as anyone. Changing it signs everyone out once.

### Mail

`MAIL_TRANSPORT=smtp` with `SMTP_URL=smtps://user:password@mail.example.org:465` (or `smtp://…:587`
for STARTTLS), or `MAIL_TRANSPORT=resend` with `RESEND_API_KEY`. Set `MAIL_FROM` to an address your
mail provider lets you send from, and give that domain SPF and DKIM records, or the codes land in
spam. `docker compose up -d` again after changing `.env`.

### Voice calls and the TURN relay

Calls go straight between the people in them where their networks allow; behind strict NATs and
some mobile networks they need a relay. To run one on the same machine:

1. `TURN_SECRET` in `.env`: `openssl rand -hex 32` (letters and digits only).
2. `TURN_URLS` in `.env`, for your host name:
   `stun:together.example.org:3478,turn:together.example.org:3478?transport=udp,turn:together.example.org:3478?transport=tcp`
3. Open 3478/udp, 3478/tcp and 49160-49200/udp.
4. `docker compose --profile turn up -d`

coturn uses the host's network (for its port range), finds the machine's public address by
itself, hands out credentials only through the API (TURN REST: short-lived, signed with
`TURN_SECRET`) and refuses to relay into private and loopback addresses. Behind a NAT that hides
the public address, replace `$$(detect-external-ip)` in `compose.yaml` with `public/private`
addresses (`--external-ip=203.0.113.7/10.0.0.5`).

### Passkeys

Passkeys belong to `DOMAIN`: they keep working across upgrades and restarts, but moving the site to
another host name makes the old ones useless (everyone signs in with email once and adds new
ones). `WEBAUTHN_RP_NAME` is the name the browser's passkey sheet shows.

## Settings

Every setting the apps read. In `deploy/` the left column comes from `.env`; Compose fills in the
rest.

| Setting | App | In `deploy/` | What it does |
|---|---|---|---|
| `DOMAIN` | compose | `.env`, required | the host name; makes `PUBLIC_URL=https://DOMAIN` and Caddy's site |
| `ACME_EMAIL` | compose | `.env`, required | the contact address for Let's Encrypt |
| `POSTGRES_PASSWORD` | compose | `.env`, required | the database password; makes `DATABASE_URL` |
| `PUBLIC_URL` | api, realtime | from `DOMAIN` | the website's address: links in mails, the device-code page, the token issuer the gateway checks, the passkey RP ID (its host name) and origin |
| `DATABASE_URL` | api | from `POSTGRES_PASSWORD` | PostgreSQL connection URL |
| `VALKEY_URL` | api, realtime | `redis://valkey:6379` | Valkey (or Redis) URL |
| `PORT` | api, realtime, web | 8080, 8081, 3000 | where each listens inside its container |
| `API_URL` | realtime, web | `http://api:8080` | where they reach the API inside the network (keys for the gateway, every call from the website's server) |
| `JWT_PRIVATE_KEY` | api | `.env` | Ed25519 PKCS#8 PEM for access tokens, `\n` allowed for line breaks; empty: a new key per start |
| `MAIL_TRANSPORT` | api | `.env`, `log` | `log`, `smtp` or `resend` |
| `SMTP_URL` | api | `.env` | `smtps://user:password@host:465` or `smtp://…:587` |
| `RESEND_API_KEY` | api | `.env` | for `MAIL_TRANSPORT=resend` |
| `MAIL_FROM` | api | `.env` | the sender of sign-in and deletion codes |
| `GOOGLE_CLIENT_IDS` | api | `.env` | Google OAuth client IDs (comma separated) whose ID tokens are accepted; empty turns Google off |
| `APPLE_CLIENT_IDS` | api | `.env` | Apple Services/App IDs, the same way |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | api | `.env` | a Discord application for "Continue with Discord"; empty turns it off |
| `WEBAUTHN_RP_NAME` | api | `.env`, `AnyTogether` | the site's name in passkey prompts |
| `TURN_SECRET` | api (and coturn) | `.env` | the TURN REST secret; empty: no relay credentials |
| `TURN_URLS` | api | `.env` | STUN/TURN URLs handed to callers, comma separated |
| `GAME_ICON_HOSTS` | api | `.env` | hosts (and their subdomains) a game's icon URL may point at, comma separated; launchers load icons for everyone who sees the game, so empty keeps none |
| `GATEWAY_PUBLIC_URL` | web | not set | where browsers open the gateway socket, when it is not `wss://<site>/rt` |
| `HOSTNAME`, `NODE_ENV` | web | set by the image | the website listens on all addresses, in production mode (HTTPS-only cookies) |
| `USER` | api's admin tool | your shell's | the name recorded with a ban or a handled report; `admin` when unset |

## Upgrading

```sh
cd AnyTogether
git pull
cd deploy
docker compose up -d --build
```

The API applies new database migrations when it starts. They only ever add (tables, columns,
indexes), so a running website keeps working while the new images start. Back up first anyway
(below). Read the commit log for anything that needs a new setting.

## Backup and restore

All data is in PostgreSQL (profiles, avatars, messages, trophies, everything); Valkey holds nothing
worth keeping, and Caddy's certificates are fetched again if lost. One dump is a full backup:

```sh
mkdir -p backups
docker compose exec -T postgres pg_dump -U anytogether -Fc anytogether > backups/anytogether-$(date +%F).dump
```

Run it nightly from cron, copy the files off the machine, and keep them as long as your privacy
policy allows: a deleted account is gone from the database after 14 days, but stays in older
backups until they are deleted too.

To restore, stop what writes to the database, load the dump, start again:

```sh
docker compose stop api realtime web
docker compose exec -T postgres pg_restore -U anytogether -d anytogether --clean --if-exists < backups/anytogether-2026-10-24.dump
docker compose up -d
```

On a new machine: clone, copy over `.env` (with the same `JWT_PRIVATE_KEY`, or everyone signs in
again), `docker compose up -d postgres`, restore as above, then `docker compose up -d --build`.

## Moderation

The moderators' tool runs inside the API's container, with its database:

```sh
docker compose exec -e USER=yourname api node dist/admin.js reports            # open reports
docker compose exec -e USER=yourname api node dist/admin.js reports --all
docker compose exec -e USER=yourname api node dist/admin.js report <id> dismiss # or: action
docker compose exec -e USER=yourname api node dist/admin.js user @handle        # or an email or ID
docker compose exec -e USER=yourname api node dist/admin.js ban @handle --days 7 --reason "spam"
docker compose exec -e USER=yourname api node dist/admin.js unban @handle
docker compose exec api node dist/admin.js purge                               # delete accounts past their 14 days now
```

A ban signs the account out everywhere at once and refuses every way back in (email code,
providers, passkeys); a ban on an email also stops new accounts with it. Accounts whose owners
asked for deletion are purged every hour by the API itself; `purge` only does it sooner.

## Troubleshooting

- `docker compose ps` shows what is unhealthy; `docker compose logs <service>` says why.
- No certificate: the DNS record does not point at the machine yet, or port 80/443 is closed.
  `docker compose logs caddy` names the problem; Caddy retries by itself.
- Everyone is signed out after a restart: `JWT_PRIVATE_KEY` is empty (the API's log says so).
- Rate limits hit everyone at once: something in front of Caddy hides the visitors' addresses.
  Behind Cloudflare, remove the `header_up -Cf-Connecting-Ip` lines in `Caddyfile`.
