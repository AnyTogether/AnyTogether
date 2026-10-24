import { accessCookie, api } from "@/lib/session";
import { cookies } from "next/headers";

/** Approves a launcher's device code for the signed-in account. */
export async function POST(request: Request) {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return Response.json({ code: "unauthorized" }, { status: 401 });
  const { userCode } = (await request.json().catch(() => ({}))) as { userCode?: string };
  const response = await api("/auth/device/approve", {
    method: "POST",
    token,
    body: JSON.stringify({ userCode }),
  });
  return new Response(response.status === 204 ? null : await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
