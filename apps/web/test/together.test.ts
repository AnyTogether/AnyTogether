import { describe, expect, it } from "vitest";
import { togetherEn, togetherTr } from "../lib/i18n-together";
import { isTogetherEvent, playingTogether, togetherCard } from "../lib/together";

const names = new Map([["PPSA17221", "Minecraft"]]);

describe("Play Together on the website", () => {
  it("words a friend in a LAN game as playing together, with the places taken", () => {
    const presence = {
      state: "in_game" as const,
      titleId: "PPSA17221",
      game: {
        sessionId: "s1",
        titleId: "PPSA17221",
        kind: "lan" as const,
        hostId: "h",
        joinable: false,
        players: 2,
        capacity: 4,
      },
    };
    expect(playingTogether(presence, togetherEn, names)).toBe("Playing Minecraft together (2/4)");
    expect(playingTogether(presence, togetherTr, names)).toBe("Minecraft birlikte oynanıyor (2/4)");
    // Not a LAN game, or no game: nothing to say here.
    expect(
      playingTogether({ ...presence, game: { ...presence.game, kind: "online" } }, togetherEn, names),
    ).toBeNull();
    expect(playingTogether({ state: "online" }, togetherEn, names)).toBeNull();
    // A game the page does not know reads as its title ID.
    expect(
      playingTogether({ ...presence, game: { ...presence.game, titleId: "PPSA00001" } }, togetherEn, names),
    ).toBe("Playing PPSA00001 together (2/4)");
  });

  it("shows the party's Play Together game: who started it, who plays, and the places left", () => {
    const members = [
      { userId: "h", handle: "mira", displayName: "Mira", avatar: null, joinedAt: "" },
      { userId: "b", handle: "bora", displayName: "Bora", avatar: null, joinedAt: "" },
      { userId: "c", handle: "can", displayName: "Can", avatar: null, joinedAt: "" },
    ];
    const together = {
      sessionId: "s1",
      hostId: "h",
      titleId: "PPSA17221",
      gameVersion: "01.044.000",
      engineBuild: "0.2.21-4194",
      versionRule: "exact" as const,
      players: ["h", "b"],
      capacity: 4,
      startedAt: "2026-10-26T00:00:00.000Z",
    };
    const card = togetherCard(together, members, "b", togetherEn, names);
    expect(card).toMatchObject({
      heading: "Mira started Minecraft",
      places: "2/4",
      version: "Version 01.044.000",
      playing: true,
      host: false,
    });
    expect(card.players.map((p) => p.displayName)).toEqual(["Mira", "Bora"]);
    expect(card.waiting.map((p) => p.displayName)).toEqual(["Can"]);
    expect(togetherCard(together, members, "h", togetherEn, names).host).toBe(true);
    expect(togetherCard(together, members, "c", togetherTr, names).heading).toBe("Mira, Minecraft başlattı");
  });

  it("knows which live events change the party's Play Together game", () => {
    expect(isTogetherEvent("game_session.started")).toBe(true);
    expect(isTogetherEvent("game_session.member_joined")).toBe(true);
    expect(isTogetherEvent("game_session.ended")).toBe(true);
    expect(isTogetherEvent("game_session.signal")).toBe(false);
    expect(isTogetherEvent("party.updated")).toBe(false);
  });
});
