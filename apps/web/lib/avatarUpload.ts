import "server-only";
import { accessToken, api } from "@/lib/session";

const maxBytes = 5 * 1024 * 1024;
const whole = (value: string | null) => (value && /^\d{1,6}$/.test(value) ? value : null);

/** Uploads a picture as the public avatar (/me/avatar) or the friends-only one
 *  (/me/avatar/private), with the square chosen in the crop (left, top, size in pixels). The API
 *  checks and re-encodes both the same way. */
export async function putAvatar(request: Request, path: "/me/avatar" | "/me/avatar/private") {
  const token = await accessToken();
  if (!token) return Response.json({ code: "unauthorized", title: "Sign in first" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    return Response.json({ code: "payload_too_large", title: "An avatar is at most 5 MB" }, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes)
    return Response.json({ code: "payload_too_large", title: "An avatar is at most 5 MB" }, { status: 413 });
  const params = new URL(request.url).searchParams;
  const crop = ["left", "top", "size"].map((name) => [name, whole(params.get(name))] as const);
  const query = crop.every(([, value]) => value !== null)
    ? `?${crop.map(([name, value]) => `${name}=${value}`).join("&")}`
    : "";
  const response = await api(`${path}${query}`, {
    method: "PUT",
    token,
    body: bytes,
    headers: { "content-type": request.headers.get("content-type") ?? "application/octet-stream" },
  }).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
