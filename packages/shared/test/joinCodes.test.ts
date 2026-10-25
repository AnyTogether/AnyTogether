import { describe, expect, it } from "vitest";
import {
  DiscordLink,
  discordLink,
  formatJoinCode,
  isJoinCode,
  joinCodeUrl,
  normalizeJoinCode,
} from "../src/joinCodes.js";

describe("join codes", () => {
  it("reads a code however it is typed", () => {
    expect(normalizeJoinCode(" k7qm-3xpa ")).toBe("K7QM3XPA");
    expect(isJoinCode("K7QM3XPA")).toBe(true);
    // No 0, O, 1 or I, and eight characters.
    expect(isJoinCode("K7QM3XP0")).toBe(false);
    expect(isJoinCode("K7QM3XPI")).toBe(false);
    expect(isJoinCode("K7QM3XP")).toBe(false);
    expect(formatJoinCode("K7QM3XPA")).toBe("K7QM-3XPA");
    expect(joinCodeUrl("https://anytogether.test/", "K7QM3XPA")).toBe(
      "https://anytogether.test/join/K7QM3XPA",
    );
  });
});

describe("Discord links", () => {
  it("takes invites and channels on discord.gg and discord.com", () => {
    expect(discordLink("https://discord.gg/abc123")).toBe("https://discord.gg/abc123");
    expect(discordLink(" https://discord.com/invite/Abc-123/ ")).toBe("https://discord.com/invite/Abc-123");
    expect(discordLink("https://discord.com/channels/123456789012345678/987654321098765432")).toBe(
      "https://discord.com/channels/123456789012345678/987654321098765432",
    );
    expect(discordLink("https://www.discord.com/invite/abc?utm=x#y")).toBe(
      "https://www.discord.com/invite/abc",
    );
  });

  it("refuses anything else", () => {
    for (const bad of [
      "http://discord.gg/abc123",
      "https://discord.gg.evil.com/abc",
      "https://evildiscord.gg/abc",
      "https://discord.com/",
      "https://discord.com/login",
      "https://user:pw@discord.gg/abc",
      "https://discord.gg:8443/abc",
      "javascript:alert(1)",
      "discord.gg/abc",
      "https://discord.gg/abc/def",
    ])
      expect(discordLink(bad), bad).toBeNull();
    expect(DiscordLink.safeParse("https://example.com").success).toBe(false);
    expect(DiscordLink.parse("https://discord.gg/abc123")).toBe("https://discord.gg/abc123");
  });
});
