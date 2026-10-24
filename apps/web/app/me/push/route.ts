import { relayBody } from "@/lib/session";

/** Refuses a changing call that does not come from this website's own pages (or its worker). */
const foreign = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host !== new URL(request.url).host;
};

/** This browser's push subscription: {endpoint, keys, lang}, tied to its sign-in. */
export async function POST(request: Request) {
  if (foreign(request))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  return relayBody(request, "/me/push", "POST");
}

/** Ends it: {endpoint}. */
export async function DELETE(request: Request) {
  if (foreign(request))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  return relayBody(request, "/me/push", "DELETE");
}
