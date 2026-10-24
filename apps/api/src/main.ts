import { connect } from "@anytogether/db";
import { runMigrations } from "@anytogether/db/migrate";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
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
});
serve({ fetch: app.fetch, port: settings.port }, (info) => console.log(`api listening on ${info.port}`));
