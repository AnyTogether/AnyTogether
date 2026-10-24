import { relay } from "@/lib/session";

/** Signs out every other session; this browser stays signed in. */
export async function DELETE() {
  return relay("/auth/sessions?keep=current", { method: "DELETE" });
}
