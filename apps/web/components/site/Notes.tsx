import { notesToHtml } from "@/lib/markdown";

/** A release's notes from GitHub. The only HTML set from outside on the site: it comes out of
 *  notesToHtml, which drops raw HTML and sanitises what the Markdown makes (see lib/markdown.ts
 *  and its tests). */
export function Notes({ markdown, repo }: { markdown: string; repo: string }) {
  const html = notesToHtml(markdown, repo);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by notesToHtml, raw HTML dropped
  return <div className="prose" lang="en" dangerouslySetInnerHTML={{ __html: html }} />;
}
