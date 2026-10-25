/** Stable error codes; every client translates them into its own language. */
export const ErrorCode = {
  badRequest: "bad_request",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
  conflict: "conflict",
  unknownDevice: "unknown_device",
  unknownTrophy: "unknown_trophy",
  /** A party, group or game session has no room left. */
  full: "full",
  /** Only a party's leader may do this for the party (e.g. let a looking-for-group player in). */
  notPartyLeader: "not_party_leader",
  /** Joining a game session needs the same game version and engine build. */
  versionMismatch: "version_mismatch",
  rateLimited: "rate_limited",
  upgradeRequired: "upgrade_required",
  providerDisabled: "provider_disabled",
  providerRejected: "provider_rejected",
  codeInvalid: "code_invalid",
  codeExpired: "code_expired",
  codeLocked: "code_locked",
  pending: "authorization_pending",
  slowDown: "slow_down",
  denied: "access_denied",
  expired: "expired_token",
  refreshReused: "refresh_reused",
  sessionRevoked: "session_revoked",
  handleTaken: "handle_taken",
  handleReserved: "handle_reserved",
  handleCooldown: "handle_cooldown",
  /** The handle looks like someone else's, a held one or a reserved name (0 for o, rn for m,
   *  Cyrillic or Greek letters, separators): see handleSkeleton. */
  handleTooSimilar: "handle_too_similar",
  linksNotAllowed: "links_not_allowed",
  /** A message links to a domain on the server's deny-list. */
  linkBlocked: "link_blocked",
  payloadTooLarge: "payload_too_large",
  unsupportedMedia: "unsupported_media_type",
  badImage: "bad_image",
  /** A theme file that is not a zip with a valid theme.json, or holds something it may not. */
  badTheme: "bad_theme",
  /** A theme needs a still: a preview file, one inside the theme, or a background picture. */
  previewRequired: "preview_required",
  /** Banned or suspended: the answer carries `restriction` and, after a sign-in that proved who
   *  it is, `appealToken` (see POST /me/appeals). */
  accountBanned: "account_banned",
  /** Muted: the account may not write to others now; the answer carries `restriction`. */
  accountMuted: "account_muted",
  /** An appeal is open already: one at a time. */
  appealOpen: "appeal_open",
  /** Mail could not be sent now (the mail server refused or could not be reached). */
  mailUnavailable: "mail_unavailable",
  /** A passkey's challenge was used already or is too old: ask for a new one. */
  challengeExpired: "challenge_expired",
  /** The passkey is unknown here (removed, or made for another site) or its signature is wrong. */
  passkeyInvalid: "passkey_invalid",
  /** A parent's family settings do not allow this for the child (or for reaching the child);
   *  `feature` says which, `side` whether the limit is the asker's own ("self") or the other
   *  person's ("other"). */
  restrictedByFamily: "restricted_by_family",
  /** The server keeps no files (no STORAGE_DIR or S3 bucket): saves and media are off. */
  storageDisabled: "storage_disabled",
  /** Saves and media together would pass the account's quota; the answer has used, limit and
   *  needed (bytes). */
  quotaExceeded: "quota_exceeded",
  /** The cloud has a newer save than the version the upload was based on; the answer has it. */
  saveConflict: "save_conflict",
  /** The bytes received do not have the SHA-256 the upload named. */
  checksumMismatch: "checksum_mismatch",
  /** A clip or voice note that is not the container and codec it must be, or too long. */
  badMedia: "bad_media",
  /** A signed file link whose time is over or whose signature is wrong: ask for a new one. */
  linkExpired: "link_expired",
  internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** RFC 9457 problem details, as every error response carries them. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
}

export function problem(status: number, code: ErrorCode, title: string, detail?: string): Problem {
  return {
    type: `https://anytogether.kodla.agency/errors/${code.replaceAll("_", "-")}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
  };
}
