import { describe, expect, it } from "vitest";
import {
  PresenceModeUpdate,
  listeningMaxLength,
  listeningOf,
  statusOf,
  withExtras,
  withoutListening,
} from "../src/index.js";

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

describe("what someone listens to", () => {
  it("keeps a title, and an artist when there is one", () => {
    expect(listeningOf({ title: "Blue in Green", artist: "Miles Davis" })).toEqual({
      title: "Blue in Green",
      artist: "Miles Davis",
    });
    expect(listeningOf({ title: "Blue in Green" })).toEqual({ title: "Blue in Green" });
    expect(listeningOf({ title: "Blue in Green", artist: "  " })).toEqual({ title: "Blue in Green" });
    expect(listeningOf({ title: "Blue in Green", artist: 7 })).toEqual({ title: "Blue in Green" });
    // Nothing else a client adds is kept.
    expect(listeningOf({ title: "Blue in Green", album: "Kind of Blue", url: "https://x.test" })).toEqual({
      title: "Blue in Green",
    });
  });

  it("is nothing without a title", () => {
    for (const value of [
      undefined,
      null,
      "Blue in Green",
      7,
      [],
      {},
      { title: "" },
      { title: "   " },
      { title: "\u0000\n\t" },
      { title: 7, artist: "Miles Davis" },
      { artist: "Miles Davis" },
    ])
      expect(listeningOf(value), JSON.stringify(value)).toBeUndefined();
  });

  it("trims, and takes out control characters and marks that turn the text around", () => {
    expect(listeningOf({ title: "  So\u0000 What\r\n ", artist: "\tMiles\u0007 Davis\u007f " })).toEqual({
      title: "So What",
      artist: "Miles Davis",
    });
    expect(listeningOf({ title: "\u202Egnos\u2066 a\u2069\u2028", artist: "x\u009b" })).toEqual({
      title: "gnos a",
      artist: "x",
    });
    // Letters of any language and emoji stay as they are.
    expect(listeningOf({ title: "Gülümse 🎷", artist: "Sezen Aksu" })).toEqual({
      title: "Gülümse 🎷",
      artist: "Sezen Aksu",
    });
  });

  it("cuts a title and an artist to 120 characters, never through an emoji", () => {
    expect(listeningMaxLength).toBe(120);
    const cut = listeningOf({ title: "a".repeat(500), artist: "b".repeat(121) });
    expect(cut).toEqual({ title: "a".repeat(120), artist: "b".repeat(120) });
    expect(listeningOf({ title: "a".repeat(120) })?.title).toHaveLength(120);
    const emoji = listeningOf({ title: "🎷".repeat(200) });
    expect([...(emoji?.title ?? "")]).toHaveLength(120);
    expect(emoji?.title).toBe("🎷".repeat(120));
    // A space left at the cut goes too.
    expect(listeningOf({ title: `${"a".repeat(119)} b` })?.title).toBe("a".repeat(119));
  });

  it("gives the same again when read twice", () => {
    for (const value of [
      { title: "  So\u0000 What ", artist: "Miles Davis" },
      { title: `${"a".repeat(119)} b` },
      { title: "🎷".repeat(200), artist: " x " },
    ]) {
      const once = listeningOf(value);
      expect(listeningOf(once)).toEqual(once);
    }
  });
});

describe("listening in the merged presence", () => {
  const heard = { title: "So What", artist: "Miles Davis" };

  it("stays beside the status and the extras, last", () => {
    const party = { id: "p1", size: 2, max: 8, open: false };
    const merged = withExtras(
      { state: "in_game", titleId: "PPSA01234", listening: heard },
      { party: JSON.stringify(party), status: JSON.stringify("dnd") },
    );
    expect(merged).toEqual({
      state: "in_game",
      titleId: "PPSA01234",
      status: "dnd",
      party,
      listening: heard,
    });
    expect(Object.keys(merged).pop()).toBe("listening");
  });

  it("is cleaned again, so nothing unchecked gets through the merge", () => {
    expect(withExtras({ state: "online", listening: { title: " So\u0000 What ", cover: "x" } }, {})).toEqual({
      state: "online",
      status: "online",
      listening: { title: "So What" },
    });
    expect(withExtras({ state: "online", listening: { title: "" } }, {})).toEqual({
      state: "online",
      status: "online",
    });
    expect(withExtras({ state: "online", listening: null }, {})).toEqual({
      state: "online",
      status: "online",
    });
  });

  it("goes when the person is offline", () => {
    expect(withExtras({ state: "offline", listening: heard }, {})).toEqual({ state: "offline" });
  });

  it("cannot come from the extras the API keeps: only a device's heartbeat carries it", () => {
    expect(withExtras({ state: "online" }, { listening: JSON.stringify(heard) })).toEqual({
      state: "online",
      status: "online",
    });
  });

  it("gives the same string worked out twice", () => {
    for (const status of [undefined, "idle", "dnd"]) {
      const once = withExtras({ state: "online", listening: heard }, extras(status));
      expect(JSON.stringify(withExtras(once, extras(status)))).toBe(JSON.stringify(once));
    }
  });

  it("is left out for anyone who is not a friend", () => {
    const merged = withExtras({ state: "in_game", titleId: "PPSA01234", listening: heard }, {});
    expect(withoutListening(merged)).toEqual({ state: "in_game", titleId: "PPSA01234", status: "online" });
    expect(merged.listening).toEqual(heard);
    const plain = { state: "online" };
    expect(withoutListening(plain)).toBe(plain);
    expect(withoutListening(null)).toBeNull();
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
