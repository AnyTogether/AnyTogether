import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const hours = (count: number) => new Date(Date.now() - count * 3_600_000).toISOString();

describe("front page totals", () => {
  it("counts players, this week's hours, trophies and themes, for anyone, and keeps them a while", async () => {
    const a = await h.user("one@example.com");
    await h.user("two@example.com");
    const device = uuidv7();
    await h.call("POST", `${v1}/me/devices`, { id: device, platform: "macos", name: "Mac" }, a.token);
    const sessions = [
      { id: uuidv7(), titleId: "PPSA01234", deviceId: device, startedAt: hours(5), endedAt: hours(2.5) },
      // Last month's play is not this week's.
      { id: uuidv7(), titleId: "PPSA01234", deviceId: device, startedAt: hours(800), endedAt: hours(799) },
    ];
    expect((await h.call("POST", `${v1}/me/sessions`, { sessions }, a.token)).status).toBe(200);

    const first = await h.call("GET", `${v1}/stats`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ players: 2, hoursThisWeek: 2, trophies: 0, themes: 0 });
    expect(first.headers.get("cache-control")).toContain("max-age=60");

    // Kept, not counted again on every visit.
    await h.user("three@example.com");
    expect((await h.call("GET", `${v1}/stats`)).body.players).toBe(2);
    await h.valkey.del("stats:public");
    expect((await h.call("GET", `${v1}/stats`)).body.players).toBe(3);
  });
});
