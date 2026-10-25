import { createHmac } from "node:crypto";
import { connect } from "@anytogether/db";
import { runMigrations } from "@anytogether/db/migrate";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { purgeDeletedAccounts } from "./account.js";
import { createApp } from "./app.js";
import { lateBackupWarning } from "./backups.js";
import { config } from "./config.js";
import { storeFromSettings } from "./fileStore.js";
import { type FileService, fileService } from "./files.js";
import { mailerFor } from "./mail.js";
import { pruneMeetings } from "./met.js";
import { pruneNotifications, sendDigests, webPushSender } from "./notifications.js";
import { restoreRevocations } from "./sessions.js";
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
  `linking accounts: Steam${settings.steamApiKey ? " (Web API names)" : ""}${settings.providers.discord.clientId && settings.providers.discord.clientSecret ? ", Discord" : " (Discord off: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET)"}`,
);
console.log(
  `push notifications: ${push ? "on" : "off (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)"}`,
);
// Cloud saves and media only when the server has somewhere to keep them, and it works.
let files: FileService | undefined;
const store = storeFromSettings(settings.storage);
if (store) {
  try {
    await store.check();
    files = fileService({
      db,
      store,
      publicUrl: settings.publicUrl,
      quotaBytes: settings.storage.quotaBytes,
      saveMaxBytes: settings.storage.saveMaxBytes,
      // Links survive restarts when they are signed with a key that does.
      urlSecret:
        settings.storage.urlSecret ??
        (settings.jwtPrivateKey
          ? createHmac("sha256", settings.jwtPrivateKey).update("file-links").digest()
          : undefined),
    });
    console.log(
      `cloud saves and media: on (${store.kind}, ${Math.round(files.quota / 1048576)} MB per account)`,
    );
  } catch (error) {
    console.error(`cloud saves and media: off, the ${store.kind} store cannot be used:`, error);
  }
} else
  console.log(
    "cloud saves and media: off (STORAGE_DIR or S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)",
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
  backupStatusFile: settings.backupStatusFile,
  ...(files ? { files } : {}),
  steam: { apiKey: settings.steamApiKey },
});
serve({ fetch: app.fetch, port: settings.port }, (info) => console.log(`api listening on ${info.port}`));

// Valkey keeps nothing across a restart: the recent sign-outs (bans included) are copied back from
// PostgreSQL at start and whenever Valkey comes back empty, looked at every 5 seconds (requests
// that find them missing copy them at once as well).
const restore = () =>
  restoreRevocations({ db, valkey }).catch((error) => console.error("restoring sign-outs failed", error));
void restore();
setInterval(restore, 5_000);

// Accounts whose 14 days to change their mind are over are deleted, checked every hour, and the
// files of their themes after them.
const purge = () =>
  purgeDeletedAccounts({ db, valkey, files })
    .then((count) => count && console.log(`deleted ${count} account(s)`))
    .then(() => sweepThemeFiles({ db, publicUrl: settings.publicUrl }))
    // Then cloud files nothing uses: unfinished uploads, unsent media, deleted accounts' files.
    .then(() => files?.sweep())
    .then((swept) => {
      const total = swept ? Object.values(swept).reduce((a, b) => a + b, 0) : 0;
      if (total) console.log("storage cleanup", swept);
    })
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
// Players met are forgotten 90 days after the last time.
setInterval(
  () =>
    pruneMeetings(db)
      .then((count) => count && console.log(`forgot ${count} old meeting(s)`))
      .catch((error) => console.error("meeting prune failed", error)),
  3_600_000,
);

// Backups that stopped working (no success for two schedule periods) are said in this log too,
// hourly, in case nobody reads the backup service's own.
setInterval(
  () =>
    lateBackupWarning(settings.backupStatusFile)
      .then((warning) => warning && console.warn(warning))
      .catch(() => {}),
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

// Events starting within 15 minutes remind the people going or maybe, looked at every minute.
setInterval(
  () =>
    app
      .sweepEvents()
      .then((count) => count && console.log(`reminded ${count} event(s)`))
      .catch((error) => console.error("event reminders failed", error)),
  60_000,
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
