import { fromThisSite } from "@/lib/origin";
import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The storage and gallery calls Settings, the profile and the messages page make, by method;
 *  nothing else passes. */
const allowed: Record<string, RegExp[]> = {
  GET: [/^me\/storage$/, /^me\/media$/, /^me\/gallery$/],
  PUT: [/^me\/gallery$/],
  POST: [new RegExp(`^me/saves/versions/${id}/restore$`)],
  DELETE: [
    new RegExp(`^me/media/${id}$`),
    new RegExp(`^me/saves/versions/${id}$`),
    new RegExp(`^me/saves/slots/${id}$`),
  ],
};

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed[request.method]?.some((pattern) => pattern.test(path)))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  if (request.method !== "GET" && !fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const before = new URL(request.url).searchParams.get("before");
  const query = before && new RegExp(`^${id}$`).test(before) ? `?before=${before}` : "";
  const body = request.method === "PUT" || request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > 16_384)
    return Response.json({ code: "bad_request", title: "Too big" }, { status: 413 });
  return relay(`/${path}${query}`, { method: request.method, ...(body ? { body } : {}) });
}

export { pass as GET, pass as PUT, pass as POST, pass as DELETE };
