import { isUserId } from "@/lib/people";
import { relay } from "@/lib/session";

/** Removes a friend, or takes back a request this account sent. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!isUserId(userId)) return Response.json({ code: "not_found", title: "No such user" }, { status: 404 });
  return relay(`/me/friends/${userId}`, { method: "DELETE" });
}
