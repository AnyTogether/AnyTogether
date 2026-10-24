import { relay } from "@/lib/session";

/** The options for making a passkey for this account. */
export async function POST() {
  return relay("/auth/passkeys/start", { method: "POST" });
}
