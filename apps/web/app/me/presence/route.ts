import { relayBody } from "@/lib/session";

/** Appear offline, or online again. */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/presence", "PATCH");
}
