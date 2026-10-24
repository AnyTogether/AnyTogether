import { relayBody } from "@/lib/session";

/** Sends a report on how a game runs. */
export async function POST(request: Request) {
  return relayBody(request, "/compat/reports", "POST");
}
