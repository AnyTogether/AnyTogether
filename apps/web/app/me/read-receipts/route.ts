import { relayBody } from "@/lib/session";

/** Read receipts on or off. */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/read-receipts", "PATCH");
}
