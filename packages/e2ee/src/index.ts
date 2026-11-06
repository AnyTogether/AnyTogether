import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/** End-to-end encryption of direct messages, protocol v1 (docs/e2ee.md). The web app and the API
 *  use this; the launchers and the phone app follow the same steps and check them against
 *  test/e2ee-v1.json. Only audited libraries do the cryptography: noble's X25519, Ed25519,
 *  ChaCha20-Poly1305 (RFC 8439), HKDF and SHA-256. */

export const e2eeVersion = 1;
const tag = "AnyTogether-E2EE-v1";

// --- encodings -------------------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Standard base64 with padding; anything else (or a wrong length) throws. */
export function fromBase64(text: string, length?: number): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0)
    throw new E2eeError("bad_encoding");
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (length !== undefined && bytes.length !== length) throw new E2eeError("bad_encoding");
  return bytes;
}

const utf8 = (text: string) => utf8ToBytes(text);
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export class E2eeError extends Error {
  constructor(readonly code: "bad_encoding" | "bad_device" | "no_key" | "bad_message" | "bad_payload") {
    super(code);
  }
}

// --- devices ---------------------------------------------------------------------------------

/** What one device keeps and never sends: its signing seed and its X25519 secret. */
export interface DeviceSecrets {
  signSeed: Uint8Array;
  boxSecret: Uint8Array;
  signKey: Uint8Array;
  boxKey: Uint8Array;
  deviceId: string;
}

/** A device as the server lists it: public keys and the device's signature over them. */
export interface PublicDevice {
  id: string;
  signKey: string;
  boxKey: string;
  sig: string;
}

export const deviceIdOf = (signKey: Uint8Array) => bytesToHex(sha256(signKey).subarray(0, 16));

export function deviceFromSeeds(signSeed: Uint8Array, boxSecret: Uint8Array): DeviceSecrets {
  if (signSeed.length !== 32 || boxSecret.length !== 32) throw new E2eeError("bad_device");
  const signKey = ed25519.getPublicKey(signSeed);
  return {
    signSeed,
    boxSecret,
    signKey,
    boxKey: x25519.getPublicKey(boxSecret),
    deviceId: deviceIdOf(signKey),
  };
}

export const newDevice = () => deviceFromSeeds(randomBytes(32), randomBytes(32));

const deviceStatement = (userId: string, boxKey: Uint8Array) =>
  concatBytes(utf8(`${tag}/device\n${userId}\n`), boxKey);

/** The device's public record for `userId`, as PUT /me/e2ee/device takes it. */
export function publicDevice(device: DeviceSecrets, userId: string): PublicDevice {
  return {
    id: device.deviceId,
    signKey: toBase64(device.signKey),
    boxKey: toBase64(device.boxKey),
    sig: toBase64(ed25519.sign(deviceStatement(userId, device.boxKey), device.signSeed)),
  };
}

/** A listed device belongs to `userId` as far as its keys can tell: its ID is its signing key's,
 *  and its signature over its X25519 key and the user ID holds. */
export function verifyDevice(userId: string, device: PublicDevice): boolean {
  try {
    const signKey = fromBase64(device.signKey, 32);
    const boxKey = fromBase64(device.boxKey, 32);
    if (deviceIdOf(signKey) !== device.id) return false;
    return ed25519.verify(fromBase64(device.sig, 64), deviceStatement(userId, boxKey), signKey, {
      zip215: false,
    });
  } catch {
    return false;
  }
}

// --- messages --------------------------------------------------------------------------------

/** A message's encrypted form, as the API stores and returns it. */
export interface Sealed {
  v: 1;
  /** The sending device's ID. */
  device: string;
  /** The message's ephemeral X25519 public key. */
  eph: string;
  nonce: string;
  body: string;
  sig: string;
  /** The content key, wrapped for each device of both people, by device ID. */
  keys: Record<string, string>;
}

export interface SealedAttachment {
  mediaId: string;
  kind: "image" | "clip" | "voice";
  type: string;
  size: number;
  key: string;
  nonce: string;
  width?: number;
  height?: number;
  durationMs?: number;
  poster?: { key: string; nonce: string; type: string };
}

/** What a sealed message says. */
export interface Payload {
  v: 1;
  text?: string;
  attachment?: SealedAttachment;
}

