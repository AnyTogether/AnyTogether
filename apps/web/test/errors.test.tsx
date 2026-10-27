import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/site/fonts", () => ({ wide: { variable: "font-wide" } }));
vi.mock("@/lib/i18n", () => ({ language: async () => "tr" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));

const { ErrorPage } = await import("@/components/site/ErrorPage");
const { default: NotFound } = await import("@/app/not-found");
const { errorLogLine, requestId } = await import("@/lib/errorLog");
const { errorStringsEn, errorStringsTr } = await import("@/lib/i18n-errors");

const keys = (value: object): string[] =>
  Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? keys(v).map((n) => `${k}.${n}`) : [k],
  );

describe("the error pages", () => {
  it("show the error ID the server logged, a way to try again, home and to report it", () => {
    const error = Object.assign(new Error("boom"), { digest: "2847561923" });
    const html = renderToStaticMarkup(<ErrorPage error={error} reset={() => {}} />);
    expect(html).toContain("Something broke");
    expect(html).toContain("Error ID");
    expect(html).toContain("<code>2847561923</code>");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
    expect(html).toContain("github.com/AnyTogether/AnyTogether/issues");
    expect(html).not.toContain("boom");
  });

  it("say when an error has no ID on the server", () => {
    const html = renderToStaticMarkup(<ErrorPage error={new Error("x")} reset={() => {}} />);
    expect(html).toContain("the server has no record of it");
  });

  it("the not-found page speaks the visitor's language and leads home", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("Burada bir şey yok,");
    expect(html).toContain('href="/"');
    expect(html).toContain('class="site pg err-page');
  });

  it("have every text in both languages", () => {
    expect(keys(errorStringsTr)).toEqual(keys(errorStringsEn));
  });
});

describe("the server's error log", () => {
  it("is one JSON line with the error ID and the request ID, without the query or headers", () => {
    const error = Object.assign(new Error("cannot read x"), { digest: "123" });
    const line = errorLogLine(
      error,
      {
        path: "/auth/magic?token=secret",
        method: "GET",
        headers: { "x-request-id": "req-1234abcd", cookie: "at_access=tok", "x-real-ip": "198.51.100.7" },
      },
      { routePath: "/auth/magic", routeType: "render", renderSource: "server-rendering" },
      new Date("2026-10-25T12:00:00Z"),
    );
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "error",
      at: "2026-10-25T12:00:00.000Z",
      errorId: "123",
      requestId: "req-1234abcd",
      method: "GET",
      path: "/auth/magic",
      route: "/auth/magic",
      error: "Error: cannot read x",
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("at_access");
    expect(line).not.toContain("198.51.100.7");
  });

  it("keeps a proxy's request ID when it looks like one, and makes one otherwise", () => {
    expect(requestId("abcd-1234-efgh")).toBe("abcd-1234-efgh");
    expect(requestId("bad id with spaces")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
