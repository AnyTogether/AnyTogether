import { describe, expect, it } from "vitest";
import { PublicProfileSet, defaultPrivacy, privacySections, shownPrivacy } from "../src/profile.js";

describe("the public profile switch", () => {
  const open = Object.fromEntries(privacySections.map((section) => [section, "everyone"]));

  it("off, nothing is shown to everyone but being found by name", () => {
    const shown = shownPrivacy(open, false);
    for (const section of privacySections)
      expect(shown[section], section).toBe(section === "search" ? "everyone" : "friends");
  });

  it("off, friends-only and hidden parts stay as they are", () => {
    const stored = { library: "nobody", trophies: "friends", search: "friends" };
    expect(shownPrivacy(stored, false)).toEqual({ ...defaultPrivacy, library: "nobody", search: "friends" });
  });

  it("on, the settings stand as stored", () => {
    expect(shownPrivacy(open, true)).toEqual(open);
    expect(shownPrivacy({}, true)).toEqual(defaultPrivacy);
  });

  it("a missing switch (an old row, an older answer) is off", () => {
    expect(shownPrivacy(open, undefined).library).toBe("friends");
    expect(shownPrivacy(open, null).library).toBe("friends");
  });

  it("is set with a boolean and nothing else", () => {
    expect(PublicProfileSet.parse({ publicProfile: true })).toEqual({ publicProfile: true });
    expect(PublicProfileSet.safeParse({ publicProfile: "yes" }).success).toBe(false);
    expect(PublicProfileSet.safeParse({}).success).toBe(false);
  });
});
