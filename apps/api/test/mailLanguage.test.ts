import { accounts } from "@anytogether/db";
import { eq } from "drizzle-orm";
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
const last = (to: string, kind: "sign-in" | "deletion" = "sign-in") =>
  [...h.mailer.sent].reverse().find((mail) => mail.to === to && mail.kind === kind);
const localeOf = async (email: string) =>
  (await h.deps.db.select({ locale: accounts.locale }).from(accounts).where(eq(accounts.email, email)))[0]
    ?.locale;

describe("the language of account mail", () => {
  it("signs up in the website's language, keeps it, and writes later mail in it", async () => {
    const email = "ayse@example.com";
    expect((await h.call("POST", `${v1}/auth/email/start`, { email, lang: "tr" })).status).toBe(202);
    expect(last(email)?.lang).toBe("tr");
    expect(last(email)?.text).toContain("giriş kodun");
    expect(last(email)?.text).not.toContain("Your AnyTogether");

    const signedIn = await h.call("POST", `${v1}/auth/email/verify`, {
      email,
      code: h.mailer.lastCode(email),
      lang: "tr",
    });
    expect(signedIn.status).toBe(200);
    expect(await localeOf(email)).toBe("tr");
    const token = signedIn.body.accessToken as string;

    // A launcher that sends no language: the account's.
    await h.call("POST", `${v1}/auth/email/start`, { email });
    expect(last(email)?.lang).toBe("tr");

    // Deleting: the account's language too.
    expect((await h.call("POST", `${v1}/me/deletion`, undefined, token)).status).toBe(202);
    expect(last(email, "deletion")?.lang).toBe("tr");

    // Switched to English on the website: English from then on.
    const switched = await h.call("PATCH", `${v1}/me/locale`, { lang: "en" }, token);
    expect(switched.status).toBe(200);
    expect(await localeOf(email)).toBe("en");
    await h.call("POST", `${v1}/auth/email/start`, { email });
    expect(last(email)?.lang).toBe("en");
    expect((await h.call("PATCH", `${v1}/me/locale`, { lang: "de" }, token)).status).toBe(400);
  });

  it("falls back to the browser's language, then English", async () => {
    const asked = await h.app.request(`${v1}/auth/email/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anytogether-client": "web",
        "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
      body: JSON.stringify({ email: "kerem@example.com" }),
    });
    expect(asked.status).toBe(202);
    expect(last("kerem@example.com")?.lang).toBe("tr");

    await h.call("POST", `${v1}/auth/email/start`, { email: "sam@example.com", lang: "de" });
    expect(last("sam@example.com")?.lang).toBe("en");
    expect(last("sam@example.com")?.text).not.toContain("giriş");
  });

  it("takes a language for an account made before languages were kept, never over one it has", async () => {
    const email = "old@example.com";
    const user = await h.user(email);
    expect(await localeOf(email)).toBeNull();
    await h.call("POST", `${v1}/auth/email/start`, { email });
    await h.call("POST", `${v1}/auth/email/verify`, { email, code: h.mailer.lastCode(email), lang: "tr" });
    expect(await localeOf(email)).toBe("tr");
    await h.call("POST", `${v1}/auth/email/start`, { email });
    await h.call("POST", `${v1}/auth/email/verify`, { email, code: h.mailer.lastCode(email), lang: "en" });
    expect(await localeOf(email)).toBe("tr");
    expect(user.id).toBeTruthy();
  });
});
