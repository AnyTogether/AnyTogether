import { timingSafeEqual } from "node:crypto";
import { language } from "@/lib/i18n";
import { samePath } from "@/lib/paths";
import {
  accessCookie,
  api,
  cookieOptions,
  goTo,
  keepAppealToken,
  refreshCookie,
  steamCookie,
} from "@/lib/session";
import { cookies } from "next/headers";

const same = (a: string, b: string) =>
  a.length === b.length && a.length > 0 && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Back from Steam: the state must be the one this browser left with. Steam's answer goes to the
 *  API, which has Steam confirm it and signs in the account that has this Steam account linked
 *  (or refuses a banned account, saying why on /restricted). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const kept = jar.get(steamCookie)?.value;
  jar.delete(steamCookie);
  const trip = (() => {
    try {
      return kept ? (JSON.parse(kept) as { state: string; next: string }) : null;
    } catch {
      return null;
    }
  })();
  // Cancelled on Steam's page: back to the sign-in, nothing to say.
  if (url.searchParams.get("openid.mode") === "cancel") return goTo("/login");
  const failed = (error = "steam") => goTo(`/login?error=${error}`);
  const state = url.searchParams.get("state") ?? "";
  if (!trip || typeof trip.state !== "string" || !same(state, trip.state)) return failed();
  const params = Object.fromEntries([...url.searchParams].filter(([key]) => key.startsWith("openid.")));
  const response = await api("/auth/steam/finish", {
    method: "POST",
    body: JSON.stringify({ state, params, deviceName: "Browser", lang: await language() }),
  }).catch(() => undefined);
  const body = (await response?.json().catch(() => ({}))) ?? {};
  if (response?.status === 403 && body.code === "account_banned") {
    await keepAppealToken(body);
    return goTo("/restricted");
  }
  if (body.code === "steam_not_linked") return failed("steam_unlinked");
  if (!response?.ok) return failed();
  jar.set(accessCookie, body.accessToken, cookieOptions(body.expiresIn));
  jar.set(refreshCookie, body.refreshToken, cookieOptions(90 * 86_400));
  return goTo(samePath(trip.next));
}
