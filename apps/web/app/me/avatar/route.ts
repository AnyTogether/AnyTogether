import { putAvatar } from "@/lib/avatarUpload";
import { relay } from "@/lib/session";

/** Uploads a picture as the avatar, with the square chosen in the crop (left, top, size in pixels). */
export async function PUT(request: Request) {
  return putAvatar(request, "/me/avatar");
}

export async function DELETE() {
  return relay("/me/avatar", { method: "DELETE" });
}
