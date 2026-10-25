import { Archivo } from "next/font/google";

/** The public pages' display face: Archivo, wide. Loaded only by the pages that use it, as the
 *  --font-wide variable on their outermost element. */
export const wide = Archivo({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-wide",
});
