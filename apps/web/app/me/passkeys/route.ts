import { relay, relayBody } from "@/lib/session";

/** The account's passkeys. */
export async function GET() {
  return relay("/auth/passkeys");
}

/** Adds the passkey the browser just made (its name and the authenticator's answer). */
export async function POST(request: Request) {
  return relayBody(request, "/auth/passkeys", "POST");
}
