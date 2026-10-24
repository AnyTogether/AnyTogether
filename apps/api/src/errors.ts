import { type ErrorCode, problem } from "@anytogether/shared";

/** An error the client should see, as problem details with a stable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  toProblem() {
    return problem(this.status, this.code, this.message);
  }
}
