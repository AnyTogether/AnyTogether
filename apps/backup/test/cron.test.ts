import { describe, expect, it } from "vitest";
import { longestGap, nextRun, parseCron } from "../src/cron.js";

// The tests run with TZ=UTC (vitest.config.ts), as the container does by default.
const at = (iso: string) => new Date(iso);

describe("cron", () => {
  it("fires nightly at 03:00 by default", () => {
    const cron = parseCron("0 3 * * *");
    expect(nextRun(cron, at("2026-10-25T02:59:00Z")).toISOString()).toBe("2026-10-25T03:00:00.000Z");
    expect(nextRun(cron, at("2026-10-25T03:00:00Z")).toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(longestGap(cron, at("2026-10-25T00:00:00Z"))).toBe(86_400);
  });

  it("reads steps, ranges, lists and macros", () => {
    expect(nextRun(parseCron("*/15 * * * *"), at("2026-10-25T10:07:30Z")).toISOString()).toBe(
      "2026-10-25T10:15:00.000Z",
    );
    expect(nextRun(parseCron("30 1,13 * * *"), at("2026-10-25T02:00:00Z")).toISOString()).toBe(
      "2026-10-25T13:30:00.000Z",
    );
    // 2026-10-25 is a Sunday; weekdays only: Monday.
    expect(nextRun(parseCron("0 4 * * 1-5"), at("2026-10-25T05:00:00Z")).toISOString()).toBe(
      "2026-10-26T04:00:00.000Z",
    );
    expect(nextRun(parseCron("@weekly"), at("2026-10-25T05:00:00Z")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(nextRun(parseCron("0 0 * * 7"), at("2026-10-25T05:00:00Z")).getUTCDay()).toBe(0);
    expect(longestGap(parseCron("@hourly"))).toBe(3600);
    expect(longestGap(parseCron("0 4 * * 1-5"), at("2026-10-25T00:00:00Z"))).toBe(3 * 86_400);
  });

  it("matches either day field when both are restricted, as cron does", () => {
    // The 1st of the month or any Friday.
    const cron = parseCron("0 0 1 * 5");
    expect(nextRun(cron, at("2026-10-25T00:00:00Z")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(nextRun(cron, at("2026-10-30T00:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("finds the 29th of February", () => {
    expect(nextRun(parseCron("0 0 29 2 *"), at("2026-10-25T00:00:00Z")).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("refuses what it cannot read", () => {
    expect(() => parseCron("0 3 * *")).toThrow(/five fields/);
    expect(() => parseCron("61 * * * *")).toThrow(/outside/);
    expect(() => parseCron("x * * * *")).toThrow(/cannot read/);
    expect(() => nextRun(parseCron("0 0 31 2 *"), new Date())).toThrow(/never fires/);
  });
});
