import { relayUpload } from "@/lib/session";
import { isThemeId, themeUploadBytes } from "@/lib/themes";

/** The maker uploads a new version of a theme. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isThemeId(id)) return Response.json({ code: "not_found" }, { status: 404 });
  return relayUpload(request, `/themes/${id}/versions`, themeUploadBytes);
}
