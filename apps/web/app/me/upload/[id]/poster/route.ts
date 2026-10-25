import { fromThisSite } from "@/lib/origin";
import { accessToken } from "@/lib/session";
import { stream } from "@/lib/upload";

/** The still before a clip plays, made in the browser from the clip. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  if (!fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  return stream(request, `/me/media/${id}/poster`, "PUT", token, 2);
}
