import { fromAnotherSite } from "@/lib/origin";
import { accessToken, api, relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The admin API paths the admin page may reach through here; the API itself checks that the
 *  signed-in account is an admin on every one of them. */
const allowed: Record<string, RegExp[]> = {
  GET: [/^admin\/(reports|users|bans|audit|themes|appeals)$/],
  POST: [
    new RegExp(`^admin/reports/${id}$`),
    new RegExp(`^admin/themes/${id}$`),
    new RegExp(`^admin/users/${id}/(ban|mute)$`),
    new RegExp(`^admin/appeals/${id}$`),
    new RegExp(`^admin/bans/${id}/lift$`),
  ],
};
const queries: Record<string, RegExp> = {
  status: /^(open|actioned|dismissed|all|review|hidden|published|accepted|declined)$/,
  before: new RegExp(`^${id}$`),
  limit: /^[0-9]{1,3}$/,
  all: /^1$/,
  q: /^[^\s]{2,254}$/,
};

/** A theme's card still for the admin page, whatever the theme's state. */
const still = new RegExp(`^admin/themes/${id}/thumb\\.webp$`);

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (request.method === "GET" && still.test(path)) {
    const token = await accessToken();
    const response = token ? await api(`/${path}`, { token }).catch(() => undefined) : undefined;
    if (!response?.ok) return new Response(null, { status: response?.status ?? 401 });
    return new Response(await response.arrayBuffer(), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  }
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
