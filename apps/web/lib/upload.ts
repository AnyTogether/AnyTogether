import "server-only";
import { apiUrl, forwardedFor } from "@/lib/session";

/** Passes a body on to the API without reading it whole, refusing one that says it is too big. */
export async function stream(request: Request, path: string, method: string, token: string, maxMb: number) {
  const length = request.headers.get("content-length");
  if (Number(length ?? 0) > maxMb * 1024 * 1024)
    return Response.json({ code: "payload_too_large", title: `At most ${maxMb} MB` }, { status: 413 });
  const response = await fetch(`${apiUrl()}/api/v1${path}`, {
    method,
    cache: "no-store",
    body: request.body,
    // A streamed request body (Node's fetch needs to be told).
    duplex: "half",
    headers: {
      "anytogether-client": "web/0.1",
      authorization: `Bearer ${token}`,
      "content-type": request.headers.get("content-type") ?? "application/octet-stream",
      ...(length ? { "content-length": length } : {}),
      ...(await forwardedFor()),
    },
  } as RequestInit).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
