import { describe, expect, it } from "vitest";
import { formatJoinCode, isJoinCode, normalizeJoinCode } from "../lib/social";
import { micState, toggleDeafen, toggleMic } from "../lib/voice";

describe("join codes on the website", () => {
  it("reads a code however it is typed and shows it in two halves", () => {
    expect(normalizeJoinCode(" k7qm-3xpa")).toBe("K7QM3XPA");
    expect(isJoinCode("K7QM3XPA")).toBe(true);
    expect(isJoinCode("K7QM3XP0")).toBe(false);
    expect(isJoinCode("K7QM")).toBe(false);
    expect(formatJoinCode("K7QM3XPA")).toBe("K7QM-3XPA");
  });
});

describe("mute and deafen", () => {
  const open = micState();

  it("deafening mutes, and undeafening gives back the mic as it was", () => {
    const deaf = toggleDeafen(open);
    expect(deaf).toMatchObject({ micOn: false, deafened: true });
    expect(toggleDeafen(deaf)).toMatchObject({ micOn: true, deafened: false });
    // Muted before deafening: still muted after.
    const mutedDeaf = toggleDeafen(toggleMic(open));
    expect(toggleDeafen(mutedDeaf)).toMatchObject({ micOn: false, deafened: false });
  });

  it("unmuting while deafened undeafens too", () => {
    expect(toggleMic(toggleDeafen(open))).toMatchObject({ micOn: true, deafened: false });
    expect(toggleMic(open)).toMatchObject({ micOn: false, deafened: false });
  });
});
