import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  isShown,
  kindOfFile,
  savesByGame,
  usageParts,
  voiceFormat,
  waveform,
} from "../lib/storage";

const mb = 1024 * 1024;

describe("storage helpers", () => {
  it("write sizes the way the quota counts them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(840 * 1024)).toBe("840 KB");
    expect(formatBytes(12.44 * mb)).toBe("12.4 MB");
    expect(formatBytes(100 * mb)).toBe("100 MB");
    expect(formatBytes(1.5 * mb, "tr")).toBe("1,5 MB");
  });

  it("write lengths as minutes and seconds", () => {
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(60_000)).toBe("1:00");
    expect(formatDuration(null)).toBe("0:00");
  });

  it("split the usage bar, never past full, and say how full it is", () => {
    expect(usageParts({ used: 30 * mb, limit: 100 * mb, saves: 20 * mb, media: 10 * mb })).toEqual({
      saves: 20,
      media: 10,
      free: 70,
      level: "ok",
    });
    expect(usageParts({ used: 85 * mb, limit: 100 * mb, saves: 80 * mb, media: 5 * mb }).level).toBe("high");
    const over = usageParts({ used: 120 * mb, limit: 100 * mb, saves: 90 * mb, media: 30 * mb });
    expect(over.saves + over.media).toBe(100);
    expect(over.level).toBe("full");
    expect(usageParts({ used: 0, limit: 0, saves: 0, media: 0 }).free).toBe(100);
  });

  it("know which files can be sent", () => {
    expect(kindOfFile({ type: "image/png" })).toBe("image");
    expect(kindOfFile({ type: "image/webp" })).toBe("image");
    expect(kindOfFile({ type: "video/mp4" })).toBe("clip");
    expect(kindOfFile({ type: "", name: "clip.MP4" })).toBe("clip");
    expect(kindOfFile({ type: "image/gif" })).toBeNull();
    expect(kindOfFile({ type: "video/quicktime" })).toBeNull();
  });

  it("pick the voice format the API prefers", () => {
    expect(voiceFormat((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(voiceFormat(() => true)).toBe("audio/webm;codecs=opus");
    expect(voiceFormat(() => false)).toBeNull();
  });

  it("tell shown attachments from removed and blocked ones", () => {
    expect(isShown({ id: "a", kind: "image", removed: true })).toBe(false);
    expect(isShown({ id: "a", kind: "voice", blocked: true })).toBe(false);
    expect(
      isShown({
        id: "a",
        kind: "image",
        contentType: "image/webp",
        size: 1,
        width: 1,
        height: 1,
        durationMs: null,
        url: "u",
        thumb: null,
        poster: null,
        createdAt: "",
      }),
    ).toBe(true);
  });

  it("group saves by game, newest first", () => {
    const version = (size: number) => ({
      id: String(size),
      version: 1,
      size,
      sha256: "",
      device: null,
      launcherVersion: null,
      createdAt: "",
      download: "",
    });
    const games = savesByGame([
      {
        id: "1",
        titleId: "CUSA00001",
        game: "Old",
        slot: "a",
        updatedAt: "2026-01-01",
        versions: [version(5)],
      },
      {
        id: "2",
        titleId: "PPSA00002",
        game: "New",
        slot: "a",
        updatedAt: "2026-05-01",
        versions: [version(1), version(2)],
      },
      {
        id: "3",
        titleId: "CUSA00001",
        game: "Old",
        slot: "b",
        updatedAt: "2026-06-01",
        versions: [version(3)],
      },
    ]);
    expect(games.map((g) => [g.titleId, g.slots.length, g.size])).toEqual([
      ["CUSA00001", 2, 8],
      ["PPSA00002", 1, 3],
    ]);
  });

  it("draw the same voice note the same way", () => {
    expect(waveform("abc")).toEqual(waveform("abc"));
    expect(waveform("abc")).not.toEqual(waveform("abd"));
    expect(waveform("x", 10)).toHaveLength(10);
    for (const h of waveform("y")) expect(h).toBeGreaterThan(0);
  });
});
