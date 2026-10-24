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
  accountBanned: "account_banned",
  /** A passkey's challenge was used already or is too old: ask for a new one. */
  challengeExpired: "challenge_expired",
  /** The passkey is unknown here (removed, or made for another site) or its signature is wrong. */
  passkeyInvalid: "passkey_invalid",
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
