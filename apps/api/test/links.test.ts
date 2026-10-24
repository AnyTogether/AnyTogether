import { describe, expect, it } from "vitest";
import { blockedLink, defaultBlockedLinkDomains } from "../src/links.js";

describe("blocked links", () => {
  it("find a blocked domain or its subdomains, not look-alike names", () => {
    const list = defaultBlockedLinkDomains;
    expect(blockedLink("https://grabify.link/abc", list)).toBe("grabify.link");
    expect(blockedLink("meet at x.2no.co/abc", list)).toBe("2no.co");
    expect(blockedLink("IPLOGGER.COM", list)).toBe("iplogger.com");
    expect(blockedLink("grabify。link", list)).toBe("grabify.link");
    expect(blockedLink("see grabify.links.example", list)).toBeNull();
    expect(blockedLink("my2no.co", list)).toBeNull();
    expect(blockedLink("anything grabify.link", [])).toBeNull();
    expect(blockedLink("e-mail me@ok.example", list)).toBeNull();
  });
});
