import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

async function emailSignIn(email = "utku@example.com", client?: string) {
  expect((await h.call("POST", "/api/v1/auth/email/start", { email })).status).toBe(202);
  const code = h.mailer.lastCode(email);
  return h.call("POST", "/api/v1/auth/email/verify", { email, code }, undefined, client);
}

describe("email codes", () => {
  it("signs in with the code from the mail, making the account the first time", async () => {
    const first = await emailSignIn();
    expect(first.status).toBe(200);
    expect(first.body.user.created).toBe(true);
    expect(first.body.user.handle).toBe("utku");
    expect(first.body.accessToken).toBeTruthy();
    const again = await emailSignIn();
    expect(again.body.user.created).toBe(false);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it("makes many new accounts at once without running out of database connections", async () => {
    // More at once than the test pool has connections (4): each sign-up holds one for its
    // transaction and must not need a second.
    const emails = Array.from({ length: 8 }, (_, i) => `new${i}@example.com`);
    await Promise.all(emails.map((email) => h.call("POST", "/api/v1/auth/email/start", { email })));
    const signedIn = await Promise.all(
      emails.map((email) =>
        h.call("POST", "/api/v1/auth/email/verify", { email, code: h.mailer.lastCode(email) }),
      ),
    );
    expect(signedIn.map((r) => r.status)).toEqual(emails.map(() => 200));
  });

  it("refuses a wrong code and locks after ten", async () => {
    await h.call("POST", "/api/v1/auth/email/start", { email: "a@example.com" });
    const right = h.mailer.lastCode("a@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    const once = await h.call("POST", "/api/v1/auth/email/verify", { email: "a@example.com", code: wrong });
    expect(once.status).toBe(400);
    expect(once.body.code).toBe("code_invalid");
    for (let i = 0; i < 9; i++)
      await h.call("POST", "/api/v1/auth/email/verify", { email: "a@example.com", code: wrong });
    const locked = await h.call("POST", "/api/v1/auth/email/verify", { email: "a@example.com", code: right });
    expect(locked.body.code).toBe("code_locked");
  });

  it("counts wrong codes sent at once: never more than ten tries for one code", async () => {
    await h.close();
    h = await harness({ limits: { signIn: { max: 1000, seconds: 900 } } });
    await h.call("POST", "/api/v1/auth/email/start", { email: "race@example.com" });
    const right = h.mailer.lastCode("race@example.com");
    const wrongs = Array.from({ length: 40 }, (_, i) =>
      String((Number(right) + 1 + i) % 1_000_000).padStart(6, "0"),
    );
    const answers = await Promise.all(
      wrongs.map((code) => h.call("POST", "/api/v1/auth/email/verify", { email: "race@example.com", code })),
    );
    expect(answers.filter((a) => a.body.code === "code_invalid").length).toBeLessThanOrEqual(10);
    const locked = await h.call("POST", "/api/v1/auth/email/verify", {
      email: "race@example.com",
      code: right,
    });
    expect(locked.body.code).toBe("code_locked");
  });

  it("stops trying codes for an address after thirty wrong ones in a day, whatever new codes come", async () => {
    await h.close();
    h = await harness({ limits: { signIn: { max: 1000, seconds: 900 } } });
    const email = "target@example.com";
    for (let round = 0; round < 3; round++) {
      await h.call("POST", "/api/v1/auth/email/start", { email });
      const right = h.mailer.lastCode(email);
      const wrong = right === "000000" ? "111111" : "000000";
      for (let i = 0; i < 10; i++) await h.call("POST", "/api/v1/auth/email/verify", { email, code: wrong });
    }
    await h.call("POST", "/api/v1/auth/email/start", { email });
    const later = await h.call("POST", "/api/v1/auth/email/verify", {
      email,
      code: h.mailer.lastCode(email),
    });
    expect(later.status).toBe(400);
    expect(later.body.code).toBe("code_locked");
    // Another address is not held up.
    expect((await emailSignIn("other@example.com")).status).toBe(200);
  });

  it("signs in with the mail's link too", async () => {
    await h.call("POST", "/api/v1/auth/email/start", { email: "b@example.com" });
    const link = h.mailer.lastLink("b@example.com");
    const done = await h.call("POST", "/api/v1/auth/email/verify", { email: "b@example.com", link });
    expect(done.status).toBe(200);
  });

  it("sends at most five codes an hour to one address", async () => {
    for (let i = 0; i < 5; i++)
      expect((await h.call("POST", "/api/v1/auth/email/start", { email: "c@example.com" })).status).toBe(202);
    const sixth = await h.call("POST", "/api/v1/auth/email/start", { email: "c@example.com" });
    expect(sixth.status).toBe(429);
  });
});

describe("tokens and sessions", () => {
  it("answers /me with the access token", async () => {
    const signedIn = await emailSignIn();
    const me = await h.call("GET", "/api/v1/me", undefined, signedIn.body.accessToken);
    expect(me.status).toBe(200);
    expect(me.body.profile.handle).toBe("utku");
    expect(me.body.account.email).toBe("utku@example.com");
    expect((await h.call("GET", "/api/v1/me")).status).toBe(401);
  });

  it("rotates the refresh token, and a reused one ends the session", async () => {
    const signedIn = await emailSignIn();
    const first = signedIn.body.refreshToken;
    const turned = await h.call("POST", "/api/v1/auth/token", {
      grantType: "refresh_token",
      refreshToken: first,
    });
    expect(turned.status).toBe(200);
    expect(turned.body.refreshToken).not.toBe(first);
    const reused = await h.call("POST", "/api/v1/auth/token", {
      grantType: "refresh_token",
      refreshToken: first,
    });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe("refresh_reused");
    const after = await h.call("POST", "/api/v1/auth/token", {
      grantType: "refresh_token",
      refreshToken: turned.body.refreshToken,
    });
    expect(after.status).toBe(401);
    expect((await h.call("GET", "/api/v1/me", undefined, turned.body.accessToken)).status).toBe(401);
  });

  it("lists sessions, signs one out, and tells its sockets", async () => {
    const mac = await emailSignIn("d@example.com", "launcher-macos/0.2.13");
    const web = await emailSignIn("d@example.com", "web/1.0");
    const list = await h.call("GET", "/api/v1/auth/sessions", undefined, web.body.accessToken);
    expect(list.body.sessions).toHaveLength(2);
    const macSession = list.body.sessions.find((s: { client: string }) => s.client === "launcher-macos");
    const events = await h.valkey.duplicate();
    const heard: string[] = [];
    await events.subscribe(`user:${mac.body.user.id}`);
    events.on("message", (_channel, message) => heard.push(message));
    expect(
      (await h.call("DELETE", `/api/v1/auth/sessions/${macSession.id}`, undefined, web.body.accessToken))
        .status,
    ).toBe(204);
    expect((await h.call("GET", "/api/v1/me", undefined, mac.body.accessToken)).status).toBe(401);
    expect((await h.call("GET", "/api/v1/me", undefined, web.body.accessToken)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(heard.some((message) => JSON.parse(message).type === "account.signed_out")).toBe(true);
    events.disconnect();
  });

  it("keeps a signed-out session's access token refused after Valkey restarts empty", async () => {
    const mac = await emailSignIn("d@example.com", "launcher-macos/0.2.13");
    const web = await emailSignIn("d@example.com", "web/1.0");
    expect((await h.call("POST", "/api/v1/auth/logout", {}, mac.body.accessToken)).status).toBe(204);
    // Valkey keeps nothing across a restart.
    await h.valkey.flushdb();
    const refused = await h.call("GET", "/api/v1/me", undefined, mac.body.accessToken);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe("session_revoked");
    // A session still signed in is untouched.
    expect((await h.call("GET", "/api/v1/me", undefined, web.body.accessToken)).status).toBe(200);
    // The refusal is cached again: Valkey says so on its own from now on.
    await h.valkey.flushdb();
    expect((await h.call("GET", "/api/v1/me", undefined, web.body.accessToken)).status).toBe(200);
    expect((await h.call("GET", "/api/v1/me", undefined, mac.body.accessToken)).status).toBe(401);
  });
});

describe("providers", () => {
  it("signs in with a Google ID token and links it to the same email's account", async () => {
    const byEmail = await emailSignIn("ayse@example.com");
    const idToken = await h.google.idToken(
      { sub: "g-123", email: "ayse@example.com", email_verified: true, name: "Ayşe Yılmaz" },
      "google-client",
    );
    const google = await h.call("POST", "/api/v1/auth/oidc/google", { idToken });
    expect(google.status).toBe(200);
    expect(google.body.user.id).toBe(byEmail.body.user.id);
  });

  it("makes a new account with a handle from the name for Apple", async () => {
    const idToken = await h.apple.idToken(
      { sub: "a-1", email: "x@privaterelay.appleid.com", email_verified: "true" },
      "org.anyps5.launcher",
    );
    const apple = await h.call("POST", "/api/v1/auth/oidc/apple", {
      idToken,
      deviceName: "Utku's MacBook Pro",
    });
    expect(apple.status).toBe(200);
    expect(apple.body.user.created).toBe(true);
    expect(apple.body.user.handle).toMatch(/^[a-z0-9_.]{3,20}$/);
  });

  it("refuses a token for another app", async () => {
    const idToken = await h.google.idToken(
      { sub: "g-9", email: "z@example.com", email_verified: true },
      "someone-else",
    );
    expect((await h.call("POST", "/api/v1/auth/oidc/google", { idToken })).body.code).toBe(
      "provider_rejected",
    );
  });

  it("signs in with Discord by exchanging the code", async () => {
    const calls: string[] = [];
    await h.close();
    h = await harness({
      providers: {
        google: {
          clientIds: [],
          keys: async () => {
            throw new Error("unused");
          },
        },
        apple: {
          clientIds: [],
          keys: async () => {
            throw new Error("unused");
          },
        },
        discord: {
          clientId: "discord-client",
          clientSecret: "secret",
          fetch: async (url: string | URL | Request) => {
            calls.push(String(url));
            if (String(url).endsWith("/oauth2/token"))
              return Response.json({ access_token: "discord-token", token_type: "Bearer" });
            return Response.json({
              id: "d-42",
              username: "kral",
              global_name: "Kral",
              email: "kral@example.com",
              verified: true,
              avatar: null,
            });
          },
        },
      },
    });
    const discord = await h.call("POST", "/api/v1/auth/oidc/discord", {
      code: "abc123",
      codeVerifier: "v".repeat(43),
      redirectUri: "http://127.0.0.1:53123/callback",
    });
    expect(discord.status).toBe(200);
    expect(discord.body.user.handle).toBe("kral");
    expect(calls).toHaveLength(2);
  });
});

describe("phone hand-off and device codes", () => {
  it("signs a launcher in when the signed-in phone approves", async () => {
    const phone = await emailSignIn("e@example.com", "phone/1.10.0 (iOS 27.0)");
    const started = await h.call(
      "POST",
      "/api/v1/auth/handoff/start",
      { deviceName: "Gaming PC" },
      undefined,
      "launcher-windows/0.3.0",
    );
    expect(started.status).toBe(201);
    const poll = { grantType: "handoff", handoffId: started.body.handoffId, secret: started.body.secret };
    expect((await h.call("POST", "/api/v1/auth/token", poll)).body.code).toBe("authorization_pending");
    expect(
      (
        await h.call(
          "POST",
          `/api/v1/auth/handoff/${started.body.handoffId}/approve`,
          {},
          phone.body.accessToken,
        )
      ).status,
    ).toBe(204);
    const done = await h.call("POST", "/api/v1/auth/token", poll, undefined, "launcher-windows/0.3.0");
    expect(done.status).toBe(200);
    expect(done.body.user.id).toBe(phone.body.user.id);
    expect((await h.call("POST", "/api/v1/auth/token", poll)).status).toBe(400);
    const wrong = { ...poll, secret: "x".repeat(43) };
    expect((await h.call("POST", "/api/v1/auth/token", wrong)).status).toBe(400);
  });

  it("signs a device in with its code approved on the web", async () => {
    const web = await emailSignIn("f@example.com", "web/1.0");
    const started = await h.call("POST", "/api/v1/auth/device", { deviceName: "Living room PC" });
    expect(started.body.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(started.body.verificationUri).toBe("https://anytogether.test/link");
    expect(
      (
        await h.call(
          "POST",
          "/api/v1/auth/device/approve",
          { userCode: started.body.userCode.toLowerCase() },
          web.body.accessToken,
        )
      ).status,
    ).toBe(204);
    const done = await h.call("POST", "/api/v1/auth/token", {
      grantType: "device_code",
      deviceCode: started.body.deviceCode,
    });
    expect(done.status).toBe(200);
    expect(done.body.user.id).toBe(web.body.user.id);
  });
});

describe("the service", () => {
  it("answers health checks", async () => {
    expect((await h.call("GET", "/api/v1/health")).body).toEqual({ ok: true });
  });

  it("counts sign-ins per X-Real-IP when told to, whatever CF-Connecting-IP the caller sends", async () => {
    await h.close();
    h = await harness({ clientIpHeader: "x-real-ip", limits: { signIn: { max: 3, seconds: 900 } } });
    const start = (cf: string, real = "198.51.100.7") =>
      h.app.request("/api/v1/auth/email/start", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": cf, "x-real-ip": real },
        body: JSON.stringify({ email: "spoof@example.com" }),
      });
    for (let i = 0; i < 3; i++) expect((await start(`203.0.113.${i}`)).status).toBe(202);
    expect((await start("203.0.113.99")).status).toBe(429);
    // Another real address has its own count.
    expect((await start("203.0.113.100", "198.51.100.8")).status).toBe(202);
  });

  it("refuses a request body over 8 MB before reading it all", async () => {
    const huge = JSON.stringify({ email: "a@example.com", padding: "x".repeat(9 * 1024 * 1024) });
    const response = await h.app.request("/api/v1/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: huge,
    });
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("payload_too_large");
  });

  it("speaks problem details with a stable code", async () => {
    const bad = await h.call("POST", "/api/v1/auth/email/start", { email: "not an email" });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toContain("application/problem+json");
    expect(bad.body.code).toBe("bad_request");
  });
});
