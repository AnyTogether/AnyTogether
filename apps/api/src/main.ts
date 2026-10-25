import { connect } from "@anytogether/db";
import { runMigrations } from "@anytogether/db/migrate";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { purgeDeletedAccounts } from "./account.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { mailerFor } from "./mail.js";
import { pruneNotifications, sendDigests, webPushSender } from "./notifications.js";
import { sweepThemeFiles } from "./themes.js";
import { createTokenSigner } from "./tokens.js";

const settings = config();
if (!settings.jwtPrivateKey)
  console.warn("JWT_PRIVATE_KEY is not set: tokens stop working when the API restarts");
await runMigrations(settings.databaseUrl);
const { db } = connect(settings.databaseUrl);
const valkey = new Redis(settings.valkeyUrl);
const mailer = mailerFor(settings.mail);
console.log(`sign-in mail: ${mailer.kind}`);
const push = webPushSender(settings.vapid);
console.log(
  `push notifications: ${push ? "on" : "off (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)"}`,
);
const app = createApp({
  db,
  valkey,
  mailer,
  tokens: await createTokenSigner(settings.jwtPrivateKey, settings.publicUrl),
  providers: settings.providers,
  publicUrl: settings.publicUrl,
  rpName: settings.rpName,
  turn: settings.turn,
  blockedLinkDomains: settings.blockedLinkDomains,
  gameIconHosts: settings.gameIconHosts,
  clientIpHeader: settings.clientIpHeader,
  push,
  githubToken: settings.githubToken,
});
serve({ fetch: app.fetch, port: settings.port }, (info) => console.log(`api listening on ${info.port}`));

// Accounts whose 14 days to change their mind are over are deleted, checked every hour, and the
// files of their themes after them.
const purge = () =>
  purgeDeletedAccounts({ db, valkey })
    .then((count) => count && console.log(`deleted ${count} account(s)`))
    .then(() => sweepThemeFiles({ db, publicUrl: settings.publicUrl }))
    .catch((error) => console.error("purge failed", error));
setTimeout(purge, 60_000);
setInterval(purge, 3_600_000);
setInterval(
  () =>
    pruneNotifications(db)
      .then((count) => count && console.log(`pruned ${count} old notification(s)`))
      .catch((error) => console.error("notification prune failed", error)),
  3_600_000,
);

// Mail digests for those who turned them on, looked at every 10 minutes (at most one per person
// per 6 hours).
setInterval(
  () =>
    sendDigests({ db, valkey, mailer, publicUrl: settings.publicUrl })
      .then((count) => count && console.log(`mailed ${count} digest(s)`))
      .catch((error) => console.error("digests failed", error)),
  600_000,
);

// The parents' weekly family summaries, looked at every hour.
setInterval(
  () =>
    app
      .sendFamilySummaries()
      .then((count) => count && console.log(`sent ${count} family summary(ies)`))
      .catch((error) => console.error("family summaries failed", error)),
  3_600_000,
);

// Devices whose realtime socket went away are taken out of their calls and share plays.
setInterval(
  () => app.sweepDepartures().catch((error) => console.error("departure sweep failed", error)),
  5_000,
);

// Looking-for-group posts whose time ran out leave the board, looked at every minute.
setInterval(
  () =>
    app
      .sweepLfg()
      .then((count) => count && console.log(`closed ${count} expired looking-for-group post(s)`))
      .catch((error) => console.error("looking-for-group sweep failed", error)),
  60_000,
);
