import { z } from "zod";

/** Handles: 3-20 of a-z 0-9 _ . (as accounts.handleFrom makes them), changeable once per 30 days. */
export const handleLength = { min: 3, max: 20 } as const;
export const handleCooldownDays = 30;
/** How long an old handle stays held for its last owner (and points to their profile). */
export const handleHoldDays = 30;

/** Names people could mistake for us or for the service itself. */
const reservedExact = new Set([
  "abuse",
  "account",
  "accounts",
  "admin",
  "administrator",
  "api",
  "auth",
  "billing",
  "bot",
  "contact",
  "everyone",
  "friends",
  "help",
  "here",
  "info",
  "login",
  "logout",
  "me",
  "mod",
  "mods",
  "moderator",
  "moderators",
  "news",
  "nobody",
  "null",
  "playstation",
  "privacy",
  "psn",
  "report",
  "reports",
  "root",
  "security",
  "settings",
  "signin",
  "signup",
  "sony",
  "staff",
  "support",
  "system",
  "team",
  "terms",
  "undefined",
  "user",
  "users",
  "www",
]);
const reservedPrefixes = ["anytogether", "anyps5", "admin", "moderator", "official", "kodla"];

export function isReservedHandle(handle: string) {
  const plain = handle.toLowerCase().replace(/[._]/g, "");
  return (
    reservedExact.has(handle.toLowerCase()) ||
    reservedExact.has(plain) ||
    reservedPrefixes.some((prefix) => plain.startsWith(prefix))
  );
}

export const Handle = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, "").toLowerCase())
  .pipe(
    z
      .string()
      .min(handleLength.min, `at least ${handleLength.min} characters`)
      .max(handleLength.max, `at most ${handleLength.max} characters`)
      .regex(/^[a-z0-9_.]+$/, "only a-z, 0-9, _ and .")
      .refine((value) => !value.startsWith(".") && !value.endsWith("."), "no dot at the start or end")
      .refine((value) => !value.includes(".."), "no two dots in a row"),
  );

/** Invisible and direction-changing characters, which let one name pass for another. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
const invisible = /[\u0000-\u0009\u000B-\u001F\u007F­​-‏‪-‮⁠-⁯﻿]/g;

/** Links and web addresses; bios and names carry none (spam, phishing, piracy sites). */
export function hasLink(text: string) {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+(\.|\s?\[\.\]\s?|\s?\(\.\)\s?)(com|net|org|io|gg|tv|me|ly|co|app|dev|xyz|ru|tk|info|biz|link|site|online|store|shop|top|cc|be|to|sh|live|club|page|fun|win|vip|pro|tr)\b)/i.test(
    text,
  );
}

export const DisplayName = z
  .string()
  .transform((value) => value.replace(invisible, "").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "a name").max(40, "at most 40 characters"));

/** 160 characters, at most one empty line in a row. */
export const Bio = z
  .string()
  .transform((value) =>
    value
      .replace(/\r\n?/g, "\n")
      .replace(invisible, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  )
  .pipe(z.string().max(160, "at most 160 characters"));

/** ISO 3166-1 alpha-2. */
export const countries =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
const countrySet = new Set(countries);
export const Country = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => countrySet.has(value), "a country code like TR or DE");

/** PATCH /me/profile: only what is sent changes; null (or an empty bio) clears. */
export const ProfileUpdate = z.object({
  displayName: DisplayName.optional(),
  bio: Bio.nullable().optional(),
  country: Country.nullable().optional(),
});

export const HandleChange = z.object({ handle: Handle });

/** Who may see a part of a profile. The owner always sees everything. */
export const visibilities = ["everyone", "friends", "nobody"] as const;
export type Visibility = (typeof visibilities)[number];
const VisibilityValue = z.enum(visibilities);

/** library: games and play time; trophies; friends: the friends list; presence: online and what is
 *  being played; search: who finds the account by name (a request to the exact handle always works);
 *  gallery: the pinned screenshots and clips on the profile. */
export const privacySections = ["library", "trophies", "friends", "presence", "search", "gallery"] as const;
export type PrivacySection = (typeof privacySections)[number];
export type Privacy = Record<PrivacySection, Visibility>;
export const defaultPrivacy: Privacy = {
  library: "friends",
  trophies: "friends",
  friends: "friends",
  presence: "friends",
  search: "everyone",
  gallery: "friends",
};

/** The stored settings over the defaults; anything unknown is ignored. */
export function privacyOf(stored: unknown): Privacy {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const result = { ...defaultPrivacy };
  for (const section of privacySections) {
    const value = saved[section];
    if (visibilities.includes(value as Visibility)) result[section] = value as Visibility;
  }
  return result;
}

/** PATCH /me/privacy: only the sections sent change. */
export const PrivacyUpdate = z.object(
  Object.fromEntries(privacySections.map((section) => [section, VisibilityValue.optional()])) as Record<
    PrivacySection,
    z.ZodOptional<typeof VisibilityValue>
  >,
);
