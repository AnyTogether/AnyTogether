import { relay, relayBody } from "@/lib/session";

/** Linking, hiding and unlinking Steam and Discord, passed to the API as they come. */
const start = /^(steam|discord)\/start$/;
const one = /^(steam|discord)$/;

async function pass(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (request.method === "POST" && start.test(path))
    return relay(`/me/connections/${path}`, { method: "POST" });
  if (request.method === "PATCH" && one.test(path))
    return relayBody(request, `/me/connections/${path}`, "PATCH");
  if (request.method === "DELETE" && one.test(path))
    return relay(`/me/connections/${path}`, { method: "DELETE" });
  return Response.json({ code: "not_found", title: "Not found" }, { status: 404 });
}

export { pass as POST, pass as PATCH, pass as DELETE };
