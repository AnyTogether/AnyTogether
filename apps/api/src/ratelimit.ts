import { ErrorCode } from "@anytogether/shared";
import type { Redis } from "ioredis";
import { HttpError } from "./errors.js";

/** How many of something per window (seconds); counters live in Valkey as rl:<name>:<who>:<window>. */
export const defaultLimits = {
  /** Avatar uploads per account. */
  avatar: { max: 10, seconds: 3600 },
  /** Data exports per account. */
  export: { max: 5, seconds: 3600 },
  /** Account-deletion codes mailed per account. */
  deletionCode: { max: 5, seconds: 3600 },
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
