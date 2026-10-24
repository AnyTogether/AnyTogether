# Cross-client runs

Every AnyTogether client against one local stack, together: the macOS launcher (Swift), the phone
app (Dart), the Windows/Linux launcher (Dart) and this website in headless Chrome. Each client is
otherwise tested against a pretend server of its own; this checks that they understand the real one
and each other.

## How it works

- `stack.sh` runs the API, the gateway and the website (`next build`, the standalone server, as in
  production) with `MAIL_TRANSPORT=log`, and `proxy.mjs` in front of them on one origin, as Caddy
  does in `deploy/`: `/api` to the API, `/rt` to the gateway, the rest to the website. The clients
  derive `/api/v1` and `/rt` from that one address.
- `run.mjs` is the scenario script. It starts a **driver** in each client's repository and sends it
  commands over a small HTTP bus (`bus.mjs`); the driver runs each with the client's real code
  (its account, socket, friends, messages, parties, calls, sync, game sessions) and answers with
  what the client now holds. The website is driven in-process with puppeteer (`web.mjs`), through
  its real pages: the login form, the link page, the friends, messages and party pages, calls with
  Chrome's fake microphone.
- The drivers are ordinary tests, skipped unless `ANYTOGETHER_E2E_BUS` is set:
  - macOS launcher: `tools/macos/launcher/Tests/AnyPS5CoreTests/TogetherCrossClientTests.swift`
    in AnyPS5-ARM (`swift test --filter TogetherCrossClientTests`)
  - phone: `mobile/test/together_e2e_test.dart` in AnyPS5-ARM (`flutter test`)
  - Windows/Linux launcher: `test/core/together_e2e_test.dart` in AnyPS5-Desktop (`flutter test`)
- Sign-in codes are read from the API's log. For calls the Mac's driver relays the signalling (offer,
  answer, ICE candidates, mute) for a peer connection in a browser page that stands in for the
  launcher's own WebRTC: the signalling and the relay credentials are what is checked.

## Scenarios

1. Sign-in: email codes on every client; hand-off phone → Mac, Mac → phone, phone → Windows/Linux
   launcher; device codes (the Mac's, and the Windows/Linux launcher's own page) approved on the
   website.
2. Friends: a request from the Mac accepted on the website; presence (the Mac in a game) on the
   phone, the other launcher and the website; unfriending; blocking from the website's menu.
3. Messages: a direct message with the website's live unread badge and read receipt; a group of
   four, each client writing in turn, live delivery, typing, unread counts against the server's.
4. Parties: started and invites sent on the website, joined by the three apps, the lead handed to
   the Mac, the Mac removing a member.
5. Calls: party voice and a 1:1 call between the Mac and the website: offer/answer/candidates
   through the gateway until connected, TURN REST credentials verified, mute both ways.
6. Sync: play time and trophies from the Mac on the website's profile, leaderboard and feed;
   privacy hiding them from a stranger and from everyone.
7. Game sessions: the Mac hosts, the Windows/Linux launcher sees it joinable, a mismatched version
   is refused and a matching one joins, each player's properties and a `game_session.signal`
   reach the other, the host ends it.

## Running it

Needs Node 22, pnpm, PostgreSQL and Valkey (`pnpm dev:db`, or any), Google Chrome, and for the
drivers Swift (Xcode) and Flutter with the client repositories checked out.

```sh
pnpm install && (cd e2e && npm install)
DATABASE_URL=postgres://anytogether:anytogether@127.0.0.1:54329/anytogether \
VALKEY_URL=redis://127.0.0.1:63799 e2e/stack.sh start

E2E_LAUNCHER_MAC=~/AnyPS5-ARM/tools/macos/launcher \
E2E_PHONE=~/AnyPS5-ARM/mobile \
E2E_LAUNCHER_DESKTOP=~/AnyPS5-Desktop \
node e2e/run.mjs

e2e/stack.sh stop
```

- A client whose folder is not given is left out (its cells say n/a; the stranger in scenarios 2
  and 6 is the Windows/Linux launcher's second account).
- `E2E_SCENARIOS=1,2,3` runs some only; scenarios build on the ones before (accounts, friends, the
  party), so run from 1.
- Ports: `E2E_PORT` (18490, the origin), `E2E_API_PORT`, `E2E_RT_PORT`, `E2E_WEB_PORT`
  (18480-18482); `E2E_WEB=dev` runs `next dev` instead of the production build (its route handlers
  see `localhost:<port>` as their host, so the website's own same-origin checks refuse it behind the
  proxy); `E2E_REBUILD=1` rebuilds the website. `CHROME` points at another Chrome.
- Output: every check on the console and in `e2e/.run/e2e.log`, the scenario × client table in
  `e2e/.run/results.md`, each driver's output in `e2e/.run/driver-<client>.log`, the servers' logs
  next to them.
- The proxy gives each connection its own `X-Real-IP` so repeated runs do not trip the per-address
  sign-in limit. Relay credentials are signed with a test secret and never used.
