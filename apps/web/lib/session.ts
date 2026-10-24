import "server-only";
import { cookies } from "next/headers";

export const accessCookie = "at_access";
export const refreshCookie = "at_refresh";

/** The API, from the website's server: inside the server's network, or the public address. */
export const apiUrl = () => process.env.API_URL ?? "http://127.0.0.1:8080";

export interface Me {
  account: { id: string; email: string | null };
  profile: { handle: string; displayName: string; avatar: string | null };
}

export async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${apiUrl()}/api/v1${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "anytogether-client": "web/0.1",
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
