import { describe, expect, it } from "vitest";
import { itemsOf, roadmap, statuses, updated } from "../lib/roadmap";

describe("the roadmap", () => {
  it("has every item once, in both languages, with something in every status", () => {
    const ids = roadmap.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of roadmap) {
      expect(statuses).toContain(item.status);
      expect(item.areas.length).toBeGreaterThan(0);
      for (const text of [item.en.t, item.en.d, item.tr.t, item.tr.d]) expect(text.trim()).not.toBe("");
    }
    for (const status of statuses) expect(itemsOf(status).length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(updated))).toBe(false);
  });

  it("says which release brought each done item, and only done items", () => {
    for (const item of roadmap) expect(Boolean(item.shipped)).toBe(item.status === "done");
  });
});
