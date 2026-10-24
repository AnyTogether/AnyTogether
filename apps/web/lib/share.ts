import type { Person } from "@/lib/people";

/** Share play as the API shows it: a friend streams the game they run, the website watches and,
 *  when the host hands it a pad, plays as player 2-4. */
export type PadSlot = 2 | 3 | 4;

export interface ShareViewer {
  user: Person;
  device: string;
  slot: PadSlot | null;
  joinedAt: string;
}

export interface SharePlay {
  id: string;
  host: Person | null;
  hostDevice: string;
  titleId: string;
  title: string | null;
  open: boolean;
  maxViewers: number;
  viewers: ShareViewer[];
  startedAt: string;
}

export interface SharePlayJoin {
  sharePlay: SharePlay;
  iceServers: RTCIceServer[];
  expiresAt: string | null;
}

export interface ShareInvite {
  sharePlayId: string;
  from: Person | null;
  titleId: string;
  title: string | null;
  invitedAt: string;
}

/** What a friend's presence says while they share. */
export interface SharePresence {
  sharePlayId: string;
  titleId: string;
  title: string | null;
  open: boolean;
  viewers: number;
  maxViewers: number;
}

export const isShareId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The engine's pad button bits (libScePad PadButton). */
export const PadButton = {
  l3: 0x0002,
  r3: 0x0004,
  options: 0x0008,
  up: 0x0010,
  right: 0x0020,
  down: 0x0040,
  left: 0x0080,
  l2: 0x0100,
  r2: 0x0200,
  l1: 0x0400,
  r1: 0x0800,
  triangle: 0x1000,
  circle: 0x2000,
  cross: 0x4000,
  square: 0x8000,
  touchPad: 0x100000,
} as const;

/** The whole pad: every packet carries all of it. Sticks 0-255, 128 at rest, up is 0. */
export interface PadState {
  buttons: number;
  sticks: [number, number, number, number];
  l2: number;
  r2: number;
}

export const restingPad = (): PadState => ({ buttons: 0, sticks: [128, 128, 128, 128], l2: 0, r2: 0 });

export const samePad = (a: PadState, b: PadState) =>
  a.buttons === b.buttons &&
  a.l2 === b.l2 &&
  a.r2 === b.r2 &&
  a.sticks.every((value, i) => value === b.sticks[i]);

export const padInputMagic = 0x49525041;
export const padOutputMagic = 0x4f525041;
export const padInputSize = 80;
export const padOutputSize = 32;

/** The engine's 80-byte RemotePad input packet, little-endian, as the phone sends it. */
export function encodePad(
  sequence: number,
  sentMicros: bigint,
  session: bigint,
  state: PadState,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(padInputSize);
  const data = new DataView(bytes.buffer);
  data.setUint32(0, padInputMagic, true);
  data.setUint16(4, 1, true);
  data.setUint16(6, padInputSize, true);
  data.setUint32(8, sequence >>> 0, true);
  // Flags at 12: no motion from a browser.
  data.setBigUint64(16, BigInt.asUintN(64, sentMicros), true);
  data.setBigUint64(24, BigInt.asUintN(64, session), true);
  data.setUint32(32, state.buttons >>> 0, true);
  for (let axis = 0; axis < 4; axis++) bytes[36 + axis] = clampByte(state.sticks[axis] ?? 128);
  bytes[40] = clampByte(state.l2);
  bytes[41] = clampByte(state.r2);
  // Touch points at 44 stay off; gravity on the resting accelerometer.
  data.setFloat32(60, 9.80665, true);
  return bytes;
}

export interface PadOutput {
  sequence: number;
  sentMicros: bigint;
  large: number;
  small: number;
  light: [number, number, number] | null;
}

