import { createHash } from "node:crypto";
import { connections } from "@anytogether/db";
import {
  type Connection,
  type ConnectionBadge,
  ConnectionFinish,
  type ConnectionProvider,
  ConnectionUpdate,
  ErrorCode,
  connectionProviders,
} from "@anytogether/shared";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { body } from "./http.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { rateLimiter } from "./ratelimit.js";
import { secret } from "./tokens.js";

const steamLogin = "https://steamcommunity.com/openid/login";
const openIdNs = "http://specs.openid.net/auth/2.0";
const steamIdUrl = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
/** How long a started link waits for the provider's answer. */
const stateSeconds = 600;
const stateKey = (state: string) => `connect-state:${createHash("sha256").update(state).digest("hex")}`;

type Row = typeof connections.$inferSelect;

export const connectionUrl = (provider: string, externalId: string) =>
  provider === "steam"
    ? `https://steamcommunity.com/profiles/${externalId}`
    : `https://discord.com/users/${externalId}`;

const view = (row: Row): Connection => ({
  provider: row.provider as ConnectionProvider,
  externalId: row.externalId,
  name: row.name,
  username: row.username,
  url: connectionUrl(row.provider, row.externalId),
  hidden: row.hidden,
  createdAt: row.createdAt.toISOString(),
});

/** The linked accounts a profile shows (not hidden), for anyone who may see the card. */
export async function connectionBadges(db: Deps["db"], accountId: string): Promise<ConnectionBadge[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(and(eq(connections.accountId, accountId), eq(connections.hidden, false)))
    .orderBy(asc(connections.provider));
  return rows.map((row) => ({
    provider: row.provider as ConnectionProvider,
    name: row.name,
    username: row.username,
    url: connectionUrl(row.provider, row.externalId),
  }));
}

const failed = (what: string) => new HttpError(400, ErrorCode.connectionFailed, what);

/** Linking Steam and Discord accounts to the profile, and hiding or unlinking them. The redirect
 *  pages are the website's /connections/<provider>/callback and nothing else; the state is one
 *  use, ten minutes, and bound to the account that started it. Discord's token is used once for
 *  who the user is, then revoked; nothing of it is kept. */
