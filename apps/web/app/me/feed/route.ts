import { relay } from "@/lib/session";

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An older page of the home feed. */
export async function GET(request: Request) {
  const before = new URL(request.url).searchParams.get("before");
  return relay(`/me/feed${before && id.test(before) ? `?before=${before}` : ""}`);
}
