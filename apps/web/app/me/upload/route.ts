import { fromThisSite } from "@/lib/origin";
import { accessToken } from "@/lib/session";
import { stream } from "@/lib/upload";

const caps = { image: 10, clip: 25, voice: 1 } as const;

/** Streams a photo, clip or voice note to the API as it arrives (?kind=image|clip|voice); nothing
 *  is held in memory here. */
export async function POST(request: Request) {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  if (!fromThisSite(request, { required: false }))
    return Response.json({ code: "forbidden", title: "Not from this website" }, { status: 403 });
  const kind = new URL(request.url).searchParams.get("kind") as keyof typeof caps;
  if (!(kind in caps))
    return Response.json({ code: "bad_request", title: "kind: image, clip or voice" }, { status: 400 });
  return stream(request, `/me/media?kind=${kind}`, "POST", token, caps[kind]);
}
