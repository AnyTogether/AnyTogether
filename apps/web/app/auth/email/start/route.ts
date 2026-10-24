import { api } from "@/lib/session";

/** Sends the sign-in code (the browser never talks to the API with tokens itself). */
export async function POST(request: Request) {
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  const response = await api("/auth/email/start", { method: "POST", body: JSON.stringify({ email }) });
  return new Response(response.status === 202 ? null : await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
