import { fromThisSite } from "@/lib/origin";
import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const seq = "[0-9]{1,15}";
const title = "[A-Z]{4}[0-9]{5}";

/** The API paths the messages, party, watch, notification and Find players pages may reach
 *  through here, by method; nothing else passes, and only these query parameters. */
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
    /^me\/share-play$/,
    new RegExp(`^share-plays/${id}(/ice-servers)?$`),
    /^me\/notifications$/,
    /^me\/notifications\/(unread|settings)$/,
    /^lfg$/,
    /^lfg\/games$/,
    /^me\/lfg$/,
    new RegExp(`^lfg/${id}$`),
    /^(parties|share-plays)\/public$/,
    /^discover\/(players|suggestions)$/,
    /^me\/discovery$/,
    new RegExp(`^games/${title}/hub$`),
  ],
  POST: [
    /^conversations$/,
    new RegExp(`^conversations/${id}/(messages|read|members)$`),
    /^parties$/,
    new RegExp(`^parties/${id}/(invites|join|decline|leave|kick|leader)$`),
    /^calls$/,
    new RegExp(`^calls/${id}/(answer|decline|leave|mute)$`),
    // The website only watches: it never starts a share play or hands out pads.
    new RegExp(`^share-plays/${id}/(join|leave|decline)$`),
    /^me\/notifications\/read-all$/,
    new RegExp(`^me/notifications/${id}/read$`),
    /^lfg$/,
    new RegExp(`^(lfg|parties|share-plays)/${id}/requests$`),
    // A share play's requests are answered by its host, in the launcher.
    new RegExp(`^(lfg|parties)/${id}/requests/${id}/(accept|decline)$`),
  ],
  PATCH: [
    new RegExp(`^conversations/${id}$`),
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^parties/${id}$`),
    /^me\/notifications\/settings$/,
    /^me\/discovery$/,
  ],
  DELETE: [
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^conversations/${id}/members/${id}$`),
    new RegExp(`^lfg/${id}$`),
    new RegExp(`^(lfg|parties|share-plays)/${id}/requests/me$`),
  ],
};
const queries = ["before", "after", "limit", "titleId", "purpose", "language", "now", "live"];

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!allowed[request.method]?.some((pattern) => pattern.test(path)))
    return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
  // Cookies are SameSite=Lax already; a changing call must also come from this website's pages.
  if (request.method !== "GET" && !fromThisSite(request, { required: false }))
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
