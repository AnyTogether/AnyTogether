import { relayUpload } from "@/lib/session";
import { themeUploadBytes } from "@/lib/themes";

/** Shares a theme on the Hub. */
export async function POST(request: Request) {
  return relayUpload(request, "/themes", themeUploadBytes);
}
