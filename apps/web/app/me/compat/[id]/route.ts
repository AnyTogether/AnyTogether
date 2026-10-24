import { relay } from "@/lib/session";

/** Takes back one's own report. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ code: "not_found" }, { status: 404 });
  return relay(`/compat/reports/${id}`, { method: "DELETE" });
}
