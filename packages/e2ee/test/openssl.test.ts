import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vectorsPath } from "./makeVectors.js";

/** The vectors opened a second way, with Node's OpenSSL and none of noble, step by step as
 *  docs/e2ee.md says: what the other platforms do with their own libraries. */
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
const b64 = (text: string) => Buffer.from(text, "base64");
const x25519Private = (secret: Buffer) =>
  createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), secret]),
    format: "der",
    type: "pkcs8",
  });
const x25519Public = (key: Buffer) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), key]),
    format: "der",
    type: "spki",
  });
const ed25519Public = (key: Buffer) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]),
    format: "der",
    type: "spki",
  });
const aeadOpen = (key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer) => {
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAAD(aad, { plaintextLength: sealed.length - 16 });
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
};

describe("the vectors, opened with OpenSSL", () => {
  it("give the same device IDs, keys and signatures", () => {
    for (const d of Object.values(vectors.devices) as {
      userId: string;
      boxSecret: string;
      public: Record<string, string>;
    }[]) {
      const signKey = b64(d.public.signKey as string);
      expect(createHash("sha256").update(signKey).digest("hex").slice(0, 32)).toBe(d.public.id);
      const boxKey = createPublicKey(x25519Private(Buffer.from(d.boxSecret, "hex")))
        .export({ format: "der", type: "spki" })
        .subarray(12);
      expect(boxKey.toString("base64")).toBe(d.public.boxKey);
      const statement = Buffer.concat([Buffer.from(`AnyTogether-E2EE-v1/device\n${d.userId}\n`), boxKey]);
      expect(verify(null, statement, ed25519Public(signKey), b64(d.public.sig as string))).toBe(true);
    }
  });

  it("open every message on bob's Desktop", () => {
    const bob = vectors.devices.bobDesktop;
    for (const m of vectors.messages) {
      const author = (Object.values(vectors.devices) as { public: Record<string, string> }[]).find(
        (d) => d.public.id === m.sealed.device,
      );
      const head = Buffer.from(
        `AnyTogether-E2EE-v1/msg\n${vectors.conversationId}\n${m.messageId}\n${m.authorId}\n${m.sealed.device}`,
      );
      const eph = b64(m.sealed.eph);
      const shared = diffieHellman({
        privateKey: x25519Private(Buffer.from(bob.boxSecret, "hex")),
        publicKey: x25519Public(eph),
      });
      const boxKey = b64(bob.public.boxKey);
      const wrapKey = Buffer.from(
        hkdfSync("sha256", shared, Buffer.concat([eph, boxKey]), "AnyTogether-E2EE-v1/wrap", 32),
      );
      const contentKey = aeadOpen(
        wrapKey,
        Buffer.alloc(12),
        Buffer.concat([head, Buffer.from(`\n${bob.public.id}`)]),
        b64(m.sealed.keys[bob.public.id]),
      );
      expect(contentKey.toString("base64")).toBe(m.random.contentKey);
      const body = b64(m.sealed.body);
      const nonce = b64(m.sealed.nonce);
      expect(aeadOpen(contentKey, nonce, head, body).toString("utf8")).toBe(m.payload);
      const signedBytes = Buffer.concat([
        head,
        Buffer.from([0]),
        eph,
        nonce,
        createHash("sha256").update(body).digest(),
      ]);
      expect(
        verify(null, signedBytes, ed25519Public(b64(author?.public.signKey as string)), b64(m.sealed.sig)),
      ).toBe(true);
    }
    for (const f of vectors.files)
      expect(
        aeadOpen(
          b64(f.key),
          b64(f.nonce),
          Buffer.from(`AnyTogether-E2EE-v1/${f.part}`),
          b64(f.ciphertext),
        ).toString("base64"),
      ).toBe(f.plaintext);
  });

  it("give the same safety number", () => {
    const half = (userId: string, keys: string[]) => {
      const hex = keys.map((k) => b64(k).toString("hex")).sort();
      const digest = createHash("sha256")
        .update(`AnyTogether-E2EE-v1/safety\n${userId}\n${hex.join(",")}`)
        .digest();
      let out = "";
      for (let i = 0; i < 30; i += 5)
        out += String(Number(digest.readUIntBE(i, 5) % 100000)).padStart(5, "0");
      return out;
    };
    const { alice, bob } = vectors.users;
    const [first, second] =
      alice < bob
        ? [
            [alice, vectors.safetyNumber.alice],
            [bob, vectors.safetyNumber.bob],
          ]
        : [
            [bob, vectors.safetyNumber.bob],
            [alice, vectors.safetyNumber.alice],
          ];
    expect(half(first[0], first[1]) + half(second[0], second[1])).toBe(vectors.safetyNumber.digits);
  });
});
