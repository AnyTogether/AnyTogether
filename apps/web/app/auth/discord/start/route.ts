import { createHash, randomBytes } from "node:crypto";
import { samePath } from "@/lib/paths";
import { api, cookieOptions, discordCookie, goTo, publicOrigin } from "@/lib/session";
import { cookies } from "next/headers";

/** Sends the browser to Discord's consent screen (scope identify and email, so an account with
 *  the same verified address is found), with a state and a PKCE challenge. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const setup = await api("/auth/providers")
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const clientId = setup?.discord?.clientId as string | undefined;
  if (!clientId) return goTo("/login");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const next = samePath(url.searchParams.get("next"));
  // Ten minutes for the trip to Discord and back.
  (await cookies()).set(discordCookie, JSON.stringify({ state, verifier, next }), cookieOptions(600));
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "identify email",
    state,
    redirect_uri: `${await publicOrigin()}/auth/discord/callback`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, { status: 303, headers: { location: authorize.toString() } });
}
