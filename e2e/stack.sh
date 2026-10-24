#!/bin/sh
# Runs the whole AnyTogether stack locally for the cross-client tests: API, gateway, website (Next
# dev) and the one-origin proxy in front of them, with sign-in codes in the API log.
#   DATABASE_URL=postgres://… VALKEY_URL=redis://… e2e/stack.sh start
#   e2e/stack.sh stop
# Ports: E2E_PORT (the origin everything uses, 18490), E2E_API_PORT (18480), E2E_RT_PORT (18481),
# E2E_WEB_PORT (18482). Logs and pids go to E2E_DIR (e2e/.run). PostgreSQL and Valkey must already
# run (pnpm dev:db, or any other); the API applies the migrations when it starts.
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DIR=${E2E_DIR:-$ROOT/e2e/.run}
PORT=${E2E_PORT:-18490}
API_PORT=${E2E_API_PORT:-18480}
RT_PORT=${E2E_RT_PORT:-18481}
WEB_PORT=${E2E_WEB_PORT:-18482}
ORIGIN=http://127.0.0.1:$PORT
# Each server in a session of its own, so nothing that started this script takes them down with it.
DETACH="perl -MPOSIX -e setsid;exec(@ARGV)or(die)"

stop() {
  for name in proxy web realtime api; do
    if [ -f "$DIR/$name.pid" ]; then
      pid=$(cat "$DIR/$name.pid")
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      rm -f "$DIR/$name.pid"
    fi
  done
  # next dev and tsx leave children behind under their own process groups.
  for p in $API_PORT $RT_PORT $WEB_PORT $PORT; do
    lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  echo stopped
}

wait_for() { # url, name
  i=0
  until curl -s -m 2 -o /dev/null "$1"; do
    i=$((i + 1))
    if [ $i -gt 120 ]; then echo "$2 did not start, see $DIR/$2.log" >&2; exit 1; fi
    sleep 0.5
  done
}

case "$1" in
start)
  mkdir -p "$DIR"
  : "${DATABASE_URL:?set DATABASE_URL}" "${VALKEY_URL:?set VALKEY_URL}"
  # One signing key for the run, so restarting the API does not sign everyone out.
  [ -f "$DIR/jwt.pem" ] || node -e 'process.stdout.write(require("node:crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))' >"$DIR/jwt.pem"
  export JWT_PRIVATE_KEY="$(cat "$DIR/jwt.pem")"
  export PUBLIC_URL=$ORIGIN MAIL_TRANSPORT=log API_URL=http://127.0.0.1:$API_PORT
  # Relay credentials are only signed, never used: calls in the tests never need a relay.
  export TURN_SECRET=${TURN_SECRET:-e2etestsecret} TURN_URLS=${TURN_URLS:-stun:127.0.0.1:3478,turn:127.0.0.1:3478?transport=udp}
  (cd apps/api && { PORT=$API_PORT $DETACH npx tsx ./src/main.ts >"$DIR/api.log" 2>&1 </dev/null & echo $! >"$DIR/api.pid"; })
  wait_for "http://127.0.0.1:$API_PORT/api/v1/.well-known/jwks.json" api
  (cd apps/realtime && { PORT=$RT_PORT $DETACH npx tsx ./src/main.ts >"$DIR/realtime.log" 2>&1 </dev/null & echo $! >"$DIR/realtime.pid"; })
  if [ "${E2E_WEB:-build}" = dev ]; then
    (cd apps/web && { PORT=$WEB_PORT $DETACH npx next dev -H 127.0.0.1 -p "$WEB_PORT" >"$DIR/web.log" 2>&1 </dev/null & echo $! >"$DIR/web.pid"; })
  else
    # The website as it runs in production (next build, the standalone server), behind the proxy
    # as behind Caddy. (In next dev, route handlers see localhost:<web port> as their own host,
    # which the realtime ticket's same-origin check refuses for any other origin.)
    if [ ! -f apps/web/.next/standalone/apps/web/server.js ] || [ -n "$E2E_REBUILD" ]; then
      (cd apps/web && npx next build >"$DIR/web-build.log" 2>&1) || { echo "next build failed, see $DIR/web-build.log" >&2; exit 1; }
    fi
    rm -rf apps/web/.next/standalone/apps/web/.next/static
    cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
    (cd apps/web/.next/standalone/apps/web && { NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$WEB_PORT $DETACH node server.js >"$DIR/web.log" 2>&1 </dev/null & echo $! >"$DIR/web.pid"; })
  fi
  $DETACH node e2e/proxy.mjs "$PORT" "$API_PORT" "$RT_PORT" "$WEB_PORT" >"$DIR/proxy.log" 2>&1 </dev/null &
  echo $! >"$DIR/proxy.pid"
  wait_for "http://127.0.0.1:$RT_PORT/health" realtime
  wait_for "$ORIGIN/login" web
  echo "AnyTogether on $ORIGIN  (api log: $DIR/api.log)"
  ;;
stop) stop ;;
*) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
