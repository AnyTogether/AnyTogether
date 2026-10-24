import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/** Release notes (GitHub-flavoured Markdown, written on GitHub by whoever can publish a release)
 *  to HTML that is safe to put in a page. Raw HTML in the Markdown is dropped, not passed through;
 *  what Markdown itself makes goes through GitHub's own sanitising schema, minus pictures (they
 *  would load from anywhere, with the reader's address) and minus anything that is not a plain
 *  web or mail link. After that, and only adding: headings step down below the page's own, links
 *  to the repository's files become full GitHub links, and every link gets rel="nofollow noopener
 *  noreferrer". */

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => !["img", "picture", "source"].includes(tag)),
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto"] },
};

/** Headings below the page's (h3 and lower), links made whole and marked. */
function tidy(repo: string) {
  return () => (tree: Node) => {
    const walk = (node: Node) => {
      const tag = node.tagName;
      if (tag && /^h[1-6]$/.test(tag)) node.tagName = `h${Math.min(6, Number(tag[1]) + 2)}`;
      if (tag === "a" && node.properties) {
        const href = String(node.properties.href ?? "");
        if (href && !/^(https?:|mailto:|#)/i.test(href))
          node.properties.href = `https://github.com/${repo}/blob/HEAD/${href.replace(/^\.?\//, "")}`;
        node.properties.rel = ["nofollow", "noopener", "noreferrer"];
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

/** One release's notes as safe HTML. `repo` ("owner/name") turns relative links into GitHub ones. */
export function notesToHtml(markdown: string, repo: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSanitize, schema)
      .use(tidy(repo))
      .use(rehypeStringify)
      .processSync(markdown),
  );
}
