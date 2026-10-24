import { accessToken, api, relay } from "@/lib/session";

const maxBytes = 5 * 1024 * 1024;
const whole = (value: string | null) => (value && /^\d{1,6}$/.test(value) ? value : null);

/** Uploads a picture as the avatar, with the square chosen in the crop (left, top, size in pixels). */
export async function PUT(request: Request) {
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
  const response = await api(`/me/avatar${query}`, {
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

export async function DELETE() {
  return relay("/me/avatar", { method: "DELETE" });
}
