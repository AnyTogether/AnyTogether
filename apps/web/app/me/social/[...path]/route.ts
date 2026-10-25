import { fromThisSite } from "@/lib/origin";
import { relay } from "@/lib/session";

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const seq = "[0-9]{1,15}";
const title = "[A-Z]{4}[0-9]{5}";
const joinCode = "[A-HJ-NP-Z2-9]{8}";
const reaction = "(like|love|laugh|wow|sad|fire|gg)";

/** The API paths the messages, party, join, watch, notification and Find players pages may reach
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
    /^me\/(players-met|communities|events)$/,
    /^communities$/,
    new RegExp(`^communities/${id}(/(members|bans|events))?$`),
    new RegExp(`^events/${id}$`),
  ],
  POST: [
    /^conversations$/,
    new RegExp(`^conversations/${id}/(messages|read|delivered|members)$`),
    /^parties$/,
    new RegExp(`^parties/${id}/(invites|join|decline|leave|kick|leader|code)$`),
    // Asking to join with a join code (the page that shows it reads it on the server).
    new RegExp(`^join/${joinCode}$`),
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
    /^communities$/,
    new RegExp(`^communities/${id}/(join|leave|decline|invites|bans|owner|events)$`),
    new RegExp(`^events/${id}/start$`),
  ],
  PATCH: [
    new RegExp(`^conversations/${id}$`),
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^parties/${id}$`),
    /^me\/notifications\/settings$/,
    /^me\/discovery$/,
    /^me\/(look|players-met)$/,
    new RegExp(`^(communities|events)/${id}$`),
  ],
  PUT: [
    /^me\/showcase$/,
    new RegExp(`^conversations/${id}/(mute|pin)$`),
    new RegExp(`^conversations/${id}/messages/${seq}/reactions/${reaction}$`),
    new RegExp(`^communities/${id}/members/${id}/role$`),
    new RegExp(`^events/${id}/rsvp$`),
  ],
  DELETE: [
    new RegExp(`^conversations/${id}/messages/${seq}$`),
    new RegExp(`^conversations/${id}/messages/${seq}/reactions/${reaction}$`),
    new RegExp(`^conversations/${id}/members/${id}$`),
    new RegExp(`^lfg/${id}$`),
    new RegExp(`^(lfg|parties|share-plays)/${id}/requests/me$`),
    new RegExp(`^parties/${id}/code$`),
    new RegExp(`^me/players-met/${id}$`),
    new RegExp(`^communities/${id}$`),
    new RegExp(`^communities/${id}/(members|bans)/${id}$`),
    new RegExp(`^events/${id}(/rsvp)?$`),
  ],
};
const queries = [
  "before",
  "after",
  "limit",
  "titleId",
  "purpose",
  "language",
  "now",
  "live",
  "q",
  "days",
  "when",
];

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
    // A search may hold words in any language; everything else is plain.
    const shape = key === "q" ? /^[\p{L}\p{N} ._'-]{1,40}$/u : /^[0-9A-Za-z:.+-]{1,40}$/;
    if (value !== null && shape.test(value)) search.set(key, value);
  }
  const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.text();
  if (body && body.length > 16_384)
    return Response.json({ code: "bad_request", title: "Too big" }, { status: 413 });
  return relay(`/${path}${search.size ? `?${search}` : ""}`, {
    method: request.method,
    ...(body ? { body } : {}),
  });
}

export { pass as GET, pass as POST, pass as PATCH, pass as PUT, pass as DELETE };
