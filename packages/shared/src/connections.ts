import { z } from "zod";

/** Accounts elsewhere a profile can show: Steam (OpenID 2.0) and Discord (OAuth2, scope identify). */
export const connectionProviders = ["steam", "discord"] as const;
export type ConnectionProvider = (typeof connectionProviders)[number];

/** A linked account as its owner sees it (GET /me/connections). */
export interface Connection {
  provider: ConnectionProvider;
  /** The SteamID64 or Discord user ID. */
  externalId: string;
  /** The Steam persona or Discord display name when it was linked; null when unknown. */
  name: string | null;
  /** Discord's username. */
  username: string | null;
  /** Its page: the Steam profile, or the Discord user. */
  url: string;
  /** Left off the profile. */
  hidden: boolean;
  createdAt: string;
}

/** A linked account as a profile shows it to others (the shown ones only). */
export type ConnectionBadge = Pick<Connection, "provider" | "name" | "username" | "url">;

/** POST /me/connections/:provider/finish: what the provider sent back to the redirect page. For
 *  Discord the code; for Steam every openid.* parameter. `state` is the one /start gave. */
export const ConnectionFinish = z.object({
  state: z.string().min(16).max(128),
  code: z.string().min(4).max(512).optional(),
  params: z.record(z.string().max(2048)).optional(),
});

export const ConnectionUpdate = z.object({ hidden: z.boolean() });
