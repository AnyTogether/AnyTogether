import { describe, expect, it } from "vitest";
import { levelOf, levelStart, levelTier, trophyLevelOf } from "../src/level.js";

describe("trophy level", () => {
  it("starts at 1 and climbs 60 points a level up to 100", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(59)).toBe(1);
    expect(levelOf(60)).toBe(2);
    expect(levelOf(5939)).toBe(99);
    expect(levelOf(5940)).toBe(100);
    expect(levelStart(100)).toBe(5940);
  });

  it("costs more per level in each band and stops at 999", () => {
    expect(levelStart(200)).toBe(5940 + 100 * 90);
    expect(levelStart(300)).toBe(levelStart(200) + 100 * 450);
    expect(levelStart(999)).toBe(1_631_340);
    expect(levelOf(1_631_339)).toBe(998);
    expect(levelOf(1_631_340)).toBe(999);
    expect(levelOf(10_000_000)).toBe(999);
    expect(levelOf(-5)).toBe(1);
  });

  it("agrees with levelStart at every level", () => {
    for (let level = 1; level <= 999; level++) {
      expect(levelOf(levelStart(level))).toBe(level);
      if (level > 1) expect(levelOf(levelStart(level) - 1)).toBe(level - 1);
    }
  });

  it("draws tiers and frames, and the way to the next level", () => {
    expect([1, 99, 100, 299, 300, 599, 600, 999].map(levelTier)).toEqual([
      "bronze",
      "bronze",
      "silver",
      "silver",
      "gold",
      "gold",
      "platinum",
      "platinum",
    ]);
    expect(trophyLevelOf(435)).toEqual({
      level: 8,
      tier: "bronze",
      frame: 1,
      points: 435,
      levelPoints: 420,
      nextLevelPoints: 480,
      progress: 25,
    });
    expect(trophyLevelOf(6000).frame).toBe(2);
    expect(trophyLevelOf(2_000_000)).toMatchObject({
      level: 999,
      frame: 10,
      nextLevelPoints: null,
      progress: 100,
    });
  });
});
