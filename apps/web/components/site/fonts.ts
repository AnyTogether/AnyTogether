import localFont from "next/font/local";

/** The public pages' display face: Archivo, wide. Loaded only by the pages that use it, as the
 *  --font-wide variable on their outermost element. The file is in app/fonts, so a build needs no
 *  network. Its fallback's metrics are in globals.css. */
export const wide = localFont({
  src: "../../app/fonts/Archivo-Variable.woff2",
  weight: "100 900",
  style: "normal",
  declarations: [
    { prop: "font-family", value: "Archivo" },
    { prop: "font-stretch", value: "62% 125%" },
  ],
  display: "swap",
  adjustFontFallback: false,
  fallback: ["'Archivo Fallback'"],
  variable: "--font-wide",
});
