import { MetList, rememberSwitchAllowed } from "@/components/MetList";
import type { UiStrings } from "@/lib/i18n";
import { psnEn, psnTr } from "@/lib/i18n-psn";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

describe("the remember switch on Recently played with", () => {
  it("asks before turning off, since that deletes the list on both sides", () => {
    const no = vi.fn(() => false);
    expect(rememberSwitchAllowed(false, psnEn, no)).toBe(false);
    expect(no).toHaveBeenCalledWith(psnEn.rememberMetOffConfirm);
    expect(rememberSwitchAllowed(false, psnTr, () => true)).toBe(true);
    // Turning it on deletes nothing: not asked.
    const never = vi.fn(() => false);
    expect(rememberSwitchAllowed(true, psnEn, never)).toBe(true);
    expect(never).not.toHaveBeenCalled();
  });

  it("says what the list is and that turning off deletes it for both people", () => {
    expect(psnTr.rememberMetHint).toContain("partide");
    expect(psnTr.rememberMetOffConfirm).toContain("silinir");
    expect(psnTr.rememberMetOffConfirm).toContain("onların listesinden");
    expect(psnEn.rememberMetOffConfirm).toContain("taken off their lists too");
    for (const text of [
      psnEn.rememberMetHint,
      psnEn.rememberMetOffConfirm,
      psnTr.rememberMetHint,
      psnTr.rememberMetOffConfirm,
    ]) {
      expect(text).not.toContain(";");
      expect(text).not.toContain("·");
      expect(text.endsWith(".")).toBe(true);
    }
  });

  it("shows the description under the switch", () => {
    const texts = { ...psnEn, language: "en" } as unknown as UiStrings;
    const html = renderToStaticMarkup(
      <MetList texts={texts} initial={{ remember: true, days: 30, players: [] }} now={Date.now()} />,
    );
    expect(html).toContain(psnEn.rememberMetHint);
  });
});
