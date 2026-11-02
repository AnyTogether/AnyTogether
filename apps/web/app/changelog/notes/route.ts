import { loadChangelog } from "@/lib/changelog-server";

/** One release's notes as the HTML the changelog shows (sanitised when it was rendered, see
 *  lib/markdown.ts), for the older releases, whose notes load when they are opened. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const entry = (await loadChangelog())?.entries.find((e) => e.anchor === id);
  if (!entry) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(entry.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=900",
    },
  });
}
