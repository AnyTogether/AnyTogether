import { z } from "zod";

/** End-to-end encrypted direct messages (docs/e2ee.md). The server keeps only public device keys
 *  and ciphertext; packages/e2ee does the cryptography. */

/** Standard base64 with padding, of exactly `bytes` bytes (or at most `max` for a body). */
const base64 = (bytes: number) =>
  z
    .string()
    .length(Math.ceil(bytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64");
const DeviceId = z.string().regex(/^[0-9a-f]{32}$/, "a device ID");

/** The most device keys one account has at once; signing in on more removes none, but refuses. */
export const maxE2eeDevices = 16;
/** The longest sealed body (base64): a 4000-character text and an attachment's keys fit easily. */
export const maxSealedBody = 24_000;
/** What older clients show for a sealed message instead of its text. */
export const sealedFallbackText = "[encrypted message]";

/** PUT /me/e2ee/device: this session's keys. `sig` is the device's Ed25519 signature over
 *  "AnyTogether-E2EE-v1/device\n" + userId + "\n" + boxKey. */
export const E2eeDeviceRegister = z.object({
  signKey: base64(32),
  boxKey: base64(32),
  sig: base64(64),
  name: z.string().trim().min(1).max(80),
});

/** A sealed message as sent and stored: `keys` wraps its key for every active device of both
 *  people, by device ID. */
export const SealedMessage = z.object({
  v: z.literal(1),
  device: DeviceId,
  eph: base64(32),
  nonce: base64(12),
  body: z
    .string()
    .min(24)
    .max(maxSealedBody)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64"),
  sig: base64(64),
  keys: z.record(DeviceId, base64(48)).refine((keys) => {
    const n = Object.keys(keys).length;
    return n >= 2 && n <= maxE2eeDevices * 2;
  }, "keys: one for each device of both people"),
});
export type SealedMessage = z.infer<typeof SealedMessage>;

export interface E2eeDeviceView {
  /** The first 16 bytes of SHA-256(signKey), hex. */
  id: string;
  signKey: string;
  boxKey: string;
  sig: string;
  name: string;
  createdAt: string;
  /** Set for a removed device (signed out, or removed by hand): kept to verify its old messages. */
  removedAt: string | null;
}

/** GET /e2ee/devices?users=a,b: each person's active devices and the removed ones. Only oneself
 *  and people one is friends with or has a direct conversation with are answered. */
export interface E2eeDevicesView {
  users: { userId: string; devices: E2eeDeviceView[]; removed: E2eeDeviceView[] }[];
}

/** Someone's device keys changed: told to them and to the people they have a direct conversation
 *  with, so clients fetch the list again and show the change. */
export type E2eeEvent = { type: "e2ee.devices"; data: { userId: string } };
