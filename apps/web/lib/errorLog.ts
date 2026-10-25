/** Server-side errors, one JSON line each (instrumentation.ts), with the error ID the error page
 *  shows (Next's digest) and the request ID the middleware gave the request, so a report with the
 *  ID finds its line: docker compose logs web | grep <id>. Never the query string (sign-in links
 *  carry tokens there), headers or the visitor's address. */

export const requestIdHeader = "x-request-id";

/** An ID a proxy in front already gave the request (letters, digits, dashes), or a new one. */
export function requestId(incoming: string | null | undefined): string {
  return incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

export function errorLogLine(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath?: string; routeType?: string; renderSource?: string },
  now = new Date(),
): string {
  const err = error instanceof Error ? (error as Error & { digest?: string }) : null;
  const header = request.headers[requestIdHeader];
  return JSON.stringify({
    level: "error",
    at: now.toISOString(),
    errorId: err?.digest ?? null,
    requestId: (Array.isArray(header) ? header[0] : header) ?? null,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath ?? null,
    kind: context.routeType ?? null,
    source: context.renderSource ?? null,
    error: err ? `${err.name}: ${err.message}` : String(error),
    stack:
      err?.stack
        ?.split("\n")
        .slice(1, 8)
        .map((line) => line.trim()) ?? [],
  });
}
