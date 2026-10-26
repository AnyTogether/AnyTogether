import type { Language } from "./i18n";

/** The platforms of the full specs sheet and its search, apart from the sheet's data so the
 *  filter in the browser carries none of it. */
export type SpecPlatform = "mac" | "windows" | "linux" | "iphone" | "android" | "web";
export const specPlatforms: SpecPlatform[] = ["mac", "windows", "linux", "iphone", "android", "web"];

/** Text as the search box compares it: lower case in the page's language, accents and dotless
 *  i folded, so "kupa", "Kupa" and "KUPA" all match, and so do "cozunurluk" and "çözünürlük". */
export const searchable = (text: string, language: Language) =>
  text.toLocaleLowerCase(language).replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
