import { readFileSync } from "node:fs";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import {
  E2eeError,
  type Sealed,
  deviceFromSeeds,
  fromBase64,
  newDevice,
  open,
  openFile,
  openWithKey,
  publicDevice,
  safetyGroups,
  safetyNumber,
  seal,
  sealFile,
  toBase64,
  unwrapKey,
  verifyDevice,
} from "../src/index.js";
import { makeVectors, vectorsPath } from "./makeVectors.js";

const alice = "0190f1a2-0000-7000-8000-00000000a11c";
const bob = "0190f1a2-0000-7000-8000-000000000b0b";
const conversationId = "0190f1a2-0000-7000-8000-0000000c0c0c";
const messageId = "0190f1a2-0000-7000-8000-000000000001";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof E2eeError ? error.code : "other";
  }
  return "none";
};

describe("devices", () => {
  it("sign their X25519 key for their user, and nothing else verifies", () => {
    const device = newDevice();
    const record = publicDevice(device, alice);
    expect(record.id).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyDevice(alice, record)).toBe(true);
    expect(verifyDevice(bob, record)).toBe(false);
    expect(verifyDevice(alice, { ...record, id: "0".repeat(32) })).toBe(false);
    expect(verifyDevice(alice, { ...record, boxKey: publicDevice(newDevice(), alice).boxKey })).toBe(false);
    expect(verifyDevice(alice, { ...record, sig: "nope" })).toBe(false);
  });
});

describe("messages", () => {
  const mac = newDevice();
  const phone = newDevice();
  const desktop = newDevice();
  const later = newDevice();
  const devices = {
    mac: publicDevice(mac, alice),
    phone: publicDevice(phone, alice),
    desktop: publicDevice(desktop, bob),
  };
  const sent = seal({
    context: { conversationId, messageId, senderUserId: alice },
    sender: mac,
    recipients: Object.values(devices),
    payload: { v: 1, text: "GG 🔥" },
  });
  const meta = { conversationId, messageId, authorId: alice };

  it("open on every device they were sealed for, the sender's own included", () => {
    for (const device of [mac, phone, desktop])
      expect(open(sent.sealed, meta, device, [devices.mac, devices.phone])).toEqual({ v: 1, text: "GG 🔥" });
  });

  it("say so on a device added later, which has no key for them", () => {
    expect(code(() => open(sent.sealed, meta, later, [devices.mac]))).toBe("no_key");
  });

  it("refuse anything moved or changed", () => {
    const changed = (sealed: Partial<Sealed>) => ({ ...sent.sealed, ...sealed });
    const flip = (b64: string) => {
      const bytes = fromBase64(b64);
      bytes[0] = (bytes[0] as number) ^ 1;
      return toBase64(bytes);
    };
    const authors = [devices.mac];
    expect(code(() => open(changed({ body: flip(sent.sealed.body) }), meta, desktop, authors))).toBe(
      "bad_message",
    );
    expect(code(() => open(changed({ sig: flip(sent.sealed.sig) }), meta, desktop, authors))).toBe(
      "bad_message",
    );
    expect(code(() => open(changed({ nonce: flip(sent.sealed.nonce) }), meta, desktop, authors))).toBe(
      "bad_message",
    );
    // Another conversation, another message ID or another author: the header no longer matches.
    expect(code(() => open(sent.sealed, { ...meta, conversationId: messageId }, desktop, authors))).toBe(
      "bad_message",
    );
    expect(code(() => open(sent.sealed, { ...meta, messageId: conversationId }, desktop, authors))).toBe(
      "bad_message",
    );
    expect(code(() => open(sent.sealed, { ...meta, authorId: bob }, desktop, authors))).toBe("bad_message");
    // Signed by a device that is not the author's.
    expect(code(() => open(sent.sealed, meta, desktop, [devices.desktop]))).toBe("bad_message");
    // A key wrapped for one device does not open for another.
    const swapped = changed({
      keys: { ...sent.sealed.keys, [desktop.deviceId]: sent.sealed.keys[phone.deviceId] as string },
    });
    expect(code(() => open(swapped, meta, desktop, authors))).toBe("bad_message");
  });

  it("open with the content key alone, as a report does, and only for their author", () => {
    const context = { conversationId, messageId, senderUserId: alice, senderDeviceId: mac.deviceId };
    const key = unwrapKey(sent.sealed, context, desktop);
    expect(bytesToHex(key)).toBe(bytesToHex(sent.contentKey));
    expect(openWithKey(sent.sealed, context, key, devices.mac.signKey).text).toBe("GG 🔥");
    expect(code(() => openWithKey(sent.sealed, context, new Uint8Array(32), devices.mac.signKey))).toBe(
      "bad_message",
    );
    expect(code(() => openWithKey(sent.sealed, context, key, devices.phone.signKey))).toBe("bad_message");
  });
});

