import type { MetadataRoute } from "next";

/** The web app manifest: AnyTogether added to a home screen (or installed from the browser) opens
 *  in its own window like an app. The icons keep the controller inside the middle 60%, so the same
 *  pictures serve as maskable ones (Android crops them to its own shapes). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AnyTogether",
    short_name: "AnyTogether",
    description:
      "Play the PS5 games you own on your Mac, your PC and with friends: AnyPS5, your phone as a DualSense, and AnyTogether online.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07080c",
    theme_color: "#07080c",
    categories: ["games", "social", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Messages", short_name: "Messages", url: "/messages" },
      { name: "Party", short_name: "Party", url: "/party" },
      { name: "Friends", short_name: "Friends", url: "/friends" },
      { name: "Notifications", short_name: "Notifications", url: "/notifications" },
    ],
  };
}
