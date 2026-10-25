import { requestId, requestIdHeader } from "@/lib/errorLog";
import { fromAnotherSite, safeMethods } from "@/lib/origin";
import { type NextRequest, NextResponse } from "next/server";

/** Gives every request an ID (server errors are logged with it); refuses changes sent by other
 *  sites' pages; keeps the access token fresh: when it has expired and a refresh token is there,
 *  turn it in. */
export async function middleware(request: NextRequest) {
  request.headers.set(requestIdHeader, requestId(request.headers.get(requestIdHeader)));
  const pass = () => NextResponse.next({ request: { headers: request.headers } });
  if (!safeMethods.includes(request.method) && fromAnotherSite(request))
    return NextResponse.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  // Signing in and out keeps its own cookies.
  if (request.nextUrl.pathname.startsWith("/auth/")) return pass();
  const response = pass();
  if (request.cookies.get("at_access") || !request.cookies.get("at_refresh")) return response;
  const refreshed = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/v1/auth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anytogether-client": "web/0.1",
      // The API limits token calls per address: the browser's, not the website's.
      ...Object.fromEntries(
        ["cf-connecting-ip", "x-real-ip"].flatMap((name) => {
          const value = request.headers.get(name);
          return value ? [[name, value]] : [];
        }),
      ),
    },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken: request.cookies.get("at_refresh")?.value,
    }),
  }).catch(() => undefined);
  const secure = process.env.NODE_ENV === "production";
  if (!refreshed?.ok) {
    response.cookies.delete("at_refresh");
    return response;
  }
  const tokens = await refreshed.json();
  response.cookies.set("at_access", tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expiresIn,
  });
  response.cookies.set("at_refresh", tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 90 * 86_400,
  });
  // The page being rendered sees the new token too.
  request.cookies.set("at_access", tokens.accessToken);
  return NextResponse.next({ request, headers: response.headers });
}

export const config = { matcher: ["/((?!_next/|api/|favicon|sw\\.js).*)"] };
