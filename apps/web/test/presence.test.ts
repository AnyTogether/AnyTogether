import { describe, expect, it } from "vitest";
import { type Friend, byPresence, withPresence } from "../lib/people";

const friend = (userId: string, displayName: string, state: Friend["presence"]["state"]): Friend => ({
  userId,
  handle: displayName.toLowerCase(),
  displayName,
  avatar: null,
  presence: { state },
});

describe("live presence on the friends page", () => {
  const list = [friend("a", "Ayşe", "offline"), friend("b", "Bora", "online")];

  it("changes the one friend a presence.updated event is about", () => {
    const next = withPresence(list, { userId: "a", state: "in_game", titleId: "PPSA01234", since: "x" });
    expect(next[0]?.presence).toEqual({ state: "in_game", titleId: "PPSA01234", since: "x" });
    expect(next[1]).toBe(list[1]);
    // Playing now sorts first.
    expect([...next].sort(byPresence).map((f) => f.userId)).toEqual(["a", "b"]);
    expect(withPresence(next, { userId: "a", state: "offline" })[0]?.presence).toEqual({ state: "offline" });
  });

  it("leaves the list as it is for someone not on it, or an event that makes no sense", () => {
    expect(withPresence(list, { userId: "z", state: "online" })).toBe(list);
    expect(withPresence(list, { userId: "a", state: "dancing" })).toBe(list);
    expect(withPresence(list, { state: "online" })).toBe(list);
    expect(withPresence(list, null)).toBe(list);
  });
});
