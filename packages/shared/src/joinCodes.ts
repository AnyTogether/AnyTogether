import { z } from "zod";
import type { MemberView } from "./messages.js";

/** Join codes: a party leader or share play host hands out a short code (and a link to it) so
 *  people who are not their friends can ask to join. Redeeming one never lets anyone in: it is a
 *  request the leader or host says yes or no to, and a yes is an invite the asker answers. */

/** Eight characters people can read out: no 0/O, no 1/I. Shown as XXXX-XXXX. */
export const joinCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const joinCodeLength = 8;
/** A code lives this many hours unless the leader says otherwise, and at most the most. */
export const joinCodeHours = 24;
export const maxJoinCodeHours = 72;

/** A code as typed or pasted: case, spaces and dashes do not matter. */
export const normalizeJoinCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");
export const isJoinCode = (code: string) =>
  code.length === joinCodeLength && [...code].every((c) => joinCodeAlphabet.includes(c));
/** XXXX-XXXX, for reading out. */
export const formatJoinCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
/** The page a code opens on the website. */
export const joinCodeUrl = (publicUrl: string, code: string) =>
  `${publicUrl.replace(/\/$/, "")}/join/${code}`;

export const JoinCodeIssue = z.object({
  /** How long it works; 24 hours when left out. */
  hours: z.number().int().min(1).max(maxJoinCodeHours).optional(),
});

/** A live code, as the party's members and the share play's host see it. */
export interface JoinCode {
  code: string;
  url: string;
  expiresAt: string;
}

export type JoinCodeKind = "party" | "share_play";
/** Where the reader stands with what a code opens (signed in only). */
export type JoinCodeState = "none" | "member" | "requested" | "invited";

/** What a code opens, as anyone holding it sees it (signed out: no user IDs). */
export interface JoinCodeView {
  code: string;
  kind: JoinCodeKind;
  id: string;
  /** The party's leader or the share play's host. */
  host: MemberView | null;
  game: {
    titleId: string;
    title: string | null;
    names: Record<string, string>;
    iconUrl: string | null;
  } | null;
  /** People in it now (members, or viewers), and the most it holds. */
  size: number;
  max: number;
  expiresAt: string;
  /** Signed in only. */
  state?: JoinCodeState;
}

/** What redeeming a code gives: a request now waiting (or an invite waiting already). */
export interface JoinCodeRedeemed {
  kind: JoinCodeKind;
  id: string;
  state: "requested" | "invited";
}

const discordHosts = new Set([
  "discord.gg",
  "discord.com",
  "www.discord.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

/** A Discord invite or channel link, as https://host/path without query or fragment; null when
 *  it is not one: discord.gg/<invite>, discord.com/invite/<invite>, discord.com/channels/<server>[/<channel>]. */
export function discordLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!discordHosts.has(host)) return null;
  const path = url.pathname.replace(/\/$/, "");
  const fits =
    host === "discord.gg"
      ? /^\/[A-Za-z0-9-]{2,64}$/.test(path)
      : /^\/invite\/[A-Za-z0-9-]{2,64}$/.test(path) || /^\/channels\/\d{5,25}(\/\d{5,25})?$/.test(path);
  return fits ? `https://${host}${path}` : null;
}

/** A party's Discord link, as the leader sets it. */
export const DiscordLink = z
  .string()
  .max(300)
  .transform((raw, ctx) => {
    const link = discordLink(raw);
    if (!link) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a discord.gg or discord.com link" });
      return z.NEVER;
    }
    return link;
  });
