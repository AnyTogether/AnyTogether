import { accessToken, api, goTo } from "@/lib/session";

/** Where Steam and Discord send the browser back: their answer goes to the API, which checks it
 *  against the state it gave; then back to the settings, saying how it went. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (query: string) => goTo(`/settings?${query}#connections`);
  if (provider !== "steam" && provider !== "discord") return back("link_error=unknown");
  const token = await accessToken();
  if (!token) return goTo("/login?next=/settings");
  // Turned down on Discord's screen, or cancelled on Steam's.
  if (url.searchParams.get("error") || url.searchParams.get("openid.mode") === "cancel")
    return back("link_error=cancelled");
  const state = url.searchParams.get("state") ?? "";
  const body =
    provider === "discord"
      ? { state, code: url.searchParams.get("code") ?? "" }
      : {
          state,
          params: Object.fromEntries([...url.searchParams].filter(([key]) => key.startsWith("openid."))),
        };
  const response = await api(`/me/connections/${provider}/finish`, {
    method: "POST",
    token,
    body: JSON.stringify(body),
  }).catch(() => undefined);
  if (response?.ok) return back(`linked=${provider}`);
  const problem = (await response?.json().catch(() => ({}))) as { code?: string } | undefined;
  return back(`link_error=${problem?.code === "connection_taken" ? "taken" : "failed"}&provider=${provider}`);
}
