import { accessCookie, refreshCookie, relayBody } from "@/lib/session";
import { cookies } from "next/headers";

/** Deletes the account (with the mailed code); this browser is signed out with every other. */
export async function DELETE(request: Request) {
  const response = await relayBody(request, "/me", "DELETE");
  if (response.status === 202) {
    const jar = await cookies();
    jar.delete(accessCookie);
    jar.delete(refreshCookie);
  }
  return response;
}
