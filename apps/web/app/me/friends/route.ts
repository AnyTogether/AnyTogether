import { relay } from "@/lib/session";

/** The friends list with presence (the friends page polls it). */
export async function GET() {
  return relay("/me/friends");
}
