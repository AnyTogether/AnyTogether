import { isUserId } from "@/lib/people";
import { relay } from "@/lib/session";

/** Accepts or declines a request someone sent. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string; answer: string }> },
) {
  const { userId, answer } = await params;
  if (!isUserId(userId) || (answer !== "accept" && answer !== "decline"))
    return Response.json({ code: "not_found", title: "No such request" }, { status: 404 });
  return relay(`/me/friends/requests/${userId}/${answer}`, { method: "POST", body: "{}" });
}
