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
| `postgres` | PostgreSQL 17, where the data is kept (cloud saves and media, when on, are files beside it) |
| `valkey` | Valkey: rate limits, sign-in challenges, presence, the event bus (nothing kept on disk) |
| `coturn` | optional: a STUN/TURN relay so voice calls connect behind strict networks |

AnyTogether is MIT licensed: use it, change it and run it however you like.

## Requirements

- A Linux machine with a public IPv4 address (IPv6 as well is fine), 2 GB of memory or more
  (building the website needs most of it; running everything takes far less), 10 GB of disk.
- [Docker Engine](https://docs.docker.com/engine/install/) 24 or newer with the Compose plugin
  (`docker compose version` prints v2.x). Docker's own packages bring everything; with Ubuntu's,
  `apt install docker.io docker-compose-v2 docker-buildx`.
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
curl https://<your DOMAIN>/api/v1/health    # {"ok":true}
```

The first build downloads the packages and takes a while (most of it is the website); later ones
reuse what they can.

Open `https://<your DOMAIN>`, sign in with your email, and read the code from the log while
`MAIL_TRANSPORT=log`:

```sh
docker compose logs api | grep "sign-in code"
```

The first sign-in makes the account. Add a passkey in Settings and later sign-ins need no email
at all.

**Just trying it on your own computer**: `DOMAIN=localhost` works without DNS. Caddy then uses
its own certificate authority and the browser warns about the certificate (`curl -k` skips the
check: `curl -k https://localhost/api/v1/health`). To stop the warning,
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

Without `TURN_SECRET` coturn does not start: it stops at once, `docker compose logs coturn` says
`set TURN_SECRET in .env first`, and Docker keeps trying until it is set and step 4 runs again.

coturn uses the host's network (for its port range), finds the machine's public address by
itself, hands out credentials only through the API (TURN REST: short-lived, signed with
`TURN_SECRET`) and refuses to relay into private and loopback addresses. Behind a NAT that hides
the public address, replace `$$(detect-external-ip)` in `compose.yaml` with `public/private`
addresses (`--external-ip=203.0.113.7/10.0.0.5`).

### Push notifications

Browsers get notifications (friend requests, invites, missed calls, messages while away) through
Web Push when the API has a VAPID key pair. Make one once and keep it, since changing it ends every
browser's subscription:

```sh
docker run --rm node:22-alpine npx -y web-push generate-vapid-keys
```

Put the two keys in `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and a contact the push services
can reach in `VAPID_SUBJECT` (`mailto:you@example.org`). Without all three the site keeps its
notification list but offers no push. The optional mail digest of missed messages and friend
requests (each person turns it on in Settings; at most one mail per 6 hours) uses the sign-in mail
settings above.

### Cloud saves and media

Launchers can keep game saves in the cloud, and people can send photos, clips and voice notes in
messages and pin screenshots and clips to their profile. Both use one quota per account (100 MB by
default) and stay **off**, hidden in every client, until the API has somewhere to keep the files:

- **On this machine**: `STORAGE_DIR=/data/files` in `.env`. Compose already mounts the `files`
  Docker volume there for the API (`docker volume inspect anytogether_files` shows where it lives
  on the host). To use a disk of your choice instead, replace `files:/data/files` under `api:` in
  `compose.yaml` with a host folder, `/srv/anytogether-files:/data/files`, owned by uid 1000 (the
  container's `node` user): `sudo mkdir -p /srv/anytogether-files && sudo chown 1000:1000 /srv/anytogether-files`.
- **In a bucket**: any S3-compatible storage (Cloudflare R2, AWS S3, MinIO, Backblaze B2…). Fill in
  `S3_ENDPOINT` (for R2 `https://<account id>.r2.cloudflarestorage.com`), `S3_BUCKET`,
  `S3_ACCESS_KEY` and `S3_SECRET_KEY` with a key that may read, write, list and delete in that
  bucket, and `S3_REGION` for AWS (`auto` suits R2). The bucket stays private: every file is
  served through the API, with links that expire. Uploads wait on the API's own disk (in the
  `files` volume) until they are complete.

Then `docker compose up -d`. The API's log says `cloud saves and media: on (filesystem, 100 MB per
account)`; with a folder it cannot write to or a bucket it cannot list, it says why and keeps them
off rather than failing. `curl https://<your DOMAIN>/api/v1/storage` answers `{"enabled":true,…}`.

