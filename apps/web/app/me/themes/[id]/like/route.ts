import { relay } from "@/lib/session";
import { isThemeId } from "@/lib/themes";

type Params = { params: Promise<{ id: string }> };

async function like(method: "PUT" | "DELETE", { params }: Params) {
  const { id } = await params;
  if (!isThemeId(id)) return Response.json({ code: "not_found" }, { status: 404 });
  return relay(`/themes/${id}/like`, { method });
}

export const PUT = (_: Request, context: Params) => like("PUT", context);
export const DELETE = (_: Request, context: Params) => like("DELETE", context);
