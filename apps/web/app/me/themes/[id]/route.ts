import { relay, relayBody } from "@/lib/session";
import { isThemeId } from "@/lib/themes";

type Params = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ code: "not_found" }, { status: 404 });

/** The maker changes a theme's name or description. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isThemeId(id)) return notFound();
  return relayBody(request, `/themes/${id}`, "PATCH");
}

/** The maker takes a theme off the Hub. */
export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  if (!isThemeId(id)) return notFound();
  return relay(`/themes/${id}`, { method: "DELETE" });
}
