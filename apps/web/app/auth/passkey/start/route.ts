import { api } from "@/lib/session";

/** A challenge for signing in with a passkey (the sign-in page asks for one on every visit). */
export async function POST() {
  const response = await api("/auth/passkey/start", { method: "POST" }).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
