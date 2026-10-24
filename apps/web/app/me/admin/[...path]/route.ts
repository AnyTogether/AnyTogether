import { fromAnotherSite } from "@/lib/origin";
import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The admin API paths the admin page may reach through here; the API itself checks that the
 *  signed-in account is an admin on every one of them. */
const allowed: Record<string, RegExp[]> = {
  GET: [/^admin\/(reports|users|bans|audit)$/],
  POST: [
    new RegExp(`^admin/reports/${id}$`),
    new RegExp(`^admin/users/${id}/ban$`),
    new RegExp(`^admin/bans/${id}/lift$`),
  ],
};
const queries: Record<string, RegExp> = {
  status: /^(open|actioned|dismissed|all)$/,
  before: new RegExp(`^${id}$`),
  limit: /^[0-9]{1,3}$/,
  all: /^1$/,
  q: /^[^\s]{2,254}$/,
};

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed[request.method]?.some((pattern) => pattern.test(path)))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  // A changing call must come from this website's own pages.
  if (request.method !== "GET" && fromAnotherSite(request))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const url = new URL(request.url);
  const search = new URLSearchParams();
  for (const [key, pattern] of Object.entries(queries)) {
    const value = url.searchParams.get(key);
    if (value !== null && pattern.test(value)) search.set(key, value);
  }
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 4096)
    return Response.json({ code: "bad_request", title: "Too big" }, { status: 413 });
  return relay(`/${path}${search.size ? `?${search}` : ""}`, {
    method: request.method,
    ...(body ? { body } : {}),
  });
}

export { pass as GET, pass as POST };