describe("files", () => {
  it("open with their key and nonce, and only as the part they were sealed as", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const sealed = sealFile(bytes, "file");
    expect(sealed.ciphertext.length).toBe(bytes.length + 16);
    expect(openFile(sealed.ciphertext, "file", sealed.key, sealed.nonce)).toEqual(bytes);
    expect(code(() => openFile(sealed.ciphertext, "poster", sealed.key, sealed.nonce))).toBe("bad_message");
  });
});

describe("safety numbers", () => {
  const a = {
    userId: alice,
    signKeys: [publicDevice(newDevice(), alice).signKey, publicDevice(newDevice(), alice).signKey],
  };
  const b = { userId: bob, signKeys: [publicDevice(newDevice(), bob).signKey] };

  it("are the same 60 digits on both sides, whatever the order of the devices", () => {
    const number = safetyNumber(a, b) as string;
    expect(number).toMatch(/^\d{60}$/);
    expect(safetyNumber(b, a)).toBe(number);
    expect(safetyNumber({ ...a, signKeys: [...a.signKeys].reverse() }, b)).toBe(number);
    expect(safetyGroups(number)).toHaveLength(12);
  });

  it("change when a device comes or goes, and are not there without devices", () => {
    const number = safetyNumber(a, b);
    expect(safetyNumber({ ...a, signKeys: a.signKeys.slice(1) }, b)).not.toBe(number);
    expect(safetyNumber(a, { ...b, signKeys: [] })).toBeNull();
  });
});

describe("the shared vectors", () => {
  const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));

  it("are what this implementation makes today", () => {
    expect(vectors).toEqual(JSON.parse(JSON.stringify(makeVectors())));
  });

  it("hold the RFC answers for noble", () => {
    const { x25519: x, ed25519: e, chacha20poly1305: c } = vectors.rfc;
    expect(bytesToHex(x25519.getPublicKey(hexToBytes(x.aliceSecretHex)))).toBe(x.alicePublicHex);
    expect(bytesToHex(x25519.getSharedSecret(hexToBytes(x.aliceSecretHex), hexToBytes(x.bobPublicHex)))).toBe(
      x.sharedHex,
    );
    expect(bytesToHex(ed25519.getPublicKey(hexToBytes(e.seedHex)))).toBe(e.publicHex);
    expect(bytesToHex(ed25519.sign(hexToBytes(e.messageHex), hexToBytes(e.seedHex)))).toBe(e.signatureHex);
    const sealed = chacha20poly1305(
      hexToBytes(c.keyHex),
      hexToBytes(c.nonceHex),
      hexToBytes(c.aadHex),
    ).encrypt(utf8ToBytes(c.plaintext));
    expect(bytesToHex(sealed)).toBe(c.ciphertextHex + c.tagHex);
  });

  it("open on each device and verify", () => {
    const secrets = Object.fromEntries(
      Object.entries(vectors.devices).map(([name, d]) => {
        const v = d as { userId: string; signSeed: string; boxSecret: string; public: never };
        expect(verifyDevice(v.userId, v.public)).toBe(true);
        return [name, deviceFromSeeds(hexToBytes(v.signSeed), hexToBytes(v.boxSecret))];
      }),
    );
    const devicesOf = (user: string) =>
      Object.values(vectors.devices)
        .filter((d) => (d as { userId: string }).userId === user)
        .map((d) => (d as { public: never }).public);
    for (const message of vectors.messages)
      for (const device of Object.values(secrets)) {
        const payload = open(
          message.sealed,
          { conversationId: vectors.conversationId, ...message },
          device,
          devicesOf(message.authorId),
        );
        expect(payload).toEqual(JSON.parse(message.payload));
      }
    for (const file of vectors.files)
      expect(toBase64(openFile(fromBase64(file.ciphertext), file.part, file.key, file.nonce))).toBe(
        file.plaintext,
      );
    expect(
      safetyNumber(
        { userId: vectors.users.alice, signKeys: vectors.safetyNumber.alice },
        { userId: vectors.users.bob, signKeys: vectors.safetyNumber.bob },
      ),
    ).toBe(vectors.safetyNumber.digits);
  });
});
