import type { MetadataRoute } from "next";

/** The web app manifest: AnyTogether added to a home screen opens like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AnyTogether",
    short_name: "AnyTogether",
    description:
      "Play the PS5 games you own on your Mac, your PC and with friends: AnyPS5, your phone as a DualSense, and AnyTogether online.",
    start_url: "/",
    display: "standalone",
    background_color: "#07080c",
    theme_color: "#07080c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
