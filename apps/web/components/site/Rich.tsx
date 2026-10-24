import { inlineParts } from "@/lib/inline";
import Link from "next/link";

/** A text with [text](href) links in it, links to this site through Next's Link. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) =>
        typeof part === "string" ? (
          part
        ) : part.href.startsWith("/") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
          <Link key={index} href={part.href}>
            {part.text}
          </Link>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed text
          <a key={index} href={part.href}>
            {part.text}
          </a>
        ),
      )}
    </>
  );
}
