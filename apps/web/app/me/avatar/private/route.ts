import { putAvatar } from "@/lib/avatarUpload";
import { relay } from "@/lib/session";

/** Uploads the friends-only picture: only the person and their friends see it. */
export async function PUT(request: Request) {
  return putAvatar(request, "/me/avatar/private");
}

export async function DELETE() {
  return relay("/me/avatar/private", { method: "DELETE" });
}
