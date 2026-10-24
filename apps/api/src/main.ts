import { connect } from "@anytogether/db";
import { runMigrations } from "@anytogether/db/migrate";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { purgeDeletedAccounts } from "./account.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { mailerFor } from "./mail.js";
import { createTokenSigner } from "./tokens.js";

const settings = config();
if (!settings.jwtPrivateKey)
  console.warn("JWT_PRIVATE_KEY is not set: tokens stop working when the API restarts");
await runMigrations(settings.databaseUrl);
const { db } = connect(settings.databaseUrl);
const valkey = new Redis(settings.valkeyUrl);
const mailer = mailerFor(settings.mail);
console.log(`sign-in mail: ${mailer.kind}`);
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
});
serve({ fetch: app.fetch, port: settings.port }, (info) => console.log(`api listening on ${info.port}`));

// Accounts whose 14 days to change their mind are over are deleted, checked every hour.
const purge = () =>
  purgeDeletedAccounts({ db, valkey })
    .then((count) => count && console.log(`deleted ${count} account(s)`))
    .catch((error) => console.error("purge failed", error));
setTimeout(purge, 60_000);
setInterval(purge, 3_600_000);

// Devices whose realtime socket went away are taken out of their calls.
setInterval(() => app.sweepDepartures().catch((error) => console.error("call sweep failed", error)), 5_000);
