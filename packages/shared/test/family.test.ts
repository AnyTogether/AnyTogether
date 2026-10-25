import { describe, expect, it } from "vitest";
import {
  FamilyRestrictionsUpdate,
  type PlayTime,
  ageLevelFor,
  allowance,
  applyRestrictionsUpdate,
  defaultRestrictions,
  localClock,
  restrictionsOf,
  titleVerdict,
  weekdays,
} from "../src/family.js";

const every = (limitMinutes: number | null, from: string | null = null, until: string | null = null) =>
  Object.fromEntries(weekdays.map((day) => [day, { limitMinutes, from, until }])) as PlayTime["days"];
const time = (overrides: Partial<PlayTime> = {}): PlayTime => ({
  ...defaultRestrictions("Europe/Istanbul").playTime,
  enabled: true,
  ...overrides,
});

describe("the family policy", () => {
  it("reads the clock of a time zone", () => {
    // 2026-10-25 21:30 UTC is Monday 00:30 in Istanbul (UTC+3).
    const clock = localClock(new Date("2026-10-25T21:30:00Z"), "Europe/Istanbul");
    expect(clock).toMatchObject({ date: "2026-10-26", weekday: "mon", minutes: 30 });
    expect(localClock(new Date("2026-10-25T21:30:00Z"), "UTC")).toMatchObject({
      date: "2026-10-25",
      weekday: "sun",
    });
  });

  it("gives what is left of the day's limit, with extra time", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const left = allowance(time({ days: every(60) }), { now, playedSeconds: 50 * 60, bonusMinutes: 0 });
    expect(left).toMatchObject({ allowed: true, remainingSeconds: 600, limitMinutes: 60, reason: null });
    const over = allowance(time({ days: every(60) }), { now, playedSeconds: 61 * 60, bonusMinutes: 0 });
    expect(over).toMatchObject({ allowed: false, remainingSeconds: 0, reason: "limit" });
    const more = allowance(time({ days: every(60) }), { now, playedSeconds: 61 * 60, bonusMinutes: 15 });
    expect(more).toMatchObject({ allowed: true, limitMinutes: 75, remainingSeconds: 14 * 60 });
  });

  it("keeps to the window and ends at its close", () => {
    const plan = time({ days: every(null, "16:00", "20:00") });
    // 18:30 in Istanbul: an hour and a half left of the window.
    const inside = allowance(plan, {
      now: new Date("2026-10-26T15:30:00Z"),
      playedSeconds: 0,
      bonusMinutes: 0,
    });
    expect(inside).toMatchObject({ allowed: true, remainingSeconds: 90 * 60 });
    const before = allowance(plan, {
      now: new Date("2026-10-26T10:00:00Z"),
      playedSeconds: 0,
      bonusMinutes: 0,
    });
    expect(before).toMatchObject({ allowed: false, reason: "window" });
    // The limit ends first when less is left of it than of the window.
    const both = allowance(time({ days: every(30, "16:00", "20:00") }), {
      now: new Date("2026-10-26T15:30:00Z"),
      playedSeconds: 20 * 60,
      bonusMinutes: 0,
    });
    expect(both.remainingSeconds).toBe(600);
  });

  it("has no end when play time is off or the day has no limit", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(
      allowance(time({ enabled: false, days: every(10) }), { now, playedSeconds: 9999, bonusMinutes: 0 }),
    ).toMatchObject({
      allowed: true,
      remainingSeconds: null,
      limitMinutes: null,
    });
    expect(
      allowance(time({ days: every(null) }), { now, playedSeconds: 9999, bonusMinutes: 0 }).remainingSeconds,
    ).toBeNull();
  });

  it("checks age ratings by region, unknown ratings and approved games", () => {
    const levels = { default: 16, US: 13, TR: 12 };
    expect(ageLevelFor(levels, "TR")).toBe(12);
    expect(ageLevelFor(levels, "DE")).toBe(16);
    expect(ageLevelFor(null, "TR")).toBeNull();
    const rules = { ...defaultRestrictions(), ageLimit: 12 };
    expect(titleVerdict(rules, "PPSA02929", levels)).toBe("age");
    expect(titleVerdict({ ...rules, ageRegion: "TR" }, "PPSA02929", levels)).toBe("allowed");
    expect(titleVerdict(rules, "PPSA02929", null)).toBe("allowed");
    expect(titleVerdict({ ...rules, unknownAge: "block" }, "PPSA02929", null)).toBe("unknown");
    expect(titleVerdict({ ...rules, allowedTitles: ["PPSA02929"] }, "PPSA02929", levels)).toBe("allowed");
    expect(titleVerdict({ ...rules, ageLimit: null }, "PPSA02929", levels)).toBe("allowed");
  });

  it("reads stored limits over the defaults and updates them part by part", () => {
    const stored = restrictionsOf({
      voiceChat: true,
      messages: "shout",
      playTime: { enabled: true, days: { mon: { limitMinutes: 30, from: null, until: null } } },
    });
    expect(stored.voiceChat).toBe(true);
    expect(stored.messages).toBe("friends");
    expect(stored.playTime.enabled).toBe(true);
    expect(stored.playTime.days.mon.limitMinutes).toBe(30);
    expect(stored.playTime.days.tue.limitMinutes).toBeNull();
    const update = FamilyRestrictionsUpdate.parse({
      playTime: { days: { tue: { limitMinutes: 45, from: null, until: null } } },
    });
    const next = applyRestrictionsUpdate(stored, update);
    expect(next.playTime.days.mon.limitMinutes).toBe(30);
    expect(next.playTime.days.tue.limitMinutes).toBe(45);
    expect(next.playTime.enabled).toBe(true);
    expect(FamilyRestrictionsUpdate.safeParse({ unknown: 1 }).success).toBe(false);
  });
});
