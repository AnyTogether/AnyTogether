import { accessCookie, api, refreshCookie } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(accessCookie)?.value;
  if (token) await api("/auth/logout", { method: "POST", token }).catch(() => undefined);
  jar.delete(accessCookie);
  jar.delete(refreshCookie);
  // A relative Location: request.url is the address the server listens on, not the site's.
  return new Response(null, { status: 303, headers: { location: "/" } });
}
