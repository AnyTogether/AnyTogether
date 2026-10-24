import { isUserId } from "@/lib/people";
import { relay } from "@/lib/session";

/** Signs out one session (session IDs look like user IDs). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUserId(id)) return Response.json({ code: "not_found", title: "No such session" }, { status: 404 });
  return relay(`/auth/sessions/${id}`, { method: "DELETE" });
}
