import { connect } from "@anytogether/db";
import { Redis } from "ioredis";
import { type JWK, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { type Deps, createApp } from "../src/app.js";
import { memoryMailer } from "../src/mail.js";
import { createTokenSigner } from "../src/tokens.js";
import { testDatabaseUrl } from "./global-setup.js";

/** An identity provider for the tests: its own signing key, and ID tokens made with it. */
export async function fakeProvider(issuer: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    idToken: (claims: Record<string, unknown>, audience: string) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
  };
}

export async function harness(overrides: Partial<Deps> = {}) {
  const { db, client } = connect(testDatabaseUrl, 4);
  await client`truncate accounts, sign_in_requests, audit_log cascade`;
  const valkey = new Redis(process.env.TEST_VALKEY_URL ?? "redis://127.0.0.1:63799/1");
  await valkey.flushdb();
  const mailer = memoryMailer();
  const google = await fakeProvider("https://accounts.google.com");
  const apple = await fakeProvider("https://appleid.apple.com");
  const deps: Deps = {
    db,
    valkey,
    mailer,
    tokens: await createTokenSigner(undefined, "https://anytogether.test"),
    providers: {
      google: { clientIds: ["google-client"], keys: google.keys },
      apple: { clientIds: ["org.anyps5.launcher"], keys: apple.keys },
      discord: {
        clientId: "discord-client",
        clientSecret: "secret",
        fetch: async () => new Response("{}", { status: 500 }),
      },
    },
    publicUrl: "https://anytogether.test",
    ...overrides,
  };
  const app = createApp(deps);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    client = "launcher-macos/0.2.13 (macOS 26.6)",
  ) => {
    const response = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        "anytogether-client": client,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  return {
    app,
    call,
    deps,
    mailer,
    google,
    apple,
    valkey,
    close: async () => {
      await client.end();
      valkey.disconnect();
    },
  };
}