/** What the game sends back: vibration, the light bar, and the echo of the last input. */
export function decodePadOutput(buffer: ArrayBuffer): PadOutput | null {
  if (buffer.byteLength !== padOutputSize) return null;
  const data = new DataView(buffer);
  if (data.getUint32(0, true) !== padOutputMagic || data.getUint16(4, true) !== 1) return null;
  const bytes = new Uint8Array(buffer);
  return {
    sequence: data.getUint32(8, true),
    sentMicros: data.getBigUint64(16, true),
    large: bytes[24] ?? 0,
    small: bytes[25] ?? 0,
    light: bytes[26] ? [bytes[27] ?? 0, bytes[28] ?? 0, bytes[29] ?? 0] : null,
  };
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** -1..1 to 0..255, with a small dead zone round the centre. */
export function axisByte(value: number, deadZone = 0.08) {
  if (!Number.isFinite(value) || Math.abs(value) < deadZone) return 128;
  return clampByte(((Math.max(-1, Math.min(1, value)) + 1) / 2) * 255);
}

/** Standard-mapping Gamepad API buttons, by index, as DualSense bits. */
const gamepadButtons: [number, number][] = [
  [0, PadButton.cross],
  [1, PadButton.circle],
  [2, PadButton.square],
  [3, PadButton.triangle],
  [4, PadButton.l1],
  [5, PadButton.r1],
  [8, PadButton.touchPad],
  [9, PadButton.options],
  [10, PadButton.l3],
  [11, PadButton.r3],
  [12, PadButton.up],
  [13, PadButton.down],
  [14, PadButton.left],
  [15, PadButton.right],
  [17, PadButton.touchPad],
];

export function padFromGamepad(gamepad: Gamepad): PadState {
  const pressed = (index: number) => !!gamepad.buttons[index]?.pressed;
  let buttons = 0;
  for (const [index, bit] of gamepadButtons) if (pressed(index)) buttons |= bit;
  const trigger = (index: number) => {
    const button = gamepad.buttons[index];
    // The analog value when there is one; a digital trigger only says pressed.
    if (!button) return 0;
    return button.value > 0 ? button.value : button.pressed ? 1 : 0;
  };
  const l2 = trigger(6);
  const r2 = trigger(7);
  if (l2 > 0.1) buttons |= PadButton.l2;
  if (r2 > 0.1) buttons |= PadButton.r2;
  const axis = (index: number) => axisByte(gamepad.axes[index] ?? 0);
  return {
    buttons,
    sticks: [axis(0), axis(1), axis(2), axis(3)],
    l2: clampByte(l2 * 255),
    r2: clampByte(r2 * 255),
  };
}

/** The keyboard as a pad: WASD the left stick, arrows the d-pad, IJKL the face buttons. */
export const keyButtons: Record<string, number> = {
  ArrowUp: PadButton.up,
  ArrowDown: PadButton.down,
  ArrowLeft: PadButton.left,
  ArrowRight: PadButton.right,
  KeyI: PadButton.triangle,
  KeyJ: PadButton.square,
  KeyK: PadButton.cross,
  KeyL: PadButton.circle,
  KeyQ: PadButton.l1,
  KeyE: PadButton.r1,
  KeyZ: PadButton.l2,
  KeyC: PadButton.r2,
  Enter: PadButton.options,
  Tab: PadButton.touchPad,
  Backspace: PadButton.touchPad,
  KeyF: PadButton.l3,
  KeyG: PadButton.r3,
};
const stickKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];
export const padKeys = new Set([...Object.keys(keyButtons), ...stickKeys]);

export function padFromKeys(down: ReadonlySet<string>): PadState {
  let buttons = 0;
  for (const code of down) buttons |= keyButtons[code] ?? 0;
  const x = (down.has("KeyD") ? 1 : 0) - (down.has("KeyA") ? 1 : 0);
  const y = (down.has("KeyS") ? 1 : 0) - (down.has("KeyW") ? 1 : 0);
  return {
    buttons,
    sticks: [128 + x * (x > 0 ? 127 : 128), 128 + y * (y > 0 ? 127 : 128), 128, 128],
    l2: down.has("KeyZ") ? 255 : 0,
    r2: down.has("KeyC") ? 255 : 0,
  };
}

/** Both at once: any button held on either, the stick pushed further, the trigger pulled harder. */
export function mergePads(a: PadState, b: PadState): PadState {
  const further = (x: number, y: number) => (Math.abs(y - 128) > Math.abs(x - 128) ? y : x);
  return {
    buttons: a.buttons | b.buttons,
    sticks: [
      further(a.sticks[0], b.sticks[0]),
      further(a.sticks[1], b.sticks[1]),
      further(a.sticks[2], b.sticks[2]),
      further(a.sticks[3], b.sticks[3]),
    ],
    l2: Math.max(a.l2, b.l2),
    r2: Math.max(a.r2, b.r2),
  };
}

/** The game's sound from the host: "APRA", version 1, header 16, packet number, milliseconds, then
 *  16-bit stereo at 48 kHz. Returns the samples, or null for anything else. */
export const audioMagic = 0x41525041;
export function decodeAudio(buffer: ArrayBuffer): { number: number; samples: Int16Array } | null {
  if (buffer.byteLength < 16) return null;
  const data = new DataView(buffer);
  if (data.getUint32(0, true) !== audioMagic || data.getUint16(4, true) !== 1) return null;
  const header = data.getUint16(6, true);
  if (header < 16 || header > buffer.byteLength || (buffer.byteLength - header) % 4) return null;
  // Copied so the samples are aligned whatever the header's size.
  return { number: data.getUint32(8, true), samples: new Int16Array(buffer.slice(header)) };
}

/** A random 64-bit session for this page's pad. */
export function randomSession() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0] ?? 1) << 32n) | BigInt(words[1] ?? 1);
}

/** Microseconds on the wall clock, as the engine echoes them back. */
export const nowMicros = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000));
