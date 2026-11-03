/** Steam's OpenID 2.0 sign-in, used to link a Steam account (connections.ts) and to sign in with
 *  one that is linked (auth/routes.ts). Steam is the only OpenID provider: its endpoint is fixed,
 *  and every answer is confirmed by Steam itself with check_authentication. */

export const steamLogin = "https://steamcommunity.com/openid/login";
const openIdNs = "http://specs.openid.net/auth/2.0";
const steamIdUrl = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

/** Where to send the browser: Steam's sign-in page, which comes back to `returnTo`. */
export function steamSignInUrl(returnTo: string, realm: string) {
  const url = new URL(steamLogin);
  url.search = new URLSearchParams({
    "openid.ns": openIdNs,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": `${openIdNs}/identifier_select`,
    "openid.claimed_id": `${openIdNs}/identifier_select`,
  }).toString();
  return url.toString();
}

/** Steam's answer checked: for our return address exactly, from Steam's endpoint, a SteamID
 *  claimed, the fields that matter signed, and confirmed by Steam (check_authentication, sent to
 *  Steam's fixed address, never to one the answer names). The SteamID, or null when any of it
 *  fails. */
export async function verifiedSteamId(
  fetcher: typeof fetch,
  params: Record<string, string>,
  returnTo: string,
): Promise<string | null> {
  const claimed = params["openid.claimed_id"] ?? "";
  const signed = (params["openid.signed"] ?? "").split(",");
  const steamId = claimed.match(steamIdUrl)?.[1];
  if (
    params["openid.ns"] !== openIdNs ||
    params["openid.mode"] !== "id_res" ||
    params["openid.op_endpoint"] !== steamLogin ||
    params["openid.return_to"] !== returnTo ||
    params["openid.identity"] !== claimed ||
    !steamId ||
    !["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"].every((f) => signed.includes(f))
  )
    return null;
  const check = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (key.startsWith("openid.")) check.set(key, value);
  check.set("openid.mode", "check_authentication");
  const answer = await fetcher(steamLogin, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: check,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  const text = answer?.ok ? await answer.text().catch(() => "") : "";
  return /^is_valid\s*:\s*true\s*$/m.test(text) ? steamId : null;
}
