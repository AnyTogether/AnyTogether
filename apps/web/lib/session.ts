import "server-only";
import { cookies, headers } from "next/headers";
import { type Appeal, type Restriction, appealCookie } from "./restrictions";

export const accessCookie = "at_access";
export const refreshCookie = "at_refresh";

/** The API, from the website's server: inside the server's network, or the public address. */
export const apiUrl = () => process.env.API_URL ?? "http://127.0.0.1:8080";

export interface Me {
  account: { id: string; email: string | null; role?: string };
  /** appearOffline: older API answers lack it. */
  profile: { handle: string; displayName: string; avatar: string | null; appearOffline?: boolean };
  /** A mute in force (older API answers have none). */
  restrictions?: Restriction[];
  appeal?: Appeal | null;
}

/** The browser's address as the proxy in front of the website saw it, passed on so the API counts
 *  its limits per person and not per website. */
export async function forwardedFor(): Promise<Record<string, string>> {
  const incoming = await headers().catch(() => undefined);
  const passed: Record<string, string> = {};
  for (const name of ["cf-connecting-ip", "x-real-ip"]) {
    const value = incoming?.get(name);
    if (value) passed[name] = value;
  }
  return passed;
}

export async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${apiUrl()}/api/v1${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "anytogether-client": "web/0.1",
      ...(await forwardedFor()),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

/** Who is signed in on this browser, if anyone (the middleware keeps the access token fresh). */
export async function currentUser(): Promise<Me | null> {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return null;
  const response = await api("/me", { token });
  return response.ok ? ((await response.json()) as Me) : null;
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** The signed-in browser's access token, read from its HttpOnly cookie. */
export async function accessToken() {
  return (await cookies()).get(accessCookie)?.value;
}

/** A GET for the signed-in user, parsed; null when signed out or when the API says no. */
export async function apiJson<T>(path: string): Promise<{ status: number; body: T | null }> {
  const token = await accessToken();
  if (!token) return { status: 401, body: null };
  const response = await api(path, { token }).catch(() => undefined);
  if (!response) return { status: 502, body: null };
  return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
}

/** Passes a browser's call to the API with its access token and hands the answer back as is. */
export async function relay(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  const response = await api(path, { ...init, token }).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(response.status === 204 ? null : await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Passes a browser's JSON body on to the API as it came (the API checks it). */
export async function relayBody(request: Request, path: string, method: string) {
  const text = await request.text().catch(() => "");
  if (text.length > 16_384) return Response.json({ code: "payload_too_large" }, { status: 413 });
  return relay(path, { method, ...(text ? { body: text } : {}) });
}

/** How many friend requests wait for an answer (the header's badge). */
export async function incomingRequests() {
  const { body } = await apiJson<{ incoming: unknown[] }>("/me/friends/requests");
  return body?.incoming.length ?? 0;
}

/** A GET anyone may make, with the access token when signed in (for "liked" and "mine"). */
export async function publicJson<T>(path: string): Promise<{ status: number; body: T | null }> {
  const token = await accessToken();
  const response = await api(path, token ? { token } : {}).catch(() => undefined);
  if (!response) return { status: 502, body: null };
  return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
}

/** Passes a browser's upload (a multipart form, files and all) on to the API as it came. */
export async function relayUpload(request: Request, path: string, maxBytes: number) {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  const tooBig = () =>
    Response.json({ code: "payload_too_large", title: "That is too big" }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooBig();
  const bytes = await request.arrayBuffer().catch(() => undefined);
  if (!bytes) return Response.json({ code: "bad_request", title: "The upload broke off" }, { status: 400 });
  if (bytes.byteLength > maxBytes) return tooBig();
  const response = await api(path, {
    method: "POST",
    token,
    body: bytes,
    headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream" },
  }).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The token that opens one's restrictions and appeals: the access token, or the appeal token a
 *  refused sign-in left (a banned account has no session). */
export async function restrictionToken() {
  const jar = await cookies();
  return jar.get(accessCookie)?.value ?? jar.get(appealCookie)?.value;
}

/** Keeps an appeal token from a refused sign-in (403 account_banned with appealToken) for the
 *  hour it works. */
export async function keepAppealToken(body: { appealToken?: unknown; appealTokenExpiresIn?: unknown }) {
  if (typeof body.appealToken !== "string") return;
  const seconds = typeof body.appealTokenExpiresIn === "number" ? body.appealTokenExpiresIn : 3600;
  (await cookies()).set(appealCookie, body.appealToken, cookieOptions(seconds));
}

/** A refused sign-in's answer for the browser: the appeal token stays in its cookie, never in
 *  the page. */
export async function refusedSignIn(body: Record<string, unknown>, status: number) {
  await keepAppealToken(body);
  const { appealToken: _token, ...rest } = body;
  return Response.json(rest, { status });
}

/** Kept for a Discord sign-in's trip to Discord and back: the state and the PKCE verifier. */
export const discordCookie = "at_discord";

/** A redirect to a path on this site (a relative Location: request.url is the address the server
 *  listens on, not the site's). */
export const goTo = (path: string) => new Response(null, { status: 303, headers: { location: path } });

/** The site's public address, for redirect URIs given to Discord: PUBLIC_URL, or as reached. */
export async function publicOrigin() {
  if (process.env.PUBLIC_URL) return new URL(process.env.PUBLIC_URL).origin;
  const { siteOrigin } = await import("./site");
  return siteOrigin();
}
