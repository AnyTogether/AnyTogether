import { familyPathAllowed, familyQueries } from "@/lib/family";
import { fromThisSite } from "@/lib/origin";
import { relay } from "@/lib/session";

/** The family page's calls to the API: only the family paths (lib/family.ts), only their query
 *  parameters, and a changing call only from this website's pages. */
async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!familyPathAllowed(request.method, path))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  if (request.method !== "GET" && !fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const url = new URL(request.url);
  const search = new URLSearchParams();
  for (const key of familyQueries) {
    const value = url.searchParams.get(key);
    if (value !== null && /^[0-9A-Za-z-]{1,40}$/.test(value)) search.set(key, value);
  }
  const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.text();
  if (body && body.length > 16_384)
    return Response.json({ code: "bad_request", title: "Too big" }, { status: 413 });
  return relay(`/${path}${search.size ? `?${search}` : ""}`, {
    method: request.method,
    ...(body ? { body } : {}),
  });
}

export { pass as GET, pass as POST, pass as PATCH, pass as DELETE };