export function connectionRoutes(deps: Deps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const limit = rateLimiter(valkey, deps.limits);
  const discord = deps.providers.discord;
  const steamFetch = deps.steam?.fetch ?? fetch;
  const available = {
    steam: true,
    // Linking needs the client secret; without it the feature is hidden.
    discord: Boolean(discord.clientId && discord.clientSecret),
  };
  const redirectUri = (provider: ConnectionProvider) =>
    new URL(`/connections/${provider}/callback`, deps.publicUrl).toString();
  const steamReturnTo = (state: string) => `${redirectUri("steam")}?state=${encodeURIComponent(state)}`;
  const providerOf = (raw: string) => {
    if (!connectionProviders.includes(raw as ConnectionProvider))
      throw new HttpError(404, ErrorCode.notFound, "Unknown provider");
    return raw as ConnectionProvider;
  };

  app.get("/me/connections", async (c) => {
    const rows = await db
      .select()
      .from(connections)
      .where(eq(connections.accountId, c.get("userId")))
      .orderBy(asc(connections.provider));
    return c.json({ connections: rows.map(view), available });
  });

  /** Where to send the browser to link: Steam's sign-in page or Discord's consent screen. */
  app.post("/me/connections/:provider/start", async (c) => {
    const me = c.get("userId");
    const provider = providerOf(c.req.param("provider"));
    if (!available[provider])
      throw new HttpError(400, ErrorCode.providerDisabled, `Linking ${provider} is not set up here`);
    await limit("connection", me);
    const state = secret(24);
    const verifier = provider === "discord" ? secret(48) : null;
    await valkey.set(stateKey(state), JSON.stringify({ userId: me, provider, verifier }), "EX", stateSeconds);
    if (provider === "steam") {
      const url = new URL(steamLogin);
      url.search = new URLSearchParams({
        "openid.ns": openIdNs,
        "openid.mode": "checkid_setup",
        "openid.return_to": steamReturnTo(state),
        "openid.realm": new URL(deps.publicUrl).origin,
        "openid.identity": `${openIdNs}/identifier_select`,
        "openid.claimed_id": `${openIdNs}/identifier_select`,
      }).toString();
      return c.json({ url: url.toString(), expiresIn: stateSeconds });
    }
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: discord.clientId,
      scope: "identify",
      state,
      redirect_uri: redirectUri("discord"),
      code_challenge: createHash("sha256")
        .update(verifier as string)
        .digest("base64url"),
      code_challenge_method: "S256",
      prompt: "consent",
    }).toString();
    return c.json({ url: url.toString(), expiresIn: stateSeconds });
  });

  /** Checks the provider's answer, then links the account (or renames it, linked again). */
  app.post("/me/connections/:provider/finish", async (c) => {
    const me = c.get("userId");
    const provider = providerOf(c.req.param("provider"));
    const input = await body(c, ConnectionFinish);
    await limit("connection", me);
    const kept = await valkey.getdel(stateKey(input.state));
    const started = kept
      ? (JSON.parse(kept) as { userId: string; provider: string; verifier: string | null })
      : null;
    if (!started || started.userId !== me || started.provider !== provider)
      throw failed("This link has expired or was started elsewhere; start again");
    const who =
      provider === "steam"
        ? await steamIdentity(input.params ?? {}, steamReturnTo(input.state))
        : await discordIdentity(input.code, started.verifier ?? "");
    try {
      const [row] = await db
        .insert(connections)
        .values({ accountId: me, provider, ...who })
        .onConflictDoUpdate({
          target: [connections.accountId, connections.provider],
          set: { ...who, updatedAt: new Date() },
        })
        .returning();
      return c.json({ connection: view(row as Row) }, 201);
    } catch (error) {
      if ((error as { constraint_name?: string }).constraint_name === "one_account_per_connection")
        throw new HttpError(409, ErrorCode.connectionTaken, "That account is linked to someone else");
      throw error;
    }
  });

  app.patch("/me/connections/:provider", async (c) => {
    const provider = providerOf(c.req.param("provider"));
    const { hidden } = await body(c, ConnectionUpdate);
    const [row] = await db
      .update(connections)
      .set({ hidden, updatedAt: new Date() })
      .where(and(eq(connections.accountId, c.get("userId")), eq(connections.provider, provider)))
      .returning();
    if (!row) throw new HttpError(404, ErrorCode.notFound, "Not linked");
    return c.json({ connection: view(row) });
  });

  app.delete("/me/connections/:provider", async (c) => {
    const provider = providerOf(c.req.param("provider"));
    await db
      .delete(connections)
      .where(and(eq(connections.accountId, c.get("userId")), eq(connections.provider, provider)));
    return c.body(null, 204);
  });

  /** Steam's OpenID 2.0 answer: for our return address exactly, from Steam's endpoint, a SteamID
   *  claimed, and confirmed by Steam itself (check_authentication). */
  async function steamIdentity(params: Record<string, string>, returnTo: string) {
    const claimed = params["openid.claimed_id"] ?? "";
    const signed = (params["openid.signed"] ?? "").split(",");
    const steamId = claimed.match(steamIdUrl)?.[1];
    if (
      params["openid.ns"] !== openIdNs ||
      params["openid.mode"] !== "id_res" ||
      params["openid.op_endpoint"] !== steamLogin ||
      params["openid.return_to"] !== returnTo ||
      params["openid.identity"] !== claimed ||
      !steamId ||
      !["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"].every((f) =>
        signed.includes(f),
      )
    )
      throw failed("Steam's answer is not one this site asked for");
    const check = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (key.startsWith("openid.")) check.set(key, value);
    check.set("openid.mode", "check_authentication");
    const answer = await steamFetch(steamLogin, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: check,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    const text = answer?.ok ? await answer.text() : "";
    if (!/^is_valid\s*:\s*true\s*$/m.test(text)) throw failed("Steam did not confirm this sign-in");
    return { externalId: steamId, name: await steamPersona(steamId), username: null };
  }

  /** The Steam persona name: from the Web API with STEAM_WEB_API_KEY, else from the public
   *  profile; null when neither says. */
  async function steamPersona(steamId: string) {
    const key = deps.steam?.apiKey;
    try {
      if (key) {
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamId}`;
        const answer = await steamFetch(url, { signal: AbortSignal.timeout(8000) });
        const data = (await answer.json()) as { response?: { players?: { personaname?: string }[] } };
        const name = data.response?.players?.[0]?.personaname;
        if (name) return name.slice(0, 64);
      }
      const answer = await steamFetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
        signal: AbortSignal.timeout(8000),
      });
      const xml = answer.ok ? await answer.text() : "";
      const name = xml.match(/<steamID><!\[CDATA\[([^\]]{1,64})\]\]><\/steamID>/)?.[1];
      return name ?? null;
    } catch {
      // The name is a nicety; the link holds without it.
      return null;
    }
  }

  /** Discord's code for its user, with the PKCE verifier and our client secret; the token is
   *  revoked as soon as the user is known. */
  async function discordIdentity(code: string | undefined, verifier: string) {
    if (!code) throw failed("Discord sent no code");
    const client = { client_id: discord.clientId, client_secret: discord.clientSecret };
    const exchange = await discord
      .fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri("discord"),
          ...client,
        }),
      })
      .catch(() => undefined);
    const token = exchange?.ok
      ? ((await exchange.json()) as { access_token?: string }).access_token
      : undefined;
    if (!token) throw failed("Discord did not confirm this account");
    try {
      const me = await discord.fetch("https://discord.com/api/users/@me", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!me.ok) throw failed("Discord did not confirm this account");
      const user = (await me.json()) as { id?: string; username?: string; global_name?: string | null };
      if (!user.id || !/^\d{5,25}$/.test(user.id)) throw failed("Discord did not confirm this account");
      return {
        externalId: user.id,
        name: (user.global_name ?? user.username ?? null)?.slice(0, 64) ?? null,
        username: user.username?.slice(0, 64) ?? null,
      };
    } finally {
      await discord
        .fetch("https://discord.com/api/oauth2/token/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, token_type_hint: "access_token", ...client }),
        })
        .catch(() => undefined);
    }
  }

  return app;
}
