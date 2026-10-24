// vitest
import { expect, test } from "vitest";
import { fromThisSite } from "../lib/origin";

// What Next hands a route handler behind the proxy: request.url is the address the server listens
// on (http://[::]:3000/… in the container), the Host header is the site's.
const behindProxy = (origin?: string, host = "together.example.org") =>
  new Request("http://[::]:3000/me/realtime", {
    method: "POST",
    headers: { host, ...(origin ? { origin } : {}) },
  });

test("a page of this website is from this website, behind the proxy", () => {
  expect(fromThisSite(behindProxy("https://together.example.org"))).toBe(true);
});

test("another website is not", () => {
  expect(fromThisSite(behindProxy("https://evil.example"))).toBe(false);
  expect(fromThisSite(behindProxy("https://together.example.org.evil.example"))).toBe(false);
});

test("without an Origin: refused where one is required, let through where it is not", () => {
  expect(fromThisSite(behindProxy())).toBe(false);
  expect(fromThisSite(behindProxy(), { required: false })).toBe(true);
});

test("a malformed Origin is refused", () => {
  expect(fromThisSite(behindProxy("not a url"))).toBe(false);
});
