import { relayBody } from "@/lib/session";

/** Changes the handle (once per 30 days). */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/handle", "PATCH");
}
