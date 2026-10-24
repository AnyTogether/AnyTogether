import { accessToken, api } from "@/lib/session";

/** "Download my data": the API's JSON file, handed to the browser as a download. */
export async function GET() {
  const token = await accessToken();
  if (!token) return new Response(null, { status: 303, headers: { location: "/login?next=/settings" } });
  const response = await api("/me/export", { token }).catch(() => undefined);
  if (!response) return Response.json({ code: "unavailable", title: "Try again" }, { status: 502 });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    },
  });
}
