import { api, restrictionToken } from "@/lib/session";

/** Sends an appeal with the access token, or with the appeal token of a refused sign-in. */
export async function POST(request: Request) {
  const token = await restrictionToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  const text = await request.text().catch(() => "");
  if (text.length > 8192) return Response.json({ code: "payload_too_large" }, { status: 413 });
  const response = await api("/me/appeals", { method: "POST", token, body: text || "{}" }).catch(
    () => undefined,
  );
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
