import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/compat.js";
import { joinRefusal, versionFits } from "../src/gameSessions.js";

describe("game session versions", () => {
  it("compares versions part by part, numbers as numbers", () => {
    expect(compareVersions("01.044.000", "01.044.000")).toBe(0);
    expect(compareVersions("01.008.000", "01.044.000")).toBe(-1);
    expect(compareVersions("01.010", "01.9")).toBe(1);
    expect(compareVersions("0.2.21-4194", "0.2.20-5000")).toBe(1);
  });

  it("fits under the exact, major and any rules", () => {
    expect(versionFits("exact", "01.044.000", "01.044.000")).toBe(true);
    expect(versionFits("exact", "01.044.000", "01.050.000")).toBe(false);
    expect(versionFits("major", "01.044.000", "01.050.000")).toBe(true);
    expect(versionFits("major", "01.044.000", "02.000.000")).toBe(false);
    expect(versionFits("any", "01.044.000", "09.000.000")).toBe(true);
  });

  it("says why a joiner cannot play and who should update", () => {
    const session = { gameVersion: "01.044.000", engineBuild: "0.2.21-4194", versionRule: "exact" as const };
    expect(joinRefusal(session, { gameVersion: "01.044.000", engineBuild: "0.2.21-4194" })).toBeNull();
    expect(joinRefusal(session, { gameVersion: "01.008.000", engineBuild: "0.2.21-4194" })).toEqual({
      reason: "game_version",
      expected: "01.044.000",
      actual: "01.008.000",
      update: "you",
      overridable: true,
    });
    // Trying anyway is for a game version only: a different engine build cannot talk to the host's.
    expect(joinRefusal(session, { gameVersion: "01.044.000", engineBuild: "0.2.22-1" })).toMatchObject({
      reason: "engine",
      update: "host",
      overridable: false,
    });
  });
});
