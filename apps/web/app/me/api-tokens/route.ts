import { relay, relayBody } from "@/lib/session";

/** The account's personal API tokens. */
export async function GET() {
  return relay("/me/api-tokens");
}

/** Makes a token (its name and scopes); the answer holds the token itself, this once. */
export async function POST(request: Request) {
  return relayBody(request, "/me/api-tokens", "POST");
}
