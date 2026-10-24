import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("profile", () => {
  it("changes the name, bio and country, and clears them with null", async () => {
    const utku = await h.user("utku@example.com");
    const changed = await h.call(
      "PATCH",
      `${v1}/me/profile`,
      { displayName: "  Utku ‮Halis  ", bio: "Platinum\n\n\n\nhunter", country: "tr" },
      utku.token,
    );
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      displayName: "Utku Halis",
      bio: "Platinum\n\nhunter",
      country: "TR",
    });
    const me = await h.call("GET", `${v1}/me`, undefined, utku.token);
    expect(me.body.profile).toMatchObject({ displayName: "Utku Halis", country: "TR", handleChangeAt: null });

    const cleared = await h.call("PATCH", `${v1}/me/profile`, { bio: null, country: null }, utku.token);
    expect(cleared.body).toMatchObject({ displayName: "Utku Halis", bio: null, country: null });
    expect((await h.call("PATCH", `${v1}/me/profile`, { bio: "" }, utku.token)).body.bio).toBeNull();
  });

  it("refuses links, long bios, empty names and unknown countries", async () => {
    const utku = await h.user("utku@example.com");
    const patch = (input: unknown) => h.call("PATCH", `${v1}/me/profile`, input, utku.token);
    for (const bio of [
      "see https://x.io",
      "free games at www.example",
      "join discord.gg/abc",
      "pkg-site [.] com",
    ]) {
      const refused = await patch({ bio });
      expect(refused.status, bio).toBe(400);
      expect(refused.body.code).toBe("links_not_allowed");
    }
    expect((await patch({ displayName: "games-free.net" })).body.code).toBe("links_not_allowed");
    expect((await patch({ bio: "x".repeat(161) })).status).toBe(400);
    expect((await patch({ displayName: "   " })).status).toBe(400);
    expect((await patch({ country: "XX" })).status).toBe(400);
    expect((await patch({ bio: "Version 1.5 fan. Come with me. To the top, e.g. souls" })).status).toBe(200);
  });
});

describe("handles", () => {
  it("changes once, then waits 30 days, and the old one still leads to the profile", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const changed = await h.call("PATCH", `${v1}/me/handle`, { handle: "@Kral.Utku" }, utku.token);
    expect(changed.status).toBe(200);
    expect(changed.body.handle).toBe("kral.utku");
    expect(Date.parse(changed.body.handleChangeAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const again = await h.call("PATCH", `${v1}/me/handle`, { handle: "utku2" }, utku.token);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("handle_cooldown");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(29 * 86_400);
    // The same handle again changes nothing and is no error.
    expect((await h.call("PATCH", `${v1}/me/handle`, { handle: "kral.utku" }, utku.token)).status).toBe(200);

    const old = await h.call("GET", `${v1}/users/utku`, undefined, ayse.token);
    expect(old.status).toBe(200);
    expect(old.body.handle).toBe("kral.utku");
    const taken = await h.call("PATCH", `${v1}/me/handle`, { handle: "utku" }, ayse.token);
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("handle_taken");
  });

  it("frees the old handle and allows a change after 30 days", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    await h.call("PATCH", `${v1}/me/handle`, { handle: "kral" }, utku.token);
    await h.deps.db.execute(
      sql`update profiles set handle_changed_at = ${daysAgo(31)} where handle = 'kral'`,
    );
    await h.deps.db.execute(sql`update handle_history set released_at = ${daysAgo(31)}`);
    expect((await h.call("GET", `${v1}/users/utku`, undefined, ayse.token)).status).toBe(404);
    expect((await h.call("PATCH", `${v1}/me/handle`, { handle: "utku" }, ayse.token)).status).toBe(200);
    expect((await h.call("PATCH", `${v1}/me/handle`, { handle: "kral2" }, utku.token)).status).toBe(200);
  });

  it("takes back one's own old handle", async () => {
    const utku = await h.user("utku@example.com");
    await h.call("PATCH", `${v1}/me/handle`, { handle: "kral" }, utku.token);
    await h.deps.db.execute(sql`update profiles set handle_changed_at = ${daysAgo(31)}`);
    const back = await h.call("PATCH", `${v1}/me/handle`, { handle: "utku" }, utku.token);
    expect(back.status).toBe(200);
    expect(back.body.handle).toBe("utku");
  });

  it("refuses bad, reserved and taken handles", async () => {
    const utku = await h.user("utku@example.com");
    await h.user("ayse@example.com");
    const change = (handle: string) => h.call("PATCH", `${v1}/me/handle`, { handle }, utku.token);
    for (const bad of ["ab", "a".repeat(21), "has space", "ümit", ".dot", "dot.", "two..dots", "dash-ed"])
      expect((await change(bad)).status, bad).toBe(400);
    for (const reserved of ["admin", "Admin_2", "anytogether.team", "support", "mod"]) {
      const refused = await change(reserved);
      expect(refused.body.code, reserved).toBe("handle_reserved");
    }
    expect((await change("AYSE")).body.code).toBe("handle_taken");
    expect((await h.call("GET", `${v1}/me`, undefined, utku.token)).body.profile.handle).toBe("utku");
  });

  it("never makes a reserved handle for a new account", async () => {
    const idToken = await h.apple.idToken(
      { sub: "a-9", email: "boss@example.com", email_verified: "true", name: "Admin" },
      "org.anyps5.launcher",
    );
    const apple = await h.call("POST", `${v1}/auth/oidc/apple`, { idToken });
    expect(apple.body.user.handle).toBe("player");
  });
});
