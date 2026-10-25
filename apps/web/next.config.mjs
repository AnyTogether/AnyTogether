import { fileURLToPath } from "node:url";

/** Sent with every page and answer: nobody frames the site (the device-code page must never be
 *  clickable under someone else's page), no MIME sniffing, no full URLs to other sites. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone is for calls on this site; nothing here wants the camera or the location.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The film and its pictures: kept for a day, so the CDN in front holds them and answers the
      // range requests a video player makes (Safari plays nothing without them).
      { source: "/media/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
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
