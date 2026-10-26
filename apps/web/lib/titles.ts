import type { Metadata } from "next";
import { type Strings, strings } from "./i18n";

/** A signed-in page's tab title in the visitor's language: "Ayarlar · AnyTogether". */
export async function titled(
  pick: (texts: Strings) => string,
  rest: Omit<Metadata, "title"> = {},
): Promise<Metadata> {
  return { ...rest, title: `${pick(await strings())} · AnyTogether` };
}
