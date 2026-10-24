import { accessCookie, api, refreshCookie } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(accessCookie)?.value;
  if (token) await api("/auth/logout", { method: "POST", token }).catch(() => undefined);
  jar.delete(accessCookie);
  jar.delete(refreshCookie);
  return Response.redirect(new URL("/", request.url), 303);
}
