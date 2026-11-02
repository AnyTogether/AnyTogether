import { describe, expect, it } from "vitest";
import { PresenceModeUpdate, statusOf, withExtras } from "../src/index.js";

const extras = (status?: string) => (status ? { status: JSON.stringify(status) } : {});

describe("the status in the merged presence", () => {
  it("says online, idle or dnd while not offline, and nothing while offline", () => {
    expect(withExtras({ state: "online" }, {})).toEqual({ state: "online", status: "online" });
    expect(withExtras({ state: "away" }, {})).toEqual({ state: "away", status: "idle" });
    expect(withExtras({ state: "online" }, extras("dnd"))).toEqual({ state: "online", status: "dnd" });
    expect(withExtras({ state: "offline" }, extras("dnd"))).toEqual({ state: "offline" });
  });

  it("shows a picked Idle as away to old clients, but keeps a game in_game", () => {
    expect(withExtras({ state: "online" }, extras("idle"))).toEqual({ state: "away", status: "idle" });
    expect(withExtras({ state: "in_game", titleId: "PPSA01234" }, extras("idle"))).toEqual({
      state: "in_game",
      titleId: "PPSA01234",
      status: "idle",
    });
  });

  it("gives the same string worked out twice (the API redoes it over what the gateway kept)", () => {
    for (const status of [undefined, "idle", "dnd"])
      for (const state of ["online", "away", "in_game"]) {
        const once = withExtras({ state }, extras(status));
        expect(JSON.stringify(withExtras(once, extras(status)))).toBe(JSON.stringify(once));
      }
  });

  it("ignores a status field it cannot read", () => {
    expect(withExtras({ state: "online" }, { status: "{" })).toEqual({ state: "online", status: "online" });
  });
});

describe("picking a status", () => {
  it("takes the status, or an old client's appearOffline, and nothing else", () => {
    expect(PresenceModeUpdate.safeParse({ status: "dnd" }).success).toBe(true);
    expect(PresenceModeUpdate.safeParse({ appearOffline: true }).success).toBe(true);
    expect(PresenceModeUpdate.safeParse({}).success).toBe(false);
    expect(PresenceModeUpdate.safeParse({ status: "away" }).success).toBe(false);
  });

  it("reads Invisible from appear offline, which wins", () => {
    expect(statusOf({ appearOffline: true, presenceStatus: "dnd" })).toBe("invisible");
    expect(statusOf({ appearOffline: false, presenceStatus: "idle" })).toBe("idle");
    expect(statusOf({ appearOffline: false, presenceStatus: null })).toBe("online");
    expect(statusOf({ appearOffline: false })).toBe("online");
  });
});
