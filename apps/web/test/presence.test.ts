import { describe, expect, it } from "vitest";
import { presenceEn, presenceTr } from "../lib/i18n-presence";
import { type Friend, byPresence, listeningLine, presenceDot, withPresence } from "../lib/people";
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

describe("the line that says what a friend listens to", () => {
  const heard = { title: "So What", artist: "Miles Davis" };

  it("names the title and the artist, in English and in Turkish", () => {
    expect(listeningLine({ state: "online", listening: heard }, presenceEn)).toBe(
      "Listening to So What, Miles Davis",
    );
    expect(listeningLine({ state: "online", listening: heard }, presenceTr)).toBe(
      "So What, Miles Davis dinliyor",
    );
    expect(listeningLine({ state: "in_game", listening: { title: "So What" } }, presenceEn)).toBe(
      "Listening to So What",
    );
    expect(listeningLine({ state: "away", listening: { title: "So What", artist: " " } }, presenceTr)).toBe(
      "So What dinliyor",
    );
  });

  it("is not there while they are offline, share nothing, or the title makes no sense", () => {
    expect(listeningLine(undefined, presenceEn)).toBeNull();
    expect(listeningLine({ state: "online" }, presenceEn)).toBeNull();
    expect(listeningLine({ state: "offline", listening: heard }, presenceEn)).toBeNull();
    expect(listeningLine({ state: "online", listening: { title: "  " } }, presenceEn)).toBeNull();
    expect(listeningLine({ state: "online", listening: { title: 7 } as never }, presenceEn)).toBeNull();
  });

  it("takes a title as it is written, braces too", () => {
    expect(
      listeningLine({ state: "online", listening: { title: "{artist}", artist: "{title}" } }, presenceEn),
    ).toBe("Listening to {artist}, {title}");
  });

  it("names no player or service", () => {
    for (const text of [presenceEn, presenceTr])
      for (const line of [text.listeningTo, text.listeningToBy])
        expect(line).not.toMatch(/spotify|apple|music|youtube|tidal|deezer/i);
  });

  it("follows a friend's presence.updated: shown when it comes, gone when it is left out", () => {
    const list = [friend("a", "Ayşe", "online")];
    const playing = withPresence(list, { userId: "a", state: "online", status: "online", listening: heard });
    expect(listeningLine(playing[0]?.presence, presenceEn)).toBe("Listening to So What, Miles Davis");
    const stopped = withPresence(playing, { userId: "a", state: "online", status: "online" });
    expect(listeningLine(stopped[0]?.presence, presenceEn)).toBeNull();
    const profile = profilePresenceAfter(
      { presence: { state: "online" as const }, picked: "online" as const },
      { type: "presence.updated", data: { userId: "a", state: "online", listening: heard } },
      { userId: "a", self: false },
    );
    expect(listeningLine(profile.presence, presenceEn)).toBe("Listening to So What, Miles Davis");
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
