import { language } from "@/lib/i18n";
import { appealCookie } from "@/lib/restrictions";
import { accessCookie, api, cookieOptions, refreshCookie, refusedSignIn } from "@/lib/session";
import { cookies } from "next/headers";

/** Checks the code (or the mail's link) and keeps the session in HttpOnly cookies. */
export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as { email?: string; code?: string; link?: string };
  // The page's language goes with it: a new account keeps it for its mail.
  const lang = await language();
  const response = await api("/auth/email/verify", {
    method: "POST",
    body: JSON.stringify({ email: input.email, code: input.code, link: input.link, lang }),
  });
  const body = await response.json();
  // Banned: the appeal token is kept for /restricted; the browser gets the rest.
  if (!response.ok) return refusedSignIn(body, response.status);
  const jar = await cookies();
  jar.set(accessCookie, body.accessToken, cookieOptions(body.expiresIn));
  jar.set(refreshCookie, body.refreshToken, cookieOptions(90 * 86_400));
  jar.delete(appealCookie);
  return Response.json({ user: body.user });
}
