import { relay } from "@/lib/session";

/** Requests waiting for this account (incoming) and the ones it sent (outgoing). */
export async function GET() {
  return relay("/me/friends/requests");
}

/** Asks someone by handle; asking someone who already asked makes friends at once. */
export async function POST(request: Request) {
  const { handle } = (await request.json().catch(() => ({}))) as { handle?: unknown };
  return relay("/me/friends/requests", {
    method: "POST",
    body: JSON.stringify({ handle: typeof handle === "string" ? handle.trim() : "" }),
  });
}
