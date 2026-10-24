import { relayBody } from "@/lib/session";

/** Changes the name, bio or country. */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/profile", "PATCH");
}
