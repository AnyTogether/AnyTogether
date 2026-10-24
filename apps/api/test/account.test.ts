import { accounts, auditLog, games, signInRequests, trophies } from "@anytogether/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purgeDeletedAccounts } from "../src/account.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

/** A game with one trophy that the user played and earned. */
async function playAndEarn(user: User) {
  await h.call("PUT", `${v1}/games/PPSA01234`, { names: { en: "Stray" } }, user.token);
  await h.call(
    "PUT",
    `${v1}/trophy-sets/PPSA01234/set1`,
    { trophies: [{ id: 0, grade: "bronze", texts: { en: { name: "Meow" } } }] },
    user.token,
  );
  await h.call(
    "POST",
    `${v1}/me/trophies`,
    {
      trophies: [{ titleId: "PPSA01234", setHash: "set1", trophyId: 0, earnedAt: new Date().toISOString() }],
    },
    user.token,
  );
}

async function confirmDeletion(user: User, email: string) {
  expect((await h.call("POST", `${v1}/me/deletion`, {}, user.token)).status).toBe(202);
  return h.call("DELETE", `${v1}/me`, { code: h.mailer.lastCode(email, "deletion") }, user.token);
}

describe("sessions", () => {
  it("signs out everywhere but here, then everywhere", async () => {
    const laptop = await h.user("utku@example.com");
    const phone = await h.user("utku@example.com");
    const desk = await h.user("utku@example.com");
    const others = await h.call("DELETE", `${v1}/auth/sessions?keep=current`, undefined, laptop.token);
    expect(others.body).toEqual({ signedOut: 2 });
    expect((await h.call("GET", `${v1}/me`, undefined, phone.token)).body.code).toBe("session_revoked");
    expect((await h.call("GET", `${v1}/me`, undefined, desk.token)).status).toBe(401);
    const left = await h.call("GET", `${v1}/auth/sessions`, undefined, laptop.token);
    expect(left.body.sessions).toHaveLength(1);
    expect(left.body.sessions[0].current).toBe(true);
    expect((await h.call("DELETE", `${v1}/auth/sessions`, undefined, laptop.token)).body).toEqual({
      signedOut: 1,
    });
    expect((await h.call("GET", `${v1}/me`, undefined, laptop.token)).status).toBe(401);
  });
});