`STORAGE_QUOTA_MB` sets the quota and `SAVE_MAX_MB` the biggest save (50 MB by default; photos are
at most 10 MB, clips 25 MB and voice notes 1 MB and a minute). Plan the disk as accounts × quota at
most. Files are kept by their SHA-256, once per account; what nothing uses any more (unfinished
uploads after a day, media never sent or pinned, the files of deleted accounts) is removed by the
API every hour. Links to files are signed with `FILE_LINK_SECRET`, or with a key made from
`JWT_PRIVATE_KEY` when it is empty.

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
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | api | `.env` | a Discord application for "Continue with Discord" and for linking Discord to profiles; register `https://<domain>/auth/discord/callback` and `https://<domain>/connections/discord/callback` as its redirects; empty turns both off |
| `STEAM_WEB_API_KEY` | api | `.env` | optional: the Steam persona name of a linked Steam account from the Web API (linking needs no key; without it the public profile is read) |
| `WEBAUTHN_RP_NAME` | api | `.env`, `AnyTogether` | the site's name in passkey prompts |
| `TURN_SECRET` | api (and coturn) | `.env` | the TURN REST secret; empty: no relay credentials |
| `TURN_URLS` | api | `.env` | STUN/TURN URLs handed to callers, comma separated |
| `CLIENT_IP_HEADER` | api | `.env`, `cf-connecting-ip` | where per-address rate limits read the visitor's address: `cf-connecting-ip` (Cloudflare's header, then `X-Real-IP`; right behind Cloudflare or behind the bundled Caddy, which drops a CF-Connecting-IP sent by visitors), `x-real-ip` (your proxy sets `X-Real-IP` and passes CF-Connecting-IP through untouched, e.g. Traefik without Cloudflare) or `socket` (nothing in front of the API) |
| `GAME_ICON_HOSTS` | api | `.env` | hosts (and their subdomains) a game's icon URL may point at, comma separated; launchers load icons for everyone who sees the game, so empty keeps none |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | api | `.env` | the Web Push key pair (`npx web-push generate-vapid-keys`); empty: no push notifications |
| `VAPID_SUBJECT` | api | `.env` | a `mailto:` (or `https:`) contact for the push services |
| `STORAGE_DIR` | api | `.env` | the folder for cloud saves and media (`/data/files`, the `files` volume); with the S3 settings empty, cloud saves and media are off without it |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | api | `.env` | an S3-compatible bucket for them instead (all four, or S3 stays off) |
| `S3_REGION` | api | `.env`, `auto` | the bucket's region (`auto` for R2) |
| `STORAGE_QUOTA_MB` | api | `.env`, `100` | megabytes per account, saves and media together |
| `SAVE_MAX_MB` | api | `.env`, `50` | the biggest save archive |
| `STORAGE_STAGING_DIR` | api | not set | where uploads to a bucket wait (the system's temporary folder by default) |
| `FILE_LINK_SECRET` | api | `.env` | signs the expiring links to files; empty: derived from `JWT_PRIVATE_KEY` |
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

All data is in PostgreSQL (profiles, avatars, messages, trophies, everything) and, with cloud saves
and media on, in the `files` volume (or the bucket); Valkey holds nothing worth keeping, and Caddy's
certificates are fetched again if lost. A dump is a full backup of the database:

```sh
mkdir -p backups
docker compose exec -T postgres pg_dump -U anytogether -Fc anytogether > backups/anytogether-$(date +%F).dump
```

With `STORAGE_DIR`, copy the files volume too, after the dump (files nothing in the dump knows
about are cleaned up after a restore):

```sh
docker run --rm -v anytogether_files:/data/files:ro -v "$PWD/backups":/out alpine \
  tar czf /out/files-$(date +%F).tar.gz -C /data files
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
again), start only the database and wait until it is ready, restore, then start everything:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U anytogether -d anytogether --clean --if-exists < backups/anytogether-2026-10-24.dump
docker compose up -d --build
```

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
docker compose exec -e USER=yourname api node dist/admin.js grant @handle       # make an admin (the admin page at /admin)
docker compose exec -e USER=yourname api node dist/admin.js revoke @handle      # and back to a normal account
docker compose exec -e USER=yourname api node dist/admin.js theme <id> hide     # or: show, review
```

A ban signs the account out everywhere at once and refuses every way back in (email code,
providers, passkeys); a ban on an email also stops new accounts with it. Accounts whose owners
asked for deletion are purged every hour by the API itself; `purge` only does it sooner.

### Starting the Theme Hub

A folder like the old GitHub hub (`themes.json` and the `.anyps5theme` files it names, or just
theme files) can be put on the Hub at once. The themes are shared by `@anyps5`, a reserved
account with no way to sign in that is made the first time; who made each theme is kept in its
file and named in its description. Running it again skips the themes already there.

```sh
docker compose cp ./hub api:/tmp/hub
docker compose exec -e USER=yourname api node dist/admin.js hub import /tmp/hub
```

## Troubleshooting

- `docker compose ps` shows what is unhealthy; `docker compose logs <service>` says why.
- The website's build stops with `An error occurred in next/font` (or `Failed to fetch ... from
  Google Fonts`): the build downloads its fonts from Google Fonts and the connection was too slow
  or blocked. Run `docker compose up -d --build` again; what was already built is reused.
- No certificate: the DNS record does not point at the machine yet, or port 80/443 is closed.
  `docker compose logs caddy` names the problem; Caddy retries by itself.
- Everyone is signed out after a restart: `JWT_PRIVATE_KEY` is empty (the API's log says so).
- Rate limits hit everyone at once: something in front of Caddy hides the visitors' addresses.
  Behind Cloudflare, remove the `header_up -Cf-Connecting-Ip` lines in `Caddyfile`.
