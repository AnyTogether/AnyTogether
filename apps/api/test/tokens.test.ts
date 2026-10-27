import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTokenSigner } from "../src/tokens.js";

const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const oldUrl = "https://old.anytogether.test";
const newUrl = "https://anytogether.test";
const claims = { userId: "u1", sessionId: "s1" };

describe("issuers after a domain move", () => {
  it("accepts tokens signed under a previous issuer only when it is listed", async () => {
    const before = await createTokenSigner(pem, oldUrl);
    const access = await before.sign(claims);
    const document = await before.signDocument("anytogether-license", "u1", { ok: true }, 1);
    const appeal = await before.signAppeal("u1");

    const moved = await createTokenSigner(pem, newUrl, [oldUrl]);
    expect(await moved.verify(access)).toEqual(claims);
    expect((await moved.verifyDocument(document, "anytogether-license")).ok).toBe(true);
    expect(await moved.verifyAppeal(appeal)).toBe("u1");

    const unlisted = await createTokenSigner(pem, newUrl);
    await expect(unlisted.verify(access)).rejects.toThrow();
    await expect(unlisted.verifyDocument(document, "anytogether-license")).rejects.toThrow();
    await expect(unlisted.verifyAppeal(appeal)).rejects.toThrow();
  });

  it("signs under the current issuer", async () => {
    const moved = await createTokenSigner(pem, newUrl, [oldUrl]);
    const token = await moved.sign(claims);
    expect(await (await createTokenSigner(pem, newUrl)).verify(token)).toEqual(claims);
    await expect((await createTokenSigner(pem, oldUrl)).verify(token)).rejects.toThrow();
  });
});
