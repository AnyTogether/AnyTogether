import { languageCookie, languages } from "@/lib/i18n";
import { samePath } from "@/lib/paths";
import { cookies } from "next/headers";

/** The language switcher's links: keeps the choice for a year and goes back where it was. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = url.searchParams.get("to");
  if (languages.includes(to as never))
    (await cookies()).set(languageCookie, to as string, {
      maxAge: 365 * 86_400,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  return new Response(null, {
    status: 303,
    headers: { location: samePath(url.searchParams.get("next")), "cache-control": "no-store" },
  });
}
