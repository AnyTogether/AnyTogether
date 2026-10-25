import { describe, expect, it } from "vitest";
import { isoWeek, nameFor, timeFromName, toKeep } from "../src/retention.js";

const daily = (days: number, from = Date.UTC(2026, 9, 25, 3)) =>
  Array.from({ length: days }, (_, i) => {
    const at = new Date(from - i * 86_400_000);
    return { name: nameFor("anytogether", at), at };
  });

describe("retention", () => {
  it("names backups by their UTC time and reads it back", () => {
    const at = new Date("2026-10-25T03:00:07.123Z");
    const name = nameFor("anytogether", at);
    expect(name).toBe("anytogether-20261025T030007Z");
    expect(timeFromName(name)?.toISOString()).toBe("2026-10-25T03:00:07.000Z");
    expect(timeFromName("anytogether-latest")).toBeNull();
  });

  it("counts ISO weeks", () => {
    expect(isoWeek(new Date("2026-10-25T12:00:00Z"))).toBe("2026-W43");
    expect(isoWeek(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeek(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });

  it("keeps the newest per day, week and month", () => {
    const backups = daily(120);
    const keep = toKeep(backups, { daily: 7, weekly: 4, monthly: 3 });
    // The last 7 days, the newest of 4 weeks and of 3 months, some of them the same backup.
    for (const b of backups.slice(0, 7)) expect(keep.has(b.name)).toBe(true);
    expect(keep.has(nameFor("anytogether", new Date(Date.UTC(2026, 8, 30, 3))))).toBe(true); // newest in September
    expect(keep.has(nameFor("anytogether", new Date(Date.UTC(2026, 7, 31, 3))))).toBe(true); // newest in August
    expect(keep.has(nameFor("anytogether", new Date(Date.UTC(2026, 6, 31, 3))))).toBe(false); // July: a 4th month
    expect(keep.size).toBeLessThanOrEqual(7 + 4 + 3);
    expect(keep.size).toBeGreaterThanOrEqual(9);
  });

  it("keeps two backups of the same day as one day", () => {
    const [a, b] = [new Date("2026-10-25T03:00:00Z"), new Date("2026-10-25T15:00:00Z")];
    const keep = toKeep(
      [
        { name: "x-a", at: a },
        { name: "x-b", at: b },
      ],
      { daily: 7, weekly: 0, monthly: 0 },
    );
    expect([...keep]).toEqual(["x-b"]);
  });

  it("always keeps the newest, even with everything set to 0", () => {
    expect([...toKeep(daily(3), { daily: 0, weekly: 0, monthly: 0 })]).toEqual([daily(1)[0]?.name]);
  });
});
