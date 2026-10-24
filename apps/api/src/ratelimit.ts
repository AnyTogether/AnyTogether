import { ErrorCode } from "@anytogether/shared";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { Redis } from "ioredis";
import { HttpError } from "./errors.js";

/** How many of something per window (seconds); counters live in Valkey as rl:<name>:<who>:<window>.
 *  Over a limit the answer is 429 with Retry-After. */
export const defaultLimits = {
  /** Every request from one address. Generous: a household or a phone network shares one. */
  ip: { max: 600, seconds: 60 },
  /** Every request of one signed-in account. */
  account: { max: 300, seconds: 60 },
  /** Sign-in attempts from one address: codes asked and tried, provider and passkey sign-ins,
   *  hand-offs. */
  signIn: { max: 30, seconds: 900 },
  /** Passkey challenges asked from one address (the sign-in page asks on every visit). */
  passkeyChallenge: { max: 120, seconds: 900 },
  /** Passkeys being added by one account. */
  passkey: { max: 20, seconds: 3600 },
  /** Token calls from one address: refreshes, and launchers polling for a device code. */
  token: { max: 300, seconds: 600 },
  /** Friend requests sent by one account. */
  friendRequest: { max: 50, seconds: 86_400 },
  /** People searches by one account (the friends page searches as you type). */
  search: { max: 120, seconds: 60 },
  /** Changes to one's profile, handle and privacy. */
  profile: { max: 30, seconds: 3600 },
  /** Avatar uploads per account. */
  avatar: { max: 10, seconds: 3600 },
  /** Reports sent by one account. */
  report: { max: 20, seconds: 86_400 },
  /** Data exports per account. */
  export: { max: 5, seconds: 3600 },
  /** Account-deletion codes mailed per account. */
  deletionCode: { max: 5, seconds: 3600 },
  /** Messages sent by one account: a minute's burst, and a day's. */
  message: { max: 30, seconds: 60 },
  messageDay: { max: 1000, seconds: 86_400 },
  /** Calls started (rung or joined) by one account. */
  call: { max: 60, seconds: 3600 },
  /** Game sessions opened by one account. */
  gameSession: { max: 120, seconds: 3600 },
  /** Share plays started by one account. */
  sharePlay: { max: 60, seconds: 3600 },
  /** Reactions to feed items by one account. */
  reaction: { max: 300, seconds: 3600 },
  /** Themes shared or updated by one account. */
  themeUpload: { max: 20, seconds: 86_400 },
  /** Likes and unlikes of themes by one account. */
  themeLike: { max: 300, seconds: 3600 },
  /** Compatibility reports sent by one account. */
  compatReport: { max: 60, seconds: 86_400 },
  /** Gateway tickets for the website, per account (one per socket it opens). */
  realtimeTicket: { max: 60, seconds: 60 },
};
export type Limits = { [name in keyof typeof defaultLimits]: { max: number; seconds: number } };

/** Counts one more for `who` and refuses with 429 and Retry-After past the limit. */
export function rateLimiter(valkey: Redis, overrides: Partial<Limits> = {}) {
  const limits: Limits = { ...defaultLimits, ...overrides };
  return async (name: keyof Limits, who: string) => {
    const { max, seconds } = limits[name];
    const window = Math.floor(Date.now() / 1000 / seconds);
    const key = `rl:${name}:${who}:${window}`;
    const [[, count] = []] =
      (await valkey
        .multi()
        .incr(key)
        .expire(key, seconds + 5)
        .exec()) ?? [];
    if (Number(count) <= max) return;
    const retry = (window + 1) * seconds - Math.floor(Date.now() / 1000);
    throw new HttpError(
      429,
      ErrorCode.rateLimited,
      "Too many requests; try again later",
      {},
      { "retry-after": String(Math.max(1, retry)) },
    );
  };
}

/** Which header holds the caller's address, as the proxy in front sets it:
 *  - "cf-connecting-ip" (the default): Cloudflare's, then X-Real-IP, then the socket's. Only right
 *    behind Cloudflare, or behind a proxy that drops a CF-Connecting-IP sent by the caller (the
 *    Caddyfile in deploy/ does).
 *  - "x-real-ip": the proxy's X-Real-IP, then the socket's; a CF-Connecting-IP is ignored.
 *  - "socket": the connection's own address (nothing in front). */
export const clientIpHeaders = ["cf-connecting-ip", "x-real-ip", "socket"] as const;
export type ClientIpHeader = (typeof clientIpHeaders)[number];

/** The caller's address, from the header `trusted` names (the website passes the browser's
 *  headers on when it calls the API for it), else the socket's. */
export function clientIp(c: Context, trusted: ClientIpHeader = "cf-connecting-ip") {
  const names =
    trusted === "cf-connecting-ip"
      ? ["cf-connecting-ip", "x-real-ip"]
      : trusted === "x-real-ip"
        ? ["x-real-ip"]
        : [];
  for (const name of names) {
    const value = c.req.header(name)?.trim();
    if (value) return value.slice(0, 64);
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Counts the request against a per-address limit. */
export function perIp(
  deps: { valkey: Redis; limits?: Partial<Limits> | undefined; clientIpHeader?: ClientIpHeader | undefined },
  name: keyof Limits,
): MiddlewareHandler {
  const limit = rateLimiter(deps.valkey, deps.limits);
  return async (c, next) => {
    await limit(name, clientIp(c, deps.clientIpHeader));
    await next();
  };
}
