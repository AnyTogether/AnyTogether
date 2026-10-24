import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const seq = "[0-9]{1,15}";

/** The API paths the messages and party pages may reach through here, by method; nothing else
 *  passes, and only these query parameters. */
const allowed: Record<string, RegExp[]> = {
  GET: [
    /^me\/conversations$/,
    /^me\/conversations\/unread$/,
    new RegExp(`^conversations/${id}$`),
    new RegExp(`^conversations/${id}/messages$`),
    /^me\/party$/,
    new RegExp(`^parties/${id}$`),
    new RegExp(`^calls/${id}$`),
    /^ice-servers$/,
  ],
  POST: [
    /^conversations$/,
    new RegExp(`^conversations/${id}/(messages|read|members)$`),
    /^parties$/,
    new RegExp(`^parties/${id}/(invites|join|decline|leave|kick|leader)$`),
    /^calls$/,
    new RegExp(`^calls/${id}/(answer|decline|leave)$`),
  ],
  PATCH: [
    new RegExp(`^conversations/${id}$`),
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^parties/${id}$`),
  ],
  DELETE: [
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^conversations/${id}/members/${id}$`),
  ],
};
const queries = ["before", "after", "limit"];

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed[request.method]?.some((pattern) => pattern.test(path)))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  // Cookies are SameSite=Lax already; a changing call must also come from this website's pages.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && new URL(origin).host !== new URL(request.url).host)
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const url = new URL(request.url);
  const search = new URLSearchParams();
  for (const key of queries) {
    const value = url.searchParams.get(key);
    if (value !== null && /^[0-9A-Za-z:.+-]{1,40}$/.test(value)) search.set(key, value);
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
