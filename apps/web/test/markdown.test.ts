import { describe, expect, it } from "vitest";
import { notesToHtml } from "../lib/markdown";

const repo = "AnyTogether/AnyPS5-ARM";

describe("release notes", () => {
  it("render GitHub-flavoured Markdown, headings below the page's", () => {
    const html = notesToHtml(
      "## What's new\n\n- **Share play:** yes\n- `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```sh\ncurl x | sh\n```\n\n~~old~~",
      repo,
    );
    expect(html).toContain("<h4>What's new</h4>");
    expect(html).toContain("<strong>Share play:</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<pre><code class="language-sh">curl x | sh');
    expect(html).toContain("<del>old</del>");
  });

  it("drop raw HTML, scripts, event handlers and pictures", () => {
    const html = notesToHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nText <b onclick="x()">bold</b> <iframe src="https://evil.example"></iframe>\n\n![pic](https://tracker.example/p.png)\n\n<a href="javascript:alert(1)">raw</a>',
      repo,
    );
    expect(html).not.toMatch(/<script|<img|<iframe|onerror|onclick|javascript:|tracker\.example/i);
    expect(html).toContain("Text");
  });

  it("keep only web and mail links, made whole and marked", () => {
    const html = notesToHtml(
      "[guide](docs/user/GUIDE.md) [site](https://anytogether.kodla.agency) [bad](javascript:alert(1)) [data](data:text/html,x) [mail](mailto:a@b.c) [top](#install)",
      repo,
    );
    expect(html).toContain('href="https://github.com/AnyTogether/AnyPS5-ARM/blob/HEAD/docs/user/GUIDE.md"');
    expect(html).toContain('href="https://anytogether.kodla.agency" rel="nofollow noopener noreferrer"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).not.toMatch(/javascript:|data:text/);
  });
});
