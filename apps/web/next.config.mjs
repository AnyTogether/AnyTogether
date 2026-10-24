import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  // In development the API runs beside the website; in production the proxy routes /api to it.
  async rewrites() {
    return process.env.NODE_ENV === "production"
      ? []
      : [
          {
            source: "/api/:path*",
            destination: `${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/:path*`,
          },
        ];
  },
};
