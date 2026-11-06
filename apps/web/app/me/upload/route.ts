import { fromThisSite } from "@/lib/origin";
import { accessToken } from "@/lib/session";
import { stream } from "@/lib/upload";

const caps = { image: 10, clip: 25, voice: 1 } as const;

/** Streams a photo, clip or voice note to the API as it arrives (?kind=image|clip|voice, and
 *  &sealed=1 for one encrypted in the browser for an end-to-end encrypted message); nothing is held
 *  in memory here. */
export async function POST(request: Request) {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  if (!fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind") as keyof typeof caps;
  if (!(kind in caps))
    return Response.json({ code: "bad_request", title: "kind: image, clip or voice" }, { status: 400 });
  const path = query.get("sealed") === "1" ? "/me/media/sealed" : "/me/media";
  return stream(request, `${path}?kind=${kind}`, "POST", token, caps[kind]);
}
