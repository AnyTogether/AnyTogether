import { accessCookie, api, cookieOptions, refreshCookie } from "@/lib/session";
import { cookies } from "next/headers";

/** Checks what the passkey signed and keeps the session in HttpOnly cookies, like the email code. */
export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > 16_384) return Response.json({ code: "payload_too_large" }, { status: 413 });
  const response = await api("/auth/passkey/finish", { method: "POST", body: text || "{}" }).catch(
    () => undefined,
  );
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  const body = await response.json();
  if (!response.ok) return Response.json(body, { status: response.status });
  const jar = await cookies();
  jar.set(accessCookie, body.accessToken, cookieOptions(body.expiresIn));
  jar.set(refreshCookie, body.refreshToken, cookieOptions(90 * 86_400));
  return Response.json({ user: body.user });
}
