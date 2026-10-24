/** Stable error codes; every client translates them into its own language. */
export const ErrorCode = {
  badRequest: "bad_request",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
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
  return { type: `https://anytogether.kodla.agency/errors/${code.replaceAll("_", "-")}`, title, status, code, ...(detail ? { detail } : {}) };
}
