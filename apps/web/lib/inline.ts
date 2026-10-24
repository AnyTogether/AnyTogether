/** Texts with links written as [text](href), split into plain parts and links, so pages show them
 *  as React elements and never as HTML. Only site paths and https links count as links. */
export type InlinePart = string | { text: string; href: string };

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push({ text: match[1] ?? "", href: match[2] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The same text without its links' addresses, for places that take plain text. */
export const plainText = (text: string) =>
  inlineParts(text)
    .map((part) => (typeof part === "string" ? part : part.text))
    .join("");
