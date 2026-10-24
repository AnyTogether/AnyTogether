import { accounts, auditLog, passkeys } from "@anytogether/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { softAuthenticator } from "./authenticator.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const origin = "https://anytogether.test";
type User = Awaited<ReturnType<typeof h.user>>;
type Authenticator = ReturnType<typeof softAuthenticator>;

/** Adds a passkey to the account the way Settings does: options, the authenticator, the answer. */
async function addPasskey(user: User, name = "MacBook", key = softAuthenticator({ origin })) {
  const options = await h.call("POST", `${v1}/auth/passkeys/start`, {}, user.token);
  expect(options.status).toBe(200);
  const added = await h.call(
    "POST",
    `${v1}/auth/passkeys`,
    { name, response: key.create(options.body) },
    user.token,
  );
  return { key, added };
}

/** Signs in with the passkey alone: no email, no handle. */
async function passkeySignIn(key: Authenticator, tamper: { origin?: string; handle?: string } = {}) {
  const started = await h.call("POST", `${v1}/auth/passkey/start`, {});
  expect(started.status).toBe(200);
  const response = tamper.handle
    ? key.get(started.body.options, tamper.origin, tamper.handle)
    : key.get(started.body.options, tamper.origin);
  return h.call("POST", `${v1}/auth/passkey/finish`, {
    challengeId: started.body.challengeId,
    response,
    deviceName: "Firefox",
  });
}

