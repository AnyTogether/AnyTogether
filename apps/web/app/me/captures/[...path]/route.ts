import { fromThisSite } from "@/lib/origin";
import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const title = "[A-Z]{4}[0-9]{5}";
const handle = "[a-z0-9_.]{1,40}";

/** The capture calls the Captures feed, a post, a profile and a game page make, by method;
 *  nothing else passes, and only these query parameters. */
const allowed: Record<string, RegExp[]> = {
  GET: [
    /^me\/captures$/,
    new RegExp(`^posts/${id}(/(comments|likes))?$`),
    new RegExp(`^users/${handle}/posts$`),
    new RegExp(`^games/${title}/posts$`),
    /^me\/library$/,
  ],
  POST: [/^posts$/, new RegExp(`^posts/${id}/comments$`)],
  PATCH: [new RegExp(`^posts/${id}$`)],
  PUT: [new RegExp(`^posts/${id}/like$`)],
  DELETE: [
    new RegExp(`^posts/${id}$`),
    new RegExp(`^posts/${id}/like$`),
    new RegExp(`^posts/${id}/comments/${id}$`),
  ],
};

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed[request.method]?.some((pattern) => pattern.test(path)))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  // Cookies are SameSite=Lax already; a changing call must also come from this website's pages.
  if (request.method !== "GET" && !fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const url = new URL(request.url);
  const search = new URLSearchParams();
  const before = url.searchParams.get("before");
  if (before && new RegExp(`^(${id}|${handle})$`).test(before)) search.set("before", before);
  const limit = url.searchParams.get("limit");
  if (limit && /^[0-9]{1,2}$/.test(limit)) search.set("limit", limit);
  const body = request.method === "POST" || request.method === "PATCH" ? await request.text() : undefined;
  if (body && body.length > 16_384)
    return Response.json({ code: "bad_request", title: "Too big" }, { status: 413 });
  return relay(`/${path}${search.size ? `?${search}` : ""}`, {
    method: request.method,
    ...(body ? { body } : {}),
  });
}

export { pass as GET, pass as POST, pass as PATCH, pass as PUT, pass as DELETE };
