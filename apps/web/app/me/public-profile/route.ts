import { relayBody } from "@/lib/session";

/** The public profile switch: whether people who are not friends see more than the minimal card. */
export async function PATCH(request: Request) {
  return relayBody(request, "/me/public-profile", "PATCH");
}
