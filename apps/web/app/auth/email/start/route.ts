import { language } from "@/lib/i18n";
import { api } from "@/lib/session";

/** Sends the sign-in code (the browser never talks to the API with tokens itself), in the page's
 *  language (the one <html lang> carries). */
export async function POST(request: Request) {
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  const lang = await language();
  const response = await api("/auth/email/start", { method: "POST", body: JSON.stringify({ email, lang }) });
  return new Response(response.status === 202 ? null : await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