export interface MessageContext {
  conversationId: string;
  messageId: string;
  senderUserId: string;
  senderDeviceId: string;
}

const header = (c: MessageContext) =>
  utf8(`${tag}/msg\n${c.conversationId}\n${c.messageId}\n${c.senderUserId}\n${c.senderDeviceId}`);
const zeroNonce = new Uint8Array(12);
const isZero = (bytes: Uint8Array) => bytes.every((b) => b === 0);

/** HKDF over X25519(secret, peer), salted with the message's ephemeral key and the recipient's key. */
function wrapKeyFor(secret: Uint8Array, peer: Uint8Array, eph: Uint8Array, recipient: Uint8Array) {
  const shared = x25519.getSharedSecret(secret, peer);
  if (isZero(shared)) throw new E2eeError("bad_device");
  return hkdf(sha256, shared, concatBytes(eph, recipient), utf8(`${tag}/wrap`), 32);
}

const signed = (head: Uint8Array, eph: Uint8Array, nonce: Uint8Array, body: Uint8Array) =>
  concatBytes(head, new Uint8Array([0]), eph, nonce, sha256(body));

/** Fixed randomness, for the test vectors only. */
export interface SealRandom {
  contentKey: Uint8Array;
  nonce: Uint8Array;
  ephSecret: Uint8Array;
}

/** Encrypts `payload` once and wraps its key for each recipient device (the sender's own devices
 *  among them). `payloadBytes` overrides the JSON, so the vectors can fix it byte for byte. */
export function seal(input: {
  context: Omit<MessageContext, "senderDeviceId">;
  sender: DeviceSecrets;
  recipients: { id: string; boxKey: string }[];
  payload: Payload;
  payloadBytes?: Uint8Array;
  random?: SealRandom;
}): { sealed: Sealed; contentKey: Uint8Array } {
  const context = { ...input.context, senderDeviceId: input.sender.deviceId };
  const head = header(context);
  const contentKey = input.random?.contentKey ?? randomBytes(32);
  const nonce = input.random?.nonce ?? randomBytes(12);
  const ephSecret = input.random?.ephSecret ?? randomBytes(32);
  const eph = x25519.getPublicKey(ephSecret);
  const plain = input.payloadBytes ?? utf8(JSON.stringify(input.payload));
  const body = chacha20poly1305(contentKey, nonce, head).encrypt(plain);
  const keys: Record<string, string> = {};
  for (const recipient of input.recipients) {
    const boxKey = fromBase64(recipient.boxKey, 32);
    const wrapKey = wrapKeyFor(ephSecret, boxKey, eph, boxKey);
    const aad = concatBytes(head, utf8(`\n${recipient.id}`));
    keys[recipient.id] = toBase64(chacha20poly1305(wrapKey, zeroNonce, aad).encrypt(contentKey));
  }
  const sig = ed25519.sign(signed(head, eph, nonce, body), input.sender.signSeed);
  return {
    sealed: {
      v: 1,
      device: input.sender.deviceId,
      eph: toBase64(eph),
      nonce: toBase64(nonce),
      body: toBase64(body),
      sig: toBase64(sig),
      keys,
    },
    contentKey,
  };
}

/** The content key of a sealed message, unwrapped with this device's key. Throws no_key when the
 *  message was not sealed for this device (it was sent before the device was added). */
export function unwrapKey(sealed: Sealed, context: MessageContext, me: DeviceSecrets): Uint8Array {
  const wrapped = sealed.keys?.[me.deviceId];
  if (!wrapped) throw new E2eeError("no_key");
  try {
    const eph = fromBase64(sealed.eph, 32);
    const wrapKey = wrapKeyFor(me.boxSecret, eph, eph, me.boxKey);
    const aad = concatBytes(header(context), utf8(`\n${me.deviceId}`));
    return chacha20poly1305(wrapKey, zeroNonce, aad).decrypt(fromBase64(wrapped, 48));
  } catch {
    throw new E2eeError("bad_message");
  }
}

/** Decrypts a sealed message with its content key and checks the author device's signature.
 *  The API uses this for a report, with the key the reporter sent. */