describe("export", () => {
  it("downloads everything held about the account as one JSON file, and no secrets", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await playAndEarn(utku);
    const response = await h.app.request(`${v1}/me/export`, {
      headers: { authorization: `Bearer ${utku.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="anytogether-utku-.*\.json"/,
    );
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.account).toMatchObject({ id: utku.id, email: "utku@example.com", status: "active" });
    expect(data.profile).toMatchObject({ handle: "utku", privacy: { library: "friends" } });
    expect(data.signInMethods).toEqual([expect.objectContaining({ provider: "email" })]);
    expect(data.friends).toEqual([
      expect.objectContaining({ handle: "ayse", state: "accepted", askedByMe: true }),
    ]);
    expect(data.trophies).toEqual([expect.objectContaining({ titleId: "PPSA01234", trophyId: 0 })]);
    expect(data.gamesTaught).toEqual(["PPSA01234"]);
    expect(data.sessions.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/refreshHash|previousHash|codeHash|linkHash|secretHash/);
  });
});

describe("deleting the account", () => {
  it("asks for the mailed code, hides the account, signs it out, and signing in keeps it", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    expect((await h.call("DELETE", `${v1}/me`, { code: "123456" }, utku.token)).body.code).toBe(
      "code_expired",
    );
    await h.call("POST", `${v1}/me/deletion`, {}, utku.token);
    const right = h.mailer.lastCode("utku@example.com", "deletion");
    expect(right).toMatch(/^\d{6}$/);
    const wrong = right === "000000" ? "111111" : "000000";
    expect((await h.call("DELETE", `${v1}/me`, { code: wrong }, utku.token)).body.code).toBe("code_invalid");

    const asked = await h.call("DELETE", `${v1}/me`, { code: right }, utku.token);
    expect(asked.status).toBe(202);
    expect(Date.parse(asked.body.deleteAfter)).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).status).toBe(401);
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/me/friends`, undefined, ayse.token)).body.friends).toHaveLength(0);
    expect((await h.call("GET", `${v1}/users/search?q=utku`, undefined, ayse.token)).body.users).toHaveLength(
      0,
    );

    const back = await h.user("utku@example.com");
    expect(back.id).toBe(utku.id);
    const [row] = await h.deps.db.select().from(accounts).where(eq(accounts.id, utku.id));
    expect(row).toMatchObject({ status: "active", deleteAfter: null });
    expect((await h.call("GET", `${v1}/me/friends`, undefined, ayse.token)).body.friends).toHaveLength(1);
  });

  it("forgets the code after five wrong tries", async () => {
    const utku = await h.user("utku@example.com");
    await h.call("POST", `${v1}/me/deletion`, {}, utku.token);
    const right = h.mailer.lastCode("utku@example.com", "deletion");
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await h.call("DELETE", `${v1}/me`, { code: wrong }, utku.token);
    expect((await h.call("DELETE", `${v1}/me`, { code: right }, utku.token)).body.code).toBe("code_expired");
  });

  it("removes everything after 14 days and tidies what others see", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await befriend(utku, ayse);
    await playAndEarn(utku);
    await playAndEarn(ayse);
    expect((await confirmDeletion(utku, "utku@example.com")).status).toBe(202);

    expect(await purgeDeletedAccounts(h.deps)).toBe(0);
    expect(await purgeDeletedAccounts(h.deps, new Date(Date.now() + 15 * 86_400_000))).toBe(1);
    expect(await h.deps.db.select().from(accounts).where(eq(accounts.id, utku.id))).toEqual([]);
    expect(await h.valkey.smembers(`friends:${ayse.id}`)).toEqual([]);
    const [game] = await h.deps.db.select().from(games).where(eq(games.titleId, "PPSA01234"));
    expect(game?.taughtBy).toBeNull();
    const [trophy] = await h.deps.db.select().from(trophies).where(eq(trophies.titleId, "PPSA01234"));
    expect(trophy).toMatchObject({ earnedCount: 1, rarity: 1 });
    const logged = await h.deps.db.select().from(auditLog).where(eq(auditLog.target, utku.id));
    expect(logged.map((entry) => entry.action)).toContain("account.deleted");
    // The sign-in codes mailed to the address and the events kept for its sockets go too.
    expect(
      await h.deps.db.select().from(signInRequests).where(eq(signInRequests.email, "utku@example.com")),
    ).toEqual([]);
    expect(await h.valkey.exists(`events:${utku.id}`)).toBe(0);
    // The address can start again from nothing.
    const fresh = await h.user("utku@example.com");
    expect(fresh.id).not.toBe(utku.id);
  });

  it("drops sign-in requests a month after they expired", async () => {
    await h.call("POST", `${v1}/auth/email/start`, { email: "old@example.com" });
    await h.deps.db
      .update(signInRequests)
      .set({ expiresAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(signInRequests.email, "old@example.com"));
    await h.call("POST", `${v1}/auth/email/start`, { email: "new@example.com" });
    await purgeDeletedAccounts(h.deps);
    const left = await h.deps.db.select({ email: signInRequests.email }).from(signInRequests);
    expect(left.map((r) => r.email)).toEqual(["new@example.com"]);
  });

  it("confirms with the handle when the account has no email", async () => {
    const idToken = await h.apple.idToken({ sub: "apple-no-mail", name: "Kral" }, "org.anyps5.launcher");
    const signedIn = await h.call("POST", `${v1}/auth/oidc/apple`, { idToken });
    const token = signedIn.body.accessToken;
    expect((await h.call("POST", `${v1}/me/deletion`, {}, token)).body).toEqual({ confirmWith: "handle" });
    expect((await h.call("DELETE", `${v1}/me`, { handle: "someone" }, token)).status).toBe(400);
    expect(
      (await h.call("DELETE", `${v1}/me`, { handle: `@${signedIn.body.user.handle}` }, token)).status,
    ).toBe(202);
  });
});
