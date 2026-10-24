import { relay } from "@/lib/session";

/** People by the start of their handle or name (the add-a-friend search). */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 40) ?? "";
  return relay(`/users/search?q=${encodeURIComponent(query)}`);
}
