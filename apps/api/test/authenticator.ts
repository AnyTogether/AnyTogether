import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
};

/** A software passkey for the tests: one P-256 key, made and used the way a platform
 *  authenticator does (attestation "none", user present and verified, backed up if asked). */
export function softAuthenticator(options: { origin: string; rpId?: string; synced?: boolean }) {
  const rpId = options.rpId ?? new URL(options.origin).hostname;
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(32);
  // UP | UV, plus BE | BS for a synced key.
  const flags = 0x01 | 0x04 | (options.synced ? 0x08 | 0x10 : 0);
  let userHandle: string | undefined;
  let counter = 0;

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id: b64(credentialId),
    /** The next assertion uses this counter (a cloned key would go backwards). */
    setCounter: (value: number) => {
      counter = value;
    },
    /** navigator.credentials.create() with the server's options, as the browser's JSON. */
    create(creation: { challenge: string; user: { id: string } }, origin = options.origin) {
      userHandle = creation.user.id;
      const cose = new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? "", "base64url")],
        [-3, Buffer.from(jwk.y ?? "", "base64url")],
      ]);
      const credentialIdLength = Buffer.alloc(2);
      credentialIdLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([flags | 0x40]),
        u32(counter),
        Buffer.alloc(16),
        credentialIdLength,
        credentialId,
        Buffer.from(isoCBOR.encode(cose)),
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ["fmt", "none"],
          ["attStmt", new Map<string, string>()],
          ["authData", authData],
        ]),
      );
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64(clientData("webauthn.create", creation.challenge, origin)),
          attestationObject: b64(attestationObject),
          transports: ["internal", "hybrid"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    /** navigator.credentials.get() with no allow list: the discoverable key answers by itself. */
    get(request: { challenge: string }, origin = options.origin, handle = userHandle) {
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags]), u32(counter)]);
      const clientDataJSON = clientData("webauthn.get", request.challenge, origin);
      const signature = sign(
        "sha256",
        Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
        privateKey,
      );
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64(clientDataJSON),
          authenticatorData: b64(authenticatorData),
          signature: b64(signature),
          ...(handle ? { userHandle: handle } : {}),
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}
