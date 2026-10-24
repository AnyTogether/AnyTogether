import { type ErrorCode, problem } from "@anytogether/shared";

/** An error the client should see, as problem details with a stable code, any extension members
 *  (RFC 9457) and headers such as Retry-After. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toProblem() {
    return { ...problem(this.status, this.code, this.message), ...this.extra };
  }
}
