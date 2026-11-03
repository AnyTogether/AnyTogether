import { samePath } from "@/lib/paths";
import { api, cookieOptions, goTo, steamCookie } from "@/lib/session";
import { cookies } from "next/headers";

const steamLogin = "https://steamcommunity.com/openid/login";

/** Sends the browser to Steam's sign-in page. The API gives the state and Steam's address; the
 *  state is kept in this browser's cookie, so only the browser that started can finish. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = await api("/auth/steam/start", { method: "POST", body: "{}" }).catch(() => undefined);
  const started = (await response?.json().catch(() => null)) as { url?: unknown; state?: unknown } | null;
  if (
    !response?.ok ||
    typeof started?.state !== "string" ||
    typeof started.url !== "string" ||
    !started.url.startsWith(`${steamLogin}?`)
  )
    return goTo("/login?error=steam");
  const next = samePath(url.searchParams.get("next"));
  // Ten minutes for the trip to Steam and back, as the API keeps the state.
  (await cookies()).set(steamCookie, JSON.stringify({ state: started.state, next }), cookieOptions(600));
  return new Response(null, { status: 303, headers: { location: started.url } });
}
