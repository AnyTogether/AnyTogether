import { createRemoteJWKSet } from "jose";
import { createGateway } from "./gateway.js";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:8080";
const gateway = await createGateway({
  keys: createRemoteJWKSet(new URL("/api/v1/.well-known/jwks.json", apiUrl)),
  // PUBLIC_URL, plus earlier ones (PREVIOUS_PUBLIC_URLS, comma list) whose tokens still verify.
  issuer: [
    process.env.PUBLIC_URL ?? "http://localhost:3000",
    ...(process.env.PREVIOUS_PUBLIC_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
  ],
  valkeyUrl: process.env.VALKEY_URL ?? "redis://127.0.0.1:63799",
});
const port = Number(process.env.PORT ?? 8081);
gateway.server.listen(port, () => console.log(`realtime listening on ${port}`));
