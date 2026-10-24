import { relayBody } from "@/lib/session";

/** Reports someone to the moderators. */
export async function POST(request: Request) {
  return relayBody(request, "/reports", "POST");
}
