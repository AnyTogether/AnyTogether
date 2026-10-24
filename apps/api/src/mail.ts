import nodemailer from "nodemailer";

/** Sends sign-in codes. Development prints them; production uses SMTP or Resend. */
export interface Mailer {
  signInCode(to: string, code: string, link: string): Promise<void>;
}

export function logMailer(): Mailer {
  return {
    async signInCode(to, code, link) {
      console.log(`[mail] sign-in code for ${to}: ${code}  (${link})`);
    },
  };
}

/** The mail itself, in English and Turkish: the code first, the link after. */
export function signInMail(code: string, link: string) {
  return {
    subject: `${code} · AnyTogether`,
    text: [
      `Your AnyTogether sign-in code is ${code}`,
      `AnyTogether giriş kodun: ${code}`,
      "",
      `Or open this link / Ya da bu bağlantıyı aç:\n${link}`,
      "",
      "It works for 10 minutes. If you did not ask for it, ignore this mail.",
      "10 dakika geçerli. Sen istemediysen bu postayı yok say.",
    ].join("\n"),
  };
}

/** Any SMTP server, from a URL: smtps://user:password@host:465 or smtp://…:587 (STARTTLS). */
export function smtpMailer(
  url: string,
  from: string,
  transport: nodemailer.Transporter = nodemailer.createTransport(url),
): Mailer {
  return {
    async signInCode(to, code, link) {
      await transport.sendMail({ from, to, ...signInMail(code, link) });
    },
  };
}

export function resendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  return {
    async signInCode(to, code, link) {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, ...signInMail(code, link) }),
      });
      if (!response.ok) throw new Error(`mail failed: ${response.status}`);
    },
  };
}

/** Keeps what was sent, for the tests. */
export function memoryMailer() {
  const sent: { to: string; code: string; link: string }[] = [];
  return {
    sent,
    async signInCode(to: string, code: string, link: string) {
      sent.push({ to, code, link });
    },
    lastCode: (to: string) => [...sent].reverse().find((mail) => mail.to === to)?.code ?? "",
    lastLink: (to: string) => {
      const link = [...sent].reverse().find((mail) => mail.to === to)?.link ?? "";
      return new URL(link).searchParams.get("token") ?? "";
    },
  } satisfies Mailer & Record<string, unknown>;
}
