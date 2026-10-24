import { connect } from "@anytogether/db";
import { runMigrations } from "@anytogether/db/migrate";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logMailer, resendMailer } from "./mail.js";
import { createTokenSigner } from "./tokens.js";

const settings = config();
if (!settings.jwtPrivateKey)
  console.warn("JWT_PRIVATE_KEY is not set: tokens stop working when the API restarts");
await runMigrations(settings.databaseUrl);
const { db } = connect(settings.databaseUrl);
const valkey = new Redis(settings.valkeyUrl);
const app = createApp({
  db,
  valkey,
  mailer:
    settings.mail.transport === "resend"
      ? resendMailer(settings.mail.resendKey, settings.mail.from)
      : logMailer(),
  tokens: await createTokenSigner(settings.jwtPrivateKey, settings.publicUrl),
  providers: settings.providers,
  publicUrl: settings.publicUrl,
});
serve({ fetch: app.fetch, port: settings.port }, (info) => console.log(`api listening on ${info.port}`));
