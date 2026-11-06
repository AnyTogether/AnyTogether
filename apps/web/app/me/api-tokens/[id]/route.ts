import { relay } from "@/lib/session";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Revokes one token. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  return relay(`/me/api-tokens/${id}`, { method: "DELETE" });
}
