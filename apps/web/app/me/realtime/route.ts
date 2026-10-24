import { accessToken, api } from "@/lib/session";

/** A one-time ticket for the browser's gateway socket. The access token itself never leaves the
 *  HttpOnly cookie: a script on the page (even an injected one) gets at most a ticket that opens
 *  one socket within 30 seconds, not a token that works against the whole API for 15 minutes. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host)
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  const response = await api("/realtime/ticket", { method: "POST", token }).catch(() => undefined);
  if (!response?.ok)
    return Response.json({ code: "unavailable", title: "Try again" }, { status: response?.status ?? 502 });
  const { ticket } = (await response.json()) as { ticket: string };
  return Response.json(
    // Where the browser finds the gateway; by default /rt on this same host.
    { ticket, url: process.env.GATEWAY_PUBLIC_URL || null },
    { headers: { "cache-control": "no-store" } },
  );
}
