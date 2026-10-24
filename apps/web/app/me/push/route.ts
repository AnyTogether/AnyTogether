import { fromAnotherSite } from "@/lib/origin";
import { relayBody } from "@/lib/session";

/** Only this website's own pages (and its worker) may change it; the middleware checks too. */
const foreign = fromAnotherSite;

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
