import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ strings: async () => ({}) }));
vi.mock("@/components/LoginForm", () => ({ LoginForm: () => null }));
vi.mock("@/components/Passkeys", () => ({ PasskeySignIn: () => null }));
// The server offers Discord: its button goes back to the same safe path.
vi.mock("@/lib/session", () => ({ api: async () => Response.json({ discord: { clientId: "1" } }) }));

/** Every href in a rendered tree. */
function hrefs(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (typeof props?.href === "string") found.push(props.href);
  const children = props?.children;
  for (const child of Array.isArray(children) ? children : [children]) hrefs(child, found);
  return found;
}

/** Every `next` prop in a rendered tree. */
function nextProps(node: unknown, found: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return found;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && "next" in props) found.push(props.next);
  const children = props?.children;
  for (const child of Array.isArray(children) ? children : [children]) nextProps(child, found);
  return found;
}

describe("the sign-in page", () => {
  it("goes back only to a path on this site after signing in", async () => {
    const { default: Login } = await import("@/app/login/page");
    for (const next of ["/\\evil.example", "//evil.example", "/\t/evil.example", "https://evil.example"]) {
      const page = await Login({ searchParams: Promise.resolve({ next }) });
      for (const target of nextProps(page)) expect(target).toBe("/");
      expect(hrefs(page)).toEqual(["/auth/discord/start?next=%2F"]);
    }
    const page = await Login({ searchParams: Promise.resolve({ next: "/friends?tab=asks" }) });
    expect(nextProps(page)).toContain("/friends?tab=asks");
  });
});
