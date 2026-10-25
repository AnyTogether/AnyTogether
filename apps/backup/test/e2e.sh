#!/bin/sh
# Backup and restore end to end (test/roundtrip.test.ts) without Docker: a throwaway MinIO as the
# S3 target, rclone's local backend, and a PostgreSQL you point it at.
#   BACKUP_E2E_DATABASE_URL=postgres://anytogether:anytogether@127.0.0.1:54329/anytogether \
#     pnpm --filter @anytogether/backup test:e2e
# Needs on PATH: minio, rclone, age, age-keygen, gpg, pg_dump, pg_restore, tar.
set -eu
: "${BACKUP_E2E_DATABASE_URL:?set BACKUP_E2E_DATABASE_URL}"
for tool in minio rclone age age-keygen gpg pg_dump pg_restore tar; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
PORT=${MINIO_PORT:-39000}
DATA=$(mktemp -d)
export MINIO_ROOT_USER=e2e-backup MINIO_ROOT_PASSWORD=e2e-backup-secret
minio server "$DATA" --address "127.0.0.1:$PORT" --console-address "127.0.0.1:$((PORT + 1))" --quiet >"$DATA.log" 2>&1 &
MINIO=$!
trap 'kill $MINIO 2>/dev/null; wait $MINIO 2>/dev/null; rm -rf "$DATA" "$DATA.log"' EXIT INT TERM

# The S3 remote, configured only by environment variables, as in deploy/.env.example.
export RCLONE_CONFIG_E2ES3_TYPE=s3 RCLONE_CONFIG_E2ES3_PROVIDER=Minio
export RCLONE_CONFIG_E2ES3_ENDPOINT="http://127.0.0.1:$PORT"
export RCLONE_CONFIG_E2ES3_ACCESS_KEY_ID=$MINIO_ROOT_USER RCLONE_CONFIG_E2ES3_SECRET_ACCESS_KEY=$MINIO_ROOT_PASSWORD
i=0
until rclone mkdir e2es3:backups 2>/dev/null; do
  i=$((i + 1)); [ $i -lt 60 ] || { cat "$DATA.log" >&2; exit 1; }; sleep 0.5
done
export BACKUP_E2E_S3=e2es3:backups
cd "$(dirname "$0")/.."
npx vitest run test/roundtrip.test.ts
