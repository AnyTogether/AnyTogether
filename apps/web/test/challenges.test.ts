import { describe, expect, it } from "vitest";
import { challengeValue, progressOf, untilText } from "../lib/challenges";
import { challengesEn, challengesTr } from "../lib/i18n-challenges";

const texts = {
  minutes: "{m} min",
  hoursOnly: "{h} h",
  pointsValue: "{n} pts",
  trophiesValue: "{n} trophies",
};

describe("challenges on the website", () => {
  it("shows a value as points, trophies or play time", () => {
    expect(challengeValue("points", 1200, texts, "en")).toBe("1,200 pts");
    expect(challengeValue("trophies", 3, texts, "en")).toBe("3 trophies");
    expect(challengeValue("time", 45 * 60, texts, "en")).toBe("45 min");
    expect(challengeValue("time", 3 * 3600 + 60, texts, "en")).toBe("3 h");
  });

  it("says how long until a moment, and how far through its window a challenge is", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(untilText("2026-11-06T12:20:00Z", "en", now)).toBe("in 20 minutes");
    expect(untilText("2026-11-06T17:00:00Z", "en", now)).toBe("in 5 hours");
    expect(untilText("2026-11-09T12:00:00Z", "en", now)).toBe("in 3 days");
    expect(untilText("2026-11-06T10:00:00Z", "en", now)).toBe("2 hours ago");
    const window = { startsAt: "2026-11-06T00:00:00Z", endsAt: "2026-11-07T00:00:00Z" };
    expect(progressOf(window, now)).toBe(0.5);
    expect(progressOf(window, Date.parse("2026-11-05T00:00:00Z"))).toBe(0);
    expect(progressOf(window, Date.parse("2026-11-08T00:00:00Z"))).toBe(1);
  });

  it("has every string in both languages, with no semicolons", () => {
    expect(Object.keys(challengesTr).sort()).toEqual(Object.keys(challengesEn).sort());
    for (const text of [...Object.values(challengesEn), ...Object.values(challengesTr)])
      expect(text).not.toContain(";");
  });
});
