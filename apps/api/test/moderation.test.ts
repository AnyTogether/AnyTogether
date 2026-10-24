import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const admin = (...args: string[]) => run(args, h.deps);

describe("reports", () => {
  it("reports a person once, and the moderators see and handle it", async () => {
    h = await harness();
    const utku = await h.user("utku@example.com");
    const troll = await h.user("troll@example.com");
    const report = (input: Record<string, unknown>) => h.call("POST", `${v1}/reports`, input, utku.token);
    const made = await report({
      targetKind: "user",
      targetId: troll.id,
      reason: "harassment",
      note: "Rude in chat",
    });
    expect(made.status).toBe(201);
    expect((await report({ targetKind: "user", targetId: troll.id, reason: "spam" })).status).toBe(200);
    expect((await report({ targetKind: "user", targetId: utku.id, reason: "spam" })).status).toBe(400);
    expect((await report({ targetKind: "user", targetId: "nobody", reason: "spam" })).status).toBe(404);
    expect((await report({ targetKind: "user", targetId: troll.id, reason: "boring" })).status).toBe(400);
    expect((await report({ targetKind: "activity", targetId: troll.id, reason: "spam" })).status).toBe(400);

    const listed = await admin("reports");
    expect(listed).toContain("harassment");
    expect(listed).toContain("@troll");
    expect(listed).toContain("by @utku");
    expect(listed).toContain("Rude in chat");
    const id = listed.split(/\s+/)[0] ?? "";
    expect(await admin("report", id, "dismiss")).toBe(`report ${id} dismissed`);
    expect(await admin("reports")).toBe("no open reports");
    expect(await admin("reports", "--all")).toContain("dismissed");
    // Handled, it can be reported again.
    expect((await report({ targetKind: "user", targetId: troll.id, reason: "spam" })).status).toBe(201);
  });
});

describe("bans", () => {
  it("ends every session, refuses sign-in, hides the profile, and unban undoes it", async () => {
    h = await harness();
    const troll = await h.user("troll@example.com");
    const ayse = await h.user("ayse@example.com");
    expect(await admin("ban", "@troll", "--reason", "spam")).toContain("banned @troll");
    expect((await h.call("GET", `${v1}/me`, undefined, troll.token)).body.code).toBe("session_revoked");
    expect((await h.call("GET", `${v1}/users/troll`, undefined, ayse.token)).status).toBe(404);
    expect((await h.call("GET", `${v1}/users/search?q=tro`, undefined, ayse.token)).body.users).toEqual([]);
    const again = await h.call("POST", `${v1}/auth/email/start`, { email: "troll@example.com" });
    expect(again.status).toBe(403);
    expect(again.body.code).toBe("account_banned");
    const google = await h.google.idToken(
      { sub: "g-troll", email: "troll@example.com", email_verified: true },
      "google-client",
    );
    expect((await h.call("POST", `${v1}/auth/oidc/google`, { idToken: google })).body.code).toBe(
      "account_banned",
    );
    expect(await admin("user", "troll@example.com")).toContain("status banned");

    expect(await admin("unban", "@troll")).toBe("lifted 1 ban(s) on @troll");
    expect((await h.call("GET", `${v1}/users/troll`, undefined, ayse.token)).status).toBe(200);
    const back = await h.user("troll@example.com");
    expect(back.id).toBe(troll.id);
  });

  it("bans an address that has no account yet, and a ban for some days runs out", async () => {
    h = await harness();
    expect(await admin("ban", "spammer@example.com")).toContain("banned spammer@example.com");
    expect((await h.call("POST", `${v1}/auth/email/start`, { email: "Spammer@Example.com" })).status).toBe(
      403,
    );
    const apple = await h.apple.idToken(
      { sub: "a-spam", email: "spammer@example.com", email_verified: "true" },
      "org.anyps5.launcher",
    );
    expect((await h.call("POST", `${v1}/auth/oidc/apple`, { idToken: apple })).status).toBe(403);

    const kid = await h.user("kid@example.com");
    expect(await admin("ban", "@kid", "--days", "3")).toMatch(/until 20/);
    expect((await h.call("POST", `${v1}/auth/email/start`, { email: "kid@example.com" })).status).toBe(403);
    // Three days later.
    await h.deps.db.execute(sql`update bans set expires_at = now() - interval '1 minute'`);
    const later = await h.user("kid@example.com");
    expect(later.id).toBe(kid.id);
    expect(await admin("user", "@kid")).toContain("status active");
  });
});

describe("rate limits", () => {
  it("limits sign-in attempts per address, apart from other addresses", async () => {
    h = await harness({ limits: { signIn: { max: 3, seconds: 900 } } });
    const start = (ip: string) =>
      h.app.request(`${v1}/auth/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ email: `${ip}@example.com` }),
      });
    for (let i = 0; i < 3; i++) expect((await start("203.0.113.7")).status).toBe(202);
    const refused = await start("203.0.113.7");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused.json()).code).toBe("rate_limited");
    expect((await start("198.51.100.1")).status).toBe(202);
  });

  it("limits every request per account and per address", async () => {
    h = await harness({ limits: { account: { max: 5, seconds: 60 } } });
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    for (let i = 0; i < 5; i++)
      expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).status).toBe(200);
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).status).toBe(429);
    expect((await h.call("GET", `${v1}/me`, undefined, ayse.token)).status).toBe(200);
    await h.close();

    h = await harness({ limits: { ip: { max: 4, seconds: 60 } } });
    for (let i = 0; i < 4; i++) await h.call("GET", `${v1}/games/PPSA01234`);
    expect((await h.call("GET", `${v1}/games/PPSA01234`)).status).toBe(429);
    expect((await h.call("GET", `${v1}/health`)).status).toBe(200);
  });

  it("limits friend requests per day", async () => {
    h = await harness({ limits: { friendRequest: { max: 2, seconds: 86_400 } } });
    const utku = await h.user("utku@example.com");
    for (const email of ["anna@example.com", "berk@example.com", "cem@example.com"]) await h.user(email);
    const ask = (handle: string) => h.call("POST", `${v1}/me/friends/requests`, { handle }, utku.token);
    expect((await ask("anna")).status).toBe(201);
    expect((await ask("berk")).status).toBe(201);
    expect((await ask("cem")).status).toBe(429);
  });
});
