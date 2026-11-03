import { describe, expect, it } from "vitest";
import { type Friend, byPresence, presenceDot, withPresence } from "../lib/people";
import { profilePresenceAfter } from "../lib/presenceMode";

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

describe("the status line under a profile's name", () => {
  const me = { userId: "me", self: true };
  const online = {
    presence: { state: "online" as const, status: "online" as const },
    picked: "online" as const,
  };
  const mode = (status: string) => ({
    type: "presence.mode",
    data: { status, appearOffline: status === "invisible" },
  });

  it("follows a status picked in the launcher on one's own profile", () => {
    const dnd = profilePresenceAfter(online, mode("dnd"), me);
    expect(dnd).toEqual({ picked: "dnd", presence: { state: "online", status: "dnd" } });
    expect(presenceDot(dnd.presence)).toBe("dnd");
    const idle = profilePresenceAfter(dnd, mode("idle"), me);
    expect(presenceDot(idle.presence)).toBe("idle");
    const invisible = profilePresenceAfter(idle, mode("invisible"), me);
    expect(invisible.presence).toEqual({ state: "offline" });
    // Back from Invisible: this page is open, so online.
    const back = profilePresenceAfter(invisible, mode("online"), me);
    expect(back.presence).toEqual({ state: "online", status: "online" });
    // An older API's appear-offline switch works too.
    expect(
      profilePresenceAfter(online, { type: "presence.mode", data: { appearOffline: true } }, me).picked,
    ).toBe("invisible");
  });

  it("keeps the game while the status changes", () => {
    const playing = {
      presence: { state: "in_game" as const, titleId: "PPSA01234", status: "online" as const },
      picked: "online" as const,
    };
    const next = profilePresenceAfter(playing, mode("dnd"), me);
    expect(next.presence).toEqual({ state: "in_game", titleId: "PPSA01234", status: "dnd" });
  });

  it("ignores presence.mode on someone else's profile, and follows their presence.updated", () => {
    const friend = { userId: "f1", self: false };
    expect(profilePresenceAfter(online, mode("dnd"), friend)).toBe(online);
    const next = profilePresenceAfter(
      online,
      { type: "presence.updated", data: { userId: "f1", state: "away", status: "idle" } },
      friend,
    );
    expect(presenceDot(next.presence)).toBe("idle");
    expect(
      profilePresenceAfter(
        online,
        { type: "presence.updated", data: { userId: "f2", state: "away" } },
        friend,
      ),
    ).toBe(online);
    expect(
      profilePresenceAfter(
        online,
        { type: "presence.updated", data: { userId: "f1", state: "nap" } },
        friend,
      ),
    ).toBe(online);
    expect(profilePresenceAfter(online, { type: "messages.new", data: {} }, me)).toBe(online);
  });
});
