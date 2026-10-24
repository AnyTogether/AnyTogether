import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { signInMail, smtpMailer } from "../src/mail.js";

describe("sign-in mail", () => {
  it("puts the code in the subject and both languages in the text", () => {
    const mail = signInMail("123456", "https://anytogether.test/login/email?token=x");
    expect(mail.subject).toContain("123456");
    expect(mail.text).toContain("giriş kodun: 123456");
    expect(mail.text).toContain("https://anytogether.test/login/email?token=x");
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
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("From: AnyTogether <signin@kodla.io>");
    expect(sent[0]).toContain("To: a@example.com");
    expect(sent[0]).toContain("654321");
  });
});
