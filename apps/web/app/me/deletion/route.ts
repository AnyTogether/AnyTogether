import { relay } from "@/lib/session";

/** Mails the code that confirms deleting the account. */
export async function POST() {
  return relay("/me/deletion", { method: "POST", body: "{}" });
}
