import { relay } from "@/lib/session";

/** Removes one passkey (its ID is the authenticator's credential ID, base64url). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,1400}$/.test(id))
    return Response.json({ code: "not_found", title: "No such passkey" }, { status: 404 });
  return relay(`/auth/passkeys/${id}`, { method: "DELETE" });
}
