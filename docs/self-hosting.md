# Running your own AnyTogether

Everything AnyTogether runs on is in this repository
([github.com/AnyTogether/AnyTogether](https://github.com/AnyTogether/AnyTogether)), and `deploy/` puts it
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
| `backup` | optional: scheduled, encrypted backups of the database and files to S3, Google Drive, SFTP and more ([Backups](#backups)) |

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
git clone https://github.com/AnyTogether/AnyTogether.git
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

To check it, send a test mail with the API's own settings:

```sh
docker compose exec api node dist/admin.js mail-test you@example.org
```

It goes step by step and stops at the first one that fails: the settings, DNS for the mail
server, the TCP connection, TLS as the port wants it (465 is `smtps://`, TLS from the start; 587
and 25 are `smtp://` with STARTTLS), signing in, and the server taking the recipient, with a hint
for each failure. A sign-in code that cannot be sent is logged the same way, by class and without
the password (`[mail] sign-in code to u***@example.org via smtp failed: auth: …`), and the person is
asked to try again later (503 `mail_unavailable`).

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
| `BACKUP_STATUS_FILE` | api | `/data/backup-state/status.json` | what the backup service last did, for the admin page and a log line when backups are late ([Backups](#backups) has the backup service's own settings) |
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
(`docker compose exec backup backup run`, see [Backups](#backups)). Read the commit log for anything that needs a new setting.

## Backups

Everything worth keeping is in PostgreSQL (accounts, profiles, avatars, messages, trophies,
communities, everything) and, with cloud saves and media on, in the `files` volume. Valkey holds
nothing that has to survive, and Caddy fetches its certificates again. If the machine dies with
the only copy on it, all of that is gone, so keep backups **somewhere else**.

The `backup` service does it for you:

- on a schedule (every night at 03:00 UTC by default) and whenever you ask, it dumps the database
  (`pg_dump`, custom format: one consistent snapshot) and packs the files volume after it
  (uploads still arriving are left out);
- writes a `manifest.json` beside them: the database and `pg_dump` versions, the newest
  migration, the number of accounts, sizes and SHA-256 of every part before and after encryption;
- encrypts both parts with [age](https://age-encryption.org) (a public key: the server can make
  backups but cannot read them) or with a passphrase (gpg, AES-256);
- uploads them with [rclone](https://rclone.org), so one setting covers AWS S3, Cloudflare R2,
  Backblaze B2, Wasabi, MinIO and every other S3-compatible storage, Google Drive, Dropbox,
  OneDrive, SFTP (any other server), WebDAV (Nextcloud and the like) and more, and checks that what
  arrived is the size it sent; the manifest goes last, so a backup without one is unfinished;
- keeps a copy in the `backups` volume too, unless you turn that off;
- deletes what retention no longer keeps: the newest backup of each of the last 7 days, 4 weeks
  and 3 months by default (always at least the newest one);
- reports to the admin page (`/admin`): when the last backup worked, its size and where it went,
  and a warning when the last success is older than two schedule periods, which the API's log
  and the backup service's own log say every hour as well. The container turns unhealthy then
  (`docker compose ps`).

It is not started unless you ask for it (`--profile backup`), so an upgrade never starts making
backups somewhere you did not choose.

### Turning it on

1. **Pick where backups go** and fill in `.env` from one of the examples below. The remote is
   called `offsite` in them; `BACKUP_REMOTE` is that name, a colon and a folder (or bucket):
   `BACKUP_REMOTE=offsite:anytogether-backups`.
2. **Encryption (recommended).** On your own computer, not the server, make an age key pair
   ([install age](https://github.com/FiloSottile/age#installation), or
   `docker run --rm -it alpine sh -c 'apk add -q age && age-keygen'`):

   ```sh
   age-keygen -o anytogether-backup.key
   # Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
   ```

   Put the public key in `.env` as `BACKUP_AGE_RECIPIENTS` (several, comma separated, if more than
   one person may restore). Keep `anytogether-backup.key` **off the server**, in a password manager
   and one more place: it is the only way to read the backups, and the server never needs it to
   make them. If you would rather type a passphrase, set `BACKUP_PASSPHRASE` instead (it then lives
   in `.env` on the server, so anyone who takes the server can read the backups too).
3. **Start it** and make the first backup at once:

   ```sh
   docker compose --profile backup up -d --build
   docker compose exec backup backup run       # a backup now
   docker compose exec backup backup list      # what is where
   docker compose exec backup backup status    # the last one, and whether backups are late
   ```

   The log says what it does: `docker compose logs backup`.
4. **Keep `.env` safe as well**, somewhere off the server: it is not in the backups and holds the
   signing key (`JWT_PRIVATE_KEY`; without it everyone signs in again), the VAPID keys and the
   settings for the backups themselves.

From then on `docker compose --profile backup up -d` (with `--build` after `git pull`) keeps it
running beside the rest.

### S3 and S3-compatible storage

Make a private bucket and a key that may list, read, write and delete in it (and nothing else),
then in `.env`:

**Cloudflare R2** (R2 → Manage API tokens → Object Read & Write, for this bucket):

```sh
BACKUP_REMOTE=offsite:anytogether-backups
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Cloudflare
RCLONE_CONFIG_OFFSITE_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=…
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=…
# A key limited to one bucket may not check that the bucket exists:
RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
```

**AWS S3** (an IAM user with `s3:ListBucket` on the bucket and `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject` on `arn:aws:s3:::anytogether-backups/*`):

```sh
BACKUP_REMOTE=offsite:anytogether-backups
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=AWS
RCLONE_CONFIG_OFFSITE_REGION=eu-central-1
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=…
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=…
```

**Backblaze B2** (B2 → Application Keys, limited to the bucket):

```sh
BACKUP_REMOTE=offsite:anytogether-backups
RCLONE_CONFIG_OFFSITE_TYPE=b2
RCLONE_CONFIG_OFFSITE_ACCOUNT=<keyID>
RCLONE_CONFIG_OFFSITE_KEY=<applicationKey>
# B2 otherwise only hides deleted files and keeps charging for them:
RCLONE_CONFIG_OFFSITE_HARD_DELETE=true
```

**Wasabi, MinIO and others**: `TYPE=s3`, `PROVIDER=Wasabi` or `Minio` (or `Other`), their
`ENDPOINT`, and the key as above.

Leave the bucket's own expiry rules off (or longer than your retention): the service deletes old
backups itself. Object versioning or a lock on the bucket is a good extra against someone who gets
the server's key deleting the backups too.

### Google Drive

Drive needs a sign-in in a browser once. rclone does that on any computer with a browser, and the
server only gets the result:

1. On your own computer, [install rclone](https://rclone.org/install/) and run

   ```sh
   rclone authorize "drive"
   ```

   A browser opens; sign in with the Google account the backups should go to and allow access.
   rclone then prints a token, one line of JSON starting with `{"access_token":`.
2. In `.env` on the server, with the token between single quotes:

   ```sh
   BACKUP_REMOTE=offsite:AnyTogether backups
   RCLONE_CONFIG_OFFSITE_TYPE=drive
   # Only the files rclone itself makes, not the rest of the Drive:
   RCLONE_CONFIG_OFFSITE_SCOPE=drive.file
   RCLONE_CONFIG_OFFSITE_TOKEN='{"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"}'
   ```

3. `docker compose --profile backup up -d` and `docker compose exec backup backup run`. The folder
   `AnyTogether backups` appears in the Drive.

rclone renews the access part of the token by itself; the refresh token in `.env` keeps working
until you remove the access in your Google account. For more than a little use, make your own
OAuth client in the Google Cloud console (a Desktop app, with the Drive API turned on, and
**published**: in "testing" Google ends its tokens after 7 days), and add
`RCLONE_CONFIG_OFFSITE_CLIENT_ID` and `_CLIENT_SECRET`, and pass the same two to
`rclone authorize "drive" <client id> <client secret>`.

**Dropbox and OneDrive** work the same way: `rclone authorize "dropbox"` (`TYPE=dropbox`, `TOKEN`)
or `rclone authorize "onedrive"`. OneDrive also needs the drive's ID and type, which is easiest
with a configuration file (below).

### SFTP: another server

Any machine you can reach over SSH: a second server, a NAS, a storage box. Make a user there just
for backups, give it a folder, and make it a key without a passphrase:

```sh
ssh-keygen -t ed25519 -N "" -f anytogether-backup-ssh
ssh-copy-id -i anytogether-backup-ssh.pub backup@backup.example.org
```

Then in `.env`, with the private key on one line, its line breaks written as `\n`
(`awk '{printf "%s\\n", $0}' anytogether-backup-ssh` prints it so):

```sh
BACKUP_REMOTE=offsite:anytogether-backups
RCLONE_CONFIG_OFFSITE_TYPE=sftp
RCLONE_CONFIG_OFFSITE_HOST=backup.example.org
RCLONE_CONFIG_OFFSITE_USER=backup
RCLONE_CONFIG_OFFSITE_PORT=22
RCLONE_CONFIG_OFFSITE_KEY_PEM='-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn…\n-----END OPENSSH PRIVATE KEY-----\n'
```

The folder is relative to the user's home (`offsite:/srv/backups` for an absolute one). To check
the server's host key, put its line from `ssh-keyscan backup.example.org` in a file, mount it into
the service and point `RCLONE_CONFIG_OFFSITE_KNOWN_HOSTS_FILE` at it. A password instead of a key:
`RCLONE_CONFIG_OFFSITE_PASS`, as rclone obscures it:
`docker compose --profile backup run --rm --entrypoint rclone backup obscure 'the password'`.

**WebDAV** (Nextcloud, ownCloud…): `TYPE=webdav`, `URL=https://cloud.example.org/remote.php/dav/files/<user>`,
`VENDOR=nextcloud`, `USER`, and `PASS` obscured the same way.

### An rclone configuration file instead

Anything rclone supports, with as many remotes as you like: make the folder, owned by the
container's user, uncomment the `./rclone:/config/rclone` line under `backup:` in `compose.yaml`,
and let rclone ask its questions:

```sh
mkdir -p rclone && sudo chown 1000:1000 rclone
docker compose --profile backup run --rm --entrypoint rclone backup config
```

`BACKUP_REMOTE` then names a remote from that file. rclone keeps renewed tokens there too.

### Settings

| Setting | Default | What it does |
|---|---|---|
| `BACKUP_SCHEDULE` | `0 3 * * *` | when, as a cron expression (minute hour day month weekday; `*/n`, ranges, lists, `@daily`, `@weekly`) |
| `BACKUP_TZ` | `UTC` | the time zone the schedule is read in, e.g. `Europe/Istanbul` |
| `BACKUP_REMOTE` | empty | the rclone remote and folder; empty: only the local copy |
| `BACKUP_KEEP_LOCAL` | `true` | also keep backups in the `backups` volume |
| `BACKUP_KEEP_DAILY`, `_WEEKLY`, `_MONTHLY` | `7`, `4`, `3` | how many days, ISO weeks and months keep their newest backup |
| `BACKUP_AGE_RECIPIENTS` | empty | age public keys (`age1…`, or ssh public keys), comma separated |
| `BACKUP_PASSPHRASE` | empty | a passphrase for gpg instead (not both) |
| `BACKUP_AGE_IDENTITY_FILE` | empty | the age private key file, for restores only |
| `BACKUP_ON_START` | `false` | make a backup whenever the service starts, too |
| `RCLONE_CONFIG_OFFSITE_*` | empty | the remote `offsite`, as above (rclone's own [settings](https://rclone.org/docs/#config-file) in capitals) |

Retention and privacy go together: a deleted account is gone from the database after 14 days, but
stays in older backups until they are deleted too. Say how long you keep backups in your privacy
notice, and keep retention to what you need.

With the files in a bucket (`S3_*` instead of `STORAGE_DIR`), they are not in these backups: turn
on versioning or replication for that bucket at its provider.

Another backup script can report to the admin page too: the API reads `BACKUP_STATUS_FILE`
(`/data/backup-state/status.json`, the `backup-state` volume) in the format of
`packages/shared/src/backup.ts`.

### Restoring

`restore` downloads a backup, checks every part's SHA-256 against the manifest, decrypts it (and
checks again), and only then loads the database (`pg_restore` in one transaction) and unpacks the
files. It refuses a database that has accounts in it, or a files volume with files, unless you add
`--force`, which replaces everything in them. For age, the private key goes in for the restore
only and is removed after:

```sh
docker compose stop api realtime web
docker compose --profile backup run --rm \
  -v "$PWD/anytogether-backup.key:/run/secrets/age.key:ro" -e BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key \
  backup restore latest --force
docker compose up -d
```

The key file must be readable by uid 1000 (`chmod 644` it for the restore, and delete it from the
server afterwards). `restore <name>` takes a name from `backup list` instead of the latest;
`--from local` or `--from remote` picks where from; `--skip-files` restores only the database.
`backup verify latest` does everything but the restore: a good check, now and then, that the
backups can really be read (with the key mounted the same way).

**On a new machine** (the old one is gone): clone the repository, put back `.env` (with the same
`JWT_PRIVATE_KEY`, or everyone signs in again), start only the database, restore, then start
everything. A new database has no accounts, so no `--force`:

```sh
docker compose up -d --wait postgres
docker compose --profile backup run --rm \
  -v "$PWD/anytogether-backup.key:/run/secrets/age.key:ro" -e BACKUP_AGE_IDENTITY_FILE=/run/secrets/age.key \
  backup restore latest
docker compose --profile backup up -d --build
```

A backup from an older AnyTogether restores into a newer one (the API applies the newer
migrations when it starts); one from a newer AnyTogether is refused until you update.

### By hand

Without the service, a dump is still a full backup of the database:

```sh
docker compose exec -T postgres pg_dump -U anytogether -Fc anytogether > anytogether-$(date +%F).dump
docker run --rm -v anytogether_files:/data/files:ro -v "$PWD":/out alpine \
  tar czf /out/files-$(date +%F).tar.gz -C /data files
```

and `docker compose exec -T postgres pg_restore -U anytogether -d anytogether --clean --if-exists < anytogether-2026-10-24.dump`
(with `api`, `realtime` and `web` stopped) brings it back.

## Moderation

The moderators' tool runs inside the API's container, with its database:

```sh
docker compose exec -e USER=yourname api node dist/admin.js reports            # open reports
docker compose exec -e USER=yourname api node dist/admin.js reports --all
docker compose exec -e USER=yourname api node dist/admin.js report <id> dismiss # or: action
docker compose exec -e USER=yourname api node dist/admin.js user @handle        # or an email or ID
docker compose exec -e USER=yourname api node dist/admin.js ban @handle --days 7 --reason "spam"
docker compose exec -e USER=yourname api node dist/admin.js unban @handle
docker compose exec -e USER=yourname api node dist/admin.js mute @handle --days 3 --public "what they read"
docker compose exec -e USER=yourname api node dist/admin.js unmute @handle
docker compose exec api node dist/admin.js purge                               # delete accounts past their 14 days now
docker compose exec -e USER=yourname api node dist/admin.js grant @handle       # make an admin (the admin page at /admin)
docker compose exec -e USER=yourname api node dist/admin.js revoke @handle      # and back to a normal account
docker compose exec -e USER=yourname api node dist/admin.js theme <id> hide     # or: show, review
```

A ban signs the account out everywhere at once and refuses every way back in (email code,
providers, passkeys); a ban on an email also stops new accounts with it. A mute keeps the account
signed in but stops it writing to others (messages, posts, friend requests, name and bio, themes).
`--public` is the reason the person is told, on the website and in a refused sign-in; `--reason`
stays with the moderators. They can appeal once at a time; appeals wait in the admin page's
Appeals tab. Accounts whose owners
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
