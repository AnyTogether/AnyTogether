import { writeFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { deviceFromSeeds, publicDevice, safetyNumber, seal, sealFile, toBase64 } from "../src/index.js";

/** The shared test vectors of protocol v1 (docs/e2ee.md): every client opens these messages and
 *  files and gets the same device IDs, signatures (Ed25519 is deterministic except in CryptoKit),
 *  ciphertexts and safety number. `pnpm --filter @anytogether/e2ee vectors` writes them again;
 *  the test checks the file still matches. */

const seed = (label: string) => sha256(utf8ToBytes(`AnyTogether-E2EE-v1 test vector ${label}`));
const hex = (bytes: Uint8Array) => bytesToHex(bytes);

export function makeVectors() {
  const alice = "0190f1a2-0000-7000-8000-00000000a11c";
  const bob = "0190f1a2-0000-7000-8000-000000000b0b";
  const conversationId = "0190f1a2-0000-7000-8000-0000000c0c0c";
  const devices = {
    aliceMac: deviceFromSeeds(seed("alice mac sign"), seed("alice mac box")),
    alicePhone: deviceFromSeeds(seed("alice phone sign"), seed("alice phone box")),
    bobDesktop: deviceFromSeeds(seed("bob desktop sign"), seed("bob desktop box")),
  };
  const owners = { aliceMac: alice, alicePhone: alice, bobDesktop: bob };
  const deviceVectors = Object.fromEntries(
    Object.entries(devices).map(([name, d]) => [
      name,
      {
        userId: owners[name as keyof typeof owners],
        signSeed: hex(d.signSeed),
        boxSecret: hex(d.boxSecret),
        public: publicDevice(d, owners[name as keyof typeof owners]),
      },
    ]),
  );
  const recipients = Object.values(deviceVectors).map((d) => ({ id: d.public.id, boxKey: d.public.boxKey }));

  const textPayload = '{"v":1,"text":"Merhaba Bob 👋 GG?"}';
  const textRandom = {
    contentKey: seed("text content key"),
    nonce: seed("text nonce").subarray(0, 12),
    ephSecret: seed("text eph"),
  };
  const text = seal({
    context: { conversationId, messageId: "0190f1a2-0000-7000-8000-000000000001", senderUserId: alice },
    sender: devices.aliceMac,
    recipients,
    payload: { v: 1 },
    payloadBytes: utf8ToBytes(textPayload),
    random: textRandom,
  });

  const fileBytes = utf8ToBytes("not really a picture, but 48 bytes of a file...");
  const fileRandom = { key: seed("file key"), nonce: seed("file nonce").subarray(0, 12) };
  const file = sealFile(fileBytes, "file", fileRandom);
  const posterBytes = utf8ToBytes("a poster");
  const posterRandom = { key: seed("poster key"), nonce: seed("poster nonce").subarray(0, 12) };
  const poster = sealFile(posterBytes, "poster", posterRandom);
  const mediaId = "0190f1a2-0000-7000-8000-00000000f11e";
  const attachmentPayload = JSON.stringify({
    v: 1,
    text: "a caption",
    attachment: {
      mediaId,
      kind: "clip",
      type: "video/mp4",
      size: fileBytes.length,
      key: file.key,
      nonce: file.nonce,
      width: 1280,
      height: 720,
      durationMs: 4200,
      poster: { key: poster.key, nonce: poster.nonce, type: "image/jpeg" },
    },
  });
  const attachmentRandom = {
    contentKey: seed("attachment content key"),
    nonce: seed("attachment nonce").subarray(0, 12),
    ephSecret: seed("attachment eph"),
  };
  const withAttachment = seal({
    context: { conversationId, messageId: "0190f1a2-0000-7000-8000-000000000002", senderUserId: bob },
    sender: devices.bobDesktop,
    recipients,
    payload: { v: 1 },
    payloadBytes: utf8ToBytes(attachmentPayload),
    random: attachmentRandom,
  });

  const signKeysOf = (user: string) =>
    Object.values(deviceVectors)
      .filter((d) => d.userId === user)
      .map((d) => d.public.signKey);

  return {
    about:
      "AnyTogether end-to-end encryption, protocol v1 (docs/e2ee.md). Binary values are base64 unless named *Hex. Made by packages/e2ee/test/makeVectors.ts.",
    // Known answers from the RFCs, so each platform checks its library does what the names say.
    rfc: {
      x25519: {
        source: "RFC 7748 section 6.1",
        aliceSecretHex: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
        alicePublicHex: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
        bobPublicHex: "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
        sharedHex: "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
      },
      ed25519: {
        source: "RFC 8032 section 7.1, test 1",
        seedHex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        publicHex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        messageHex: "",
        signatureHex:
          "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
      },
      chacha20poly1305: {
        source: "RFC 8439 section 2.8.2",
        keyHex: "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f",
        nonceHex: "070000004041424344454647",
        aadHex: "50515253c0c1c2c3c4c5c6c7",
        plaintext:
          "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
        ciphertextHex:
          "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116",
        tagHex: "1ae10b594f09e26a7e902ecbd0600691",
      },
    },
    users: { alice, bob },
    conversationId,
    devices: deviceVectors,
    messages: [
      {
        name: "text from alice's Mac",
        messageId: "0190f1a2-0000-7000-8000-000000000001",
        authorId: alice,
        payload: textPayload,
        random: {
          contentKey: toBase64(textRandom.contentKey),
          nonce: toBase64(textRandom.nonce),
          ephSecret: toBase64(textRandom.ephSecret),
        },
        sealed: text.sealed,
      },
      {
        name: "clip with a poster from bob's Desktop",
        messageId: "0190f1a2-0000-7000-8000-000000000002",
        authorId: bob,
        payload: attachmentPayload,
        random: {
          contentKey: toBase64(attachmentRandom.contentKey),
          nonce: toBase64(attachmentRandom.nonce),
          ephSecret: toBase64(attachmentRandom.ephSecret),
        },
        sealed: withAttachment.sealed,
      },
    ],
    files: [
      {
        part: "file",
        plaintext: toBase64(fileBytes),
        key: file.key,
        nonce: file.nonce,
        ciphertext: toBase64(file.ciphertext),
      },
      {
        part: "poster",
        plaintext: toBase64(posterBytes),
        key: poster.key,
        nonce: poster.nonce,
        ciphertext: toBase64(poster.ciphertext),
      },
    ],
    safetyNumber: {
      alice: signKeysOf(alice),
      bob: signKeysOf(bob),
      digits: safetyNumber(
        { userId: alice, signKeys: signKeysOf(alice) },
        { userId: bob, signKeys: signKeysOf(bob) },
      ),
    },
  };
}

export const vectorsPath = new URL("./e2ee-v1.json", import.meta.url);

if (process.argv[1]?.endsWith("makeVectors.ts")) {
  writeFileSync(vectorsPath, `${JSON.stringify(makeVectors(), null, 2)}\n`);
  console.log(`wrote ${vectorsPath.pathname}`);
}
