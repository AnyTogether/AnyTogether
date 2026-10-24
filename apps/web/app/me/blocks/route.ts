import { relay } from "@/lib/session";

/** Blocks someone: the friendship ends and they can no longer find or ask this account. */
export async function POST(request: Request) {
  const { userId } = (await request.json().catch(() => ({}))) as { userId?: unknown };
  return relay("/me/blocks", { method: "POST", body: JSON.stringify({ userId }) });
}
