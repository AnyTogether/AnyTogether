import { mailLanguageOf } from "@anytogether/shared";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import {
  deletionMail,
  digestMail,
  familyChildMail,
  familySummaryMail,
  mailerFor,
  signInMail,
  smtpMailer,
} from "../src/mail.js";

describe("sign-in mail", () => {
  it("picks the transport the settings name", () => {
    expect(
      mailerFor({ transport: "smtp", smtpUrl: "smtps://u:p@mail.test:465", resendKey: "", from: "x <a@b>" })
        .kind,
    ).toBe("smtp");
    expect(mailerFor({ transport: "resend", smtpUrl: "", resendKey: "k", from: "x <a@b>" }).kind).toBe(
      "resend",
    );
    expect(mailerFor({ transport: "log", smtpUrl: "", resendKey: "", from: "x <a@b>" }).kind).toBe("log");
  });

  it("refuses SMTP without a server", () => {
    expect(() => mailerFor({ transport: "smtp", smtpUrl: "", resendKey: "", from: "x <a@b>" })).toThrow(
      /SMTP_URL/,
    );
  });

  it("puts the code in the subject and writes the mail in one language", () => {
    const link = "https://anytogether.test/login/email?token=x";
    const en = signInMail("123456", link, "en");
    expect(en.subject).toContain("123456");
    expect(en.text).toContain("sign-in code is 123456");
    expect(en.text).toContain(link);
    const tr = signInMail("123456", link, "tr");
    expect(tr.subject).toContain("123456");
    expect(tr.text).toContain("giriş kodun: 123456");
    expect(tr.text).toContain(link);
    expect(`${en.subject}${en.text}`).not.toMatch(/kod|giriş|geçerli/i);
    expect(`${tr.subject}${tr.text}`).not.toMatch(/\b(code|sign|ignore|works)\b/i);
    // English when nothing says otherwise.
    expect(signInMail("123456", link).text).toBe(en.text);
  });

  it("says what a deletion code does, in one language", () => {
    const en = deletionMail("246810", "en");
    expect(en.subject).toContain("246810");
    expect(en.text).toContain("14 days");
    expect(en.text).not.toContain("hesab");
    const tr = deletionMail("246810", "tr");
    expect(tr.text).toContain("hesabını silme kodun: 246810");
    expect(tr.text).not.toContain("days");
  });

  it("writes the digest and the family mails in one language", () => {
    const items = [{ kind: "message" as const, name: "utku", title: null, count: 2 }];
    expect(digestMail(items, "https://x", "en").text).not.toContain("Sen yokken");
    expect(digestMail(items, "https://x", "tr").text).toContain("Sen yokken");
    expect(digestMail(items, "https://x", "tr").text).not.toContain("While you were away");
    const notice = { familyName: "Halis", managerName: "Utku" };
    expect(familyChildMail(notice, "https://x", "en").text).not.toContain("ailesinde");
    expect(familyChildMail(notice, "https://x", "tr").text).not.toContain("made an");
    const summary = { familyName: "Halis", from: "1", until: "7", children: [] };
    expect(familySummaryMail(summary, "https://x", "tr").subject).not.toContain("week");
    expect(familySummaryMail(summary, "https://x", "en").subject).not.toContain("hafta");
  });

  it("reads a language from a tag or an Accept-Language list", () => {
    expect(mailLanguageOf("tr")).toBe("tr");
    expect(mailLanguageOf("tr-TR")).toBe("tr");
    expect(mailLanguageOf("de-DE,tr;q=0.8,en;q=0.5")).toBe("tr");
    expect(mailLanguageOf("en-GB")).toBe("en");
    expect(mailLanguageOf("de")).toBeNull();
    expect(mailLanguageOf(undefined)).toBeNull();
  });

  it("goes out through SMTP from the sign-in address", async () => {
    const sent: string[] = [];
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    transport.on("idle", () => {});
    const original = transport.sendMail.bind(transport);
    transport.sendMail = (async (message: nodemailer.SendMailOptions) => {
      const info = await original(message);
      sent.push(String((info as unknown as { message: Buffer }).message));
      return info;
    }) as typeof transport.sendMail;
    await smtpMailer("smtp://unused", "AnyTogether <signin@kodla.io>", transport).signInCode(
      "a@example.com",
      "654321",
      "https://anytogether.test/x",
      "en",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("From: AnyTogether <signin@kodla.io>");
    expect(sent[0]).toContain("To: a@example.com");
    expect(sent[0]).toContain("654321");
  });
});
