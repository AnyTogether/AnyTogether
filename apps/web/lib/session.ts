import "server-only";
import { cookies, headers } from "next/headers";

export const accessCookie = "at_access";
export const refreshCookie = "at_refresh";

/** The API, from the website's server: inside the server's network, or the public address. */
export const apiUrl = () => process.env.API_URL ?? "http://127.0.0.1:8080";

export interface Me {
  account: { id: string; email: string | null };
  profile: { handle: string; displayName: string; avatar: string | null };
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