export function openWithKey(
  sealed: Sealed,
  context: MessageContext,
  contentKey: Uint8Array,
  authorSignKey: string,
): Payload {
  let plain: Uint8Array;
  try {
    if (sealed.v !== 1 || sealed.device !== context.senderDeviceId) throw new Error();
    const head = header(context);
    const eph = fromBase64(sealed.eph, 32);
    const nonce = fromBase64(sealed.nonce, 12);
    const body = fromBase64(sealed.body);
    const signKey = fromBase64(authorSignKey, 32);
    if (deviceIdOf(signKey) !== sealed.device) throw new Error();
    if (
      !ed25519.verify(fromBase64(sealed.sig, 64), signed(head, eph, nonce, body), signKey, { zip215: false })
    )
      throw new Error();
    plain = chacha20poly1305(contentKey, nonce, head).decrypt(body);
  } catch {
    throw new E2eeError("bad_message");
  }
  return parsePayload(plain);
}

/** A sealed message as this device reads it. `authorDevices` are the author's devices, active and
 *  removed (each already checked with verifyDevice). */
export function open(
  sealed: Sealed,
  input: { conversationId: string; messageId: string; authorId: string },
  me: DeviceSecrets,
  authorDevices: PublicDevice[],
): Payload {
  const context = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderUserId: input.authorId,
    senderDeviceId: sealed.device,
  };
  const author = authorDevices.find((d) => d.id === sealed.device);
  const contentKey = unwrapKey(sealed, context, me);
  if (!author) throw new E2eeError("bad_message");
  return openWithKey(sealed, context, contentKey, author.signKey);
}

function parsePayload(plain: Uint8Array): Payload {
  let value: unknown;
  try {
    value = JSON.parse(fromUtf8(plain));
  } catch {
    throw new E2eeError("bad_payload");
  }
  const p = value as Payload;
  if (!p || typeof p !== "object" || p.v !== 1) throw new E2eeError("bad_payload");
  if (p.text !== undefined && typeof p.text !== "string") throw new E2eeError("bad_payload");
  if (p.attachment !== undefined) {
    const a = p.attachment;
    if (
      !a ||
      typeof a.mediaId !== "string" ||
      !["image", "clip", "voice"].includes(a.kind) ||
      typeof a.key !== "string" ||
      typeof a.nonce !== "string" ||
      typeof a.type !== "string"
    )
      throw new E2eeError("bad_payload");
  }
  return p;
}

// --- attachments -----------------------------------------------------------------------------

export type FilePart = "file" | "poster";

/** A photo, clip, voice note or poster, encrypted with a key of its own before it is uploaded. */
export function sealFile(
  bytes: Uint8Array,
  part: FilePart,
  random?: { key: Uint8Array; nonce: Uint8Array },
): { ciphertext: Uint8Array; key: string; nonce: string } {
  const key = random?.key ?? randomBytes(32);
  const nonce = random?.nonce ?? randomBytes(12);
  const ciphertext = chacha20poly1305(key, nonce, utf8(`${tag}/${part}`)).encrypt(bytes);
  return { ciphertext, key: toBase64(key), nonce: toBase64(nonce) };
}

export function openFile(ciphertext: Uint8Array, part: FilePart, key: string, nonce: string): Uint8Array {
  try {
    return chacha20poly1305(fromBase64(key, 32), fromBase64(nonce, 12), utf8(`${tag}/${part}`)).decrypt(
      ciphertext,
    );
  } catch {
    throw new E2eeError("bad_message");
  }
}

// --- safety number ---------------------------------------------------------------------------

function personDigits(userId: string, signKeys: string[]) {
  const hex = signKeys.map((k) => bytesToHex(fromBase64(k, 32))).sort();
  const digest = sha256(utf8(`${tag}/safety\n${userId}\n${hex.join(",")}`));
  let digits = "";
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + (digest[i + j] as number);
    digits += String(n % 100000).padStart(5, "0");
  }
  return digits;
}

/** The 60 digits both people see, the smaller user ID's half first; null while either person has
 *  no device. `signKeys` are each person's active devices' signing keys (base64). */
export function safetyNumber(
  a: { userId: string; signKeys: string[] },
  b: { userId: string; signKeys: string[] },
): string | null {
  if (!a.signKeys.length || !b.signKeys.length) return null;
  const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
  return personDigits(first.userId, first.signKeys) + personDigits(second.userId, second.signKeys);
}

/** Twelve groups of five. */
export const safetyGroups = (digits: string) => digits.match(/.{5}/g) ?? [];

/** The content key as a report sends it. */
export const contentKeyText = (key: Uint8Array) => toBase64(key);
