import { describe, expect, it } from "vitest";
import {
  PadButton,
  axisByte,
  decodeAudio,
  decodePadOutput,
  encodePad,
  mergePads,
  padFromGamepad,
  padFromKeys,
  restingPad,
} from "../lib/share";

const button = (value: number) => ({ pressed: value > 0.5, touched: value > 0, value });

describe("share play pad", () => {
  it("encodes the engine's 80-byte input packet", () => {
    const state = {
      buttons: PadButton.cross | PadButton.l2,
      sticks: [255, 0, 128, 128] as [number, number, number, number],
      l2: 128,
      r2: 0,
    };
    const bytes = encodePad(7, 123456789n, 0xfeedfacecafebeefn, state);
    const data = new DataView(bytes.buffer);
    expect(bytes.length).toBe(80);
    expect(data.getUint32(0, true)).toBe(0x49525041);
    expect(data.getUint16(4, true)).toBe(1);
    expect(data.getUint16(6, true)).toBe(80);
    expect(data.getUint32(8, true)).toBe(7);
    expect(data.getUint32(12, true)).toBe(0);
    expect(data.getBigUint64(16, true)).toBe(123456789n);
    expect(data.getBigUint64(24, true)).toBe(0xfeedfacecafebeefn);
    expect(data.getUint32(32, true)).toBe(0x4100);
    expect([...bytes.slice(36, 42)]).toEqual([255, 0, 128, 128, 128, 0]);
    expect([...bytes.slice(44, 56)]).toEqual(Array(12).fill(0));
    expect(data.getFloat32(60, true)).toBeCloseTo(9.80665, 4);
  });

  it("maps a standard gamepad to DualSense bits, sticks and triggers", () => {
    const buttons = Array.from({ length: 18 }, () => button(0));
    buttons[0] = button(1);
    buttons[3] = button(1);
    buttons[7] = button(0.6);
    buttons[9] = button(1);
    buttons[12] = button(1);
    buttons[17] = button(1);
    const pad = padFromGamepad({ axes: [-1, 0.04, 0.5, 1], buttons } as unknown as Gamepad);
    expect(pad.buttons).toBe(
      PadButton.cross |
        PadButton.triangle |
        PadButton.r2 |
        PadButton.options |
        PadButton.up |
        PadButton.touchPad,
    );
    expect(pad.sticks).toEqual([0, 128, 191, 255]);
    expect(pad.r2).toBe(153);
    expect(pad.l2).toBe(0);
    expect(axisByte(0.07)).toBe(128);
  });

  it("maps the keyboard, and merges it with the controller", () => {
    const keys = padFromKeys(new Set(["KeyW", "KeyD", "KeyK", "KeyZ", "ArrowLeft"]));
    expect(keys.buttons).toBe(PadButton.cross | PadButton.l2 | PadButton.left);
    expect(keys.sticks).toEqual([255, 0, 128, 128]);
    expect(keys.l2).toBe(255);
    const merged = mergePads({ ...restingPad(), sticks: [128, 128, 20, 128], buttons: PadButton.r1 }, keys);
    expect(merged.buttons).toBe(keys.buttons | PadButton.r1);
    expect(merged.sticks).toEqual([255, 0, 20, 128]);
  });

  it("reads the game's answer and its sound", () => {
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x4f525041, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, 32, true);
    view.setBigUint64(16, 42n, true);
    out.set([200, 100, 1, 255, 24, 32], 24);
    expect(decodePadOutput(out.buffer)).toMatchObject({
      sentMicros: 42n,
      large: 200,
      small: 100,
      light: [255, 24, 32],
    });
    expect(decodePadOutput(new ArrayBuffer(31))).toBeNull();

    const sound = new ArrayBuffer(16 + 960);
    const s = new DataView(sound);
    s.setUint32(0, 0x41525041, true);
    s.setUint16(4, 1, true);
    s.setUint16(6, 16, true);
    s.setUint32(8, 9, true);
    s.setInt16(16, -1234, true);
    const decoded = decodeAudio(sound);
    expect(decoded?.number).toBe(9);
    expect(decoded?.samples.length).toBe(480);
    expect(decoded?.samples[0]).toBe(-1234);
    expect(decodeAudio(new ArrayBuffer(10))).toBeNull();
  });
});