describe("passkeys", () => {
  it("adds a passkey in settings and signs in with it, no email asked", async () => {
    const utku = await h.user("utku@example.com");
    const { key, added } = await addPasskey(utku, "MacBook", softAuthenticator({ origin, synced: true }));
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ id: key.id, name: "MacBook", backedUp: true, lastUsedAt: null });

    const options = await h.call("POST", `${v1}/auth/passkeys/start`, {}, utku.token);
    // A discoverable key on this site, verification preferred, the account's own key excluded.
    expect(options.body.rp).toEqual({ id: "anytogether.test", name: "AnyTogether" });
    expect(options.body.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "preferred",
    });
    expect(options.body.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([key.id]);
    expect(options.body.user.name).toBe("utku");

    const signedIn = await passkeySignIn(key);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: utku.id, handle: "utku", created: false });
    const me = await h.call("GET", `${v1}/me`, undefined, signedIn.body.accessToken);
    expect(me.body.account.id).toBe(utku.id);
    const sessions = await h.call("GET", `${v1}/auth/sessions`, undefined, signedIn.body.accessToken);
    expect(sessions.body.sessions.some((s: { deviceName: string }) => s.deviceName === "Firefox")).toBe(true);

    const listed = await h.call("GET", `${v1}/auth/passkeys`, undefined, utku.token);
    expect(listed.body.max).toBe(10);
    expect(listed.body.passkeys).toHaveLength(1);
    expect(listed.body.passkeys[0].lastUsedAt).not.toBeNull();
    // It shows in "Download my data" too, without the key itself.
    const exported = await h.call("GET", `${v1}/me/export`, undefined, utku.token);
    expect(exported.body.passkeys).toEqual([expect.objectContaining({ name: "MacBook" })]);
    expect(JSON.stringify(exported.body.passkeys)).not.toContain("publicKey");
  });

  it("uses each challenge once, and only while it lasts", async () => {
    const utku = await h.user("utku@example.com");
    const { key } = await addPasskey(utku);
    const started = await h.call("POST", `${v1}/auth/passkey/start`, {});
    const answer = { challengeId: started.body.challengeId, response: key.get(started.body.options) };
    expect((await h.call("POST", `${v1}/auth/passkey/finish`, answer)).status).toBe(200);
    const replayed = await h.call("POST", `${v1}/auth/passkey/finish`, answer);
    expect(replayed.status).toBe(400);
    expect(replayed.body.code).toBe("challenge_expired");

    // Gone from Valkey (its five minutes are over): refused the same way.
    const late = await h.call("POST", `${v1}/auth/passkey/start`, {});
    await h.valkey.del(`passkey:signin:${late.body.challengeId}`);
    const tooLate = await h.call("POST", `${v1}/auth/passkey/finish`, {
      challengeId: late.body.challengeId,
      response: key.get(late.body.options),
    });
    expect(tooLate.body.code).toBe("challenge_expired");
    const fresh = await h.call("POST", `${v1}/auth/passkey/start`, {});
    const ttl = await h.valkey.ttl(`passkey:signin:${fresh.body.challengeId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    // Adding: the registration challenge is single use as well.
    const options = await h.call("POST", `${v1}/auth/passkeys/start`, {}, utku.token);
    const second = softAuthenticator({ origin });
    const response = second.create(options.body);
    expect((await h.call("POST", `${v1}/auth/passkeys`, { name: "a", response }, utku.token)).status).toBe(
      201,
    );
    const again = await h.call("POST", `${v1}/auth/passkeys`, { name: "b", response }, utku.token);
    expect(again.body.code).toBe("challenge_expired");
  });

  it("refuses another site's answer, an unknown key, a wrong account and a counter that went back", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const { key } = await addPasskey(utku);

    const phished = await passkeySignIn(key, { origin: "https://anytogether.evil" });
    expect(phished.status).toBe(400);
    expect(phished.body.code).toBe("passkey_invalid");
    expect((await passkeySignIn(softAuthenticator({ origin }))).body.code).toBe("passkey_invalid");
    const otherAccount = Buffer.from(ayse.id.replace(/-/g, ""), "hex").toString("base64url");
    expect((await passkeySignIn(key, { handle: otherAccount })).body.code).toBe("passkey_invalid");

    // Made for another site (another RP ID): not accepted when added.
    const options = await h.call("POST", `${v1}/auth/passkeys/start`, {}, utku.token);
    const foreign = softAuthenticator({ origin, rpId: "example.com" });
    const wrongRp = await h.call(
      "POST",
      `${v1}/auth/passkeys`,
      { name: "x", response: foreign.create(options.body) },
      utku.token,
    );
    expect(wrongRp.body.code).toBe("passkey_invalid");

    // A counting authenticator: 5, then 3 is a clone.
    key.setCounter(5);
    expect((await passkeySignIn(key)).status).toBe(200);
    const [row] = await h.deps.db.select().from(passkeys).where(eq(passkeys.id, key.id));
    expect(row?.counter).toBe(5);
    key.setCounter(3);
    expect((await passkeySignIn(key)).body.code).toBe("passkey_invalid");
  });

  it("keeps at most ten, lists and removes them, each only by its owner", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const keys: Authenticator[] = [];
    for (let i = 0; i < 10; i++) {
      const { key, added } = await addPasskey(utku, `key ${i}`);
      expect(added.status).toBe(201);
      keys.push(key);
    }
    const eleventh = await h.call("POST", `${v1}/auth/passkeys/start`, {}, utku.token);
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.code).toBe("full");

    const first = keys[0] as Authenticator;
    const path = `${v1}/auth/passkeys/${first.id}`;
    expect((await h.call("DELETE", path, undefined, ayse.token)).status).toBe(404);
    expect((await h.call("DELETE", path, undefined, utku.token)).status).toBe(204);
    expect((await h.call("DELETE", path, undefined, utku.token)).status).toBe(404);
    expect((await passkeySignIn(first)).body.code).toBe("passkey_invalid");
    expect((await passkeySignIn(keys[1] as Authenticator)).status).toBe(200);
    const listed = await h.call("GET", `${v1}/auth/passkeys`, undefined, utku.token);
    expect(listed.body.passkeys.map((p: { name: string }) => p.name)).toEqual(
      Array.from({ length: 9 }, (_, i) => `key ${i + 1}`),
    );
    const actions = await h.deps.db.select().from(auditLog).where(eq(auditLog.actorId, utku.id));
    expect(actions.filter((a) => a.action === "passkey.removed")).toHaveLength(1);

    // Names are needed and short.
    const options = await h.call("POST", `${v1}/auth/passkeys/start`, {}, utku.token);
    const unnamed = await h.call(
      "POST",
      `${v1}/auth/passkeys`,
      { name: " ", response: softAuthenticator({ origin }).create(options.body) },
      utku.token,
    );
    expect(unnamed.status).toBe(400);
    expect((await h.call("GET", `${v1}/auth/passkeys`)).status).toBe(401);
  });

  it("refuses a banned account, and signing in keeps an account waiting to be deleted", async () => {
    const troll = await h.user("troll@example.com");
    const { key } = await addPasskey(troll);
    expect(await run(["ban", "@troll", "--reason", "spam"], h.deps)).toContain("banned @troll");
    const banned = await passkeySignIn(key);
    expect(banned.status).toBe(403);
    expect(banned.body.code).toBe("account_banned");
    await run(["unban", "@troll"], h.deps);

    await h.deps.db
      .update(accounts)
      .set({ status: "deleting", deleteAfter: new Date(Date.now() + 86_400_000) })
      .where(eq(accounts.id, troll.id));
    expect((await passkeySignIn(key)).status).toBe(200);
    const [account] = await h.deps.db.select().from(accounts).where(eq(accounts.id, troll.id));
    expect(account?.status).toBe("active");
  });

  it("counts passkey sign-ins against the sign-in limit", async () => {
    await h.close();
    h = await harness({ limits: { signIn: { max: 2, seconds: 900 } } });
    const key = softAuthenticator({ origin });
    for (let i = 0; i < 2; i++) expect((await passkeySignIn(key)).status).toBe(400);
    const limited = await passkeySignIn(key);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
