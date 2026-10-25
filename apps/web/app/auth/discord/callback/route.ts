import { timingSafeEqual } from "node:crypto";
import { samePath } from "@/lib/paths";
import {
  accessCookie,
  api,
  cookieOptions,
  discordCookie,
  goTo,
  keepAppealToken,
  publicOrigin,
  refreshCookie,
} from "@/lib/session";
import { cookies } from "next/headers";

const same = (a: string, b: string) =>
  a.length === b.length && a.length > 0 && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Back from Discord: the state must be the one this browser left with; the code and verifier go
 *  to the API, which signs in (or refuses a banned account, saying why on /restricted). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const kept = jar.get(discordCookie)?.value;
  jar.delete(discordCookie);
  const trip = (() => {
    try {
      return kept ? (JSON.parse(kept) as { state: string; verifier: string; next: string }) : null;
    } catch {
      return null;
    }
  })();
  const failed = () => goTo("/login?error=discord");
  const code = url.searchParams.get("code");
  if (!trip || !code || !same(url.searchParams.get("state") ?? "", trip.state)) return failed();
  const response = await api("/auth/oidc/discord", {
    method: "POST",
    body: JSON.stringify({
      code,
      codeVerifier: trip.verifier,
      redirectUri: `${await publicOrigin()}/auth/discord/callback`,
      deviceName: "Browser",
    }),
  }).catch(() => undefined);
  const body = (await response?.json().catch(() => ({}))) ?? {};
  if (response?.status === 403 && body.code === "account_banned") {
    await keepAppealToken(body);
    return goTo("/restricted");
  }
  if (!response?.ok) return failed();
  jar.set(accessCookie, body.accessToken, cookieOptions(body.expiresIn));
  jar.set(refreshCookie, body.refreshToken, cookieOptions(90 * 86_400));
  return goTo(samePath(trip.next));
}
