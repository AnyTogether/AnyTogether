import { relayBody } from "@/lib/session";

/** Who sees the library, trophies, friends and presence, and who finds the account. */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/privacy", "PATCH");
}
