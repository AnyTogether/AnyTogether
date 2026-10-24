import { accessCookie, api, cookieOptions, refreshCookie } from "@/lib/session";
import { cookies } from "next/headers";

/** Checks the code (or the mail's link) and keeps the session in HttpOnly cookies. */
export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as { email?: string; code?: string; link?: string };
  const response = await api("/auth/email/verify", { method: "POST", body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok) return Response.json(body, { status: response.status });
  const jar = await cookies();
  jar.set(accessCookie, body.accessToken, cookieOptions(body.expiresIn));
  jar.set(refreshCookie, body.refreshToken, cookieOptions(90 * 86_400));
  return Response.json({ user: body.user });
}
