import { fromThisSite } from "@/lib/origin";
import { relay, relayBody } from "@/lib/session";

const activityId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = { params: Promise<{ id: string }> };

/** Only from this website's pages (cookies are SameSite=Lax already), and only for a real item. */
async function check(request: Request, { params }: Params) {
  const { id } = await params;
  if (!activityId.test(id)) return { refused: Response.json({ code: "not_found" }, { status: 404 }) };
  if (!fromThisSite(request, { required: false }))
    return { refused: Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 }) };
  return { id };
}

/** Reacts to a feed item, or changes the reaction. */
export async function PUT(request: Request, context: Params) {
  const { id, refused } = await check(request, context);
  return refused ?? relayBody(request, `/activities/${id}/reaction`, "PUT");
}

/** Takes the reaction back. */
export async function DELETE(request: Request, context: Params) {
  const { id, refused } = await check(request, context);
  return refused ?? relay(`/activities/${id}/reaction`, { method: "DELETE" });
}
