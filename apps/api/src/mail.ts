import nodemailer from "nodemailer";

/** Sends sign-in codes, account-deletion codes and the notification digest. Development prints
 *  them; production uses SMTP or Resend. */
export interface Mailer {
  signInCode(to: string, code: string, link: string): Promise<void>;
  deletionCode(to: string, code: string): Promise<void>;
  digest(to: string, items: DigestItem[], siteUrl: string): Promise<void>;
}

/** One line of the digest: messages from someone (in a group with a title), or a friend request. */
export interface DigestItem {
  kind: "message" | "friend_request";
  name: string;
  title: string | null;
  count: number;
}

export function logMailer(): Mailer {
  return {
    async signInCode(to, code, link) {
      console.log(`[mail] sign-in code for ${to}: ${code}  (${link})`);
    },
    async deletionCode(to, code) {
      console.log(`[mail] deletion code for ${to}: ${code}`);
    },
    async digest(to, items) {
      console.log(`[mail] digest for ${to}: ${items.length} item(s)`);
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

/** The code that confirms deleting the account, in English and Turkish. */
export function deletionMail(code: string) {
  return {
    subject: `${code} · AnyTogether account deletion / hesap silme`,
    text: [
      `Your code to delete your AnyTogether account is ${code}`,
      `AnyTogether hesabını silme kodun: ${code}`,
      "",
      "Once you confirm, the account is deleted after 14 days; signing in before then keeps it.",
      "Onayladıktan 14 gün sonra hesap silinir; o zamana kadar giriş yaparsan hesabın kalır.",
      "",
      "It works for 10 minutes. If you did not ask for it, sign in and check your devices.",
      "10 dakika geçerli. Sen istemediysen giriş yap ve cihazlarına bak.",
    ].join("\n"),
  };
}

/** What waited while someone was away, in English and Turkish, with no message text (a mailbox
 *  is read in more places than the site). */
export function digestMail(items: DigestItem[], siteUrl: string) {
  const messages = items.filter((i) => i.kind === "message");
  const requests = items.filter((i) => i.kind === "friend_request");
  const total = messages.reduce((sum, i) => sum + i.count, 0);
  const from = (i: DigestItem) => (i.title ? `${i.name} (${i.title})` : i.name);
  const lines = (lang: "en" | "tr") => [
    ...messages.map((i) =>
      lang === "en"
        ? `· ${i.count} ${i.count === 1 ? "message" : "messages"} from ${from(i)}`
        : `· ${from(i)}: ${i.count} mesaj`,
    ),
    ...requests.map((i) =>
      lang === "en" ? `· ${i.name} wants to be your friend` : `· ${i.name} arkadaşın olmak istiyor`,
    ),
  ];
  const parts = [
    ...(total ? [`${total} new ${total === 1 ? "message" : "messages"}`] : []),
    ...(requests.length
      ? [`${requests.length} friend ${requests.length === 1 ? "request" : "requests"}`]
      : []),
  ];
  return {
    subject: `${parts.join(", ")} · AnyTogether`,
    text: [
      "While you were away:",
      ...lines("en"),
      "",
      "Sen yokken:",
      ...lines("tr"),
      "",
      `${siteUrl}/notifications`,
      "",
      `You get this at most every 6 hours because you turned it on. Turn it off: ${siteUrl}/settings#notifications`,
      `Bunu açtığın için en fazla 6 saatte bir alırsın. Kapatmak için: ${siteUrl}/settings#notifications`,
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
    async deletionCode(to, code) {
      await transport.sendMail({ from, to, ...deletionMail(code) });
    },
    async digest(to, items, siteUrl) {
      await transport.sendMail({ from, to, ...digestMail(items, siteUrl) });
    },
  };
}

export function resendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  const send = async (to: string, mail: { subject: string; text: string }) => {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, ...mail }),
    });
    if (!response.ok) throw new Error(`mail failed: ${response.status}`);
  };
  return {
    signInCode: (to, code, link) => send(to, signInMail(code, link)),
    deletionCode: (to, code) => send(to, deletionMail(code)),
    digest: (to, items, siteUrl) => send(to, digestMail(items, siteUrl)),
  };
}

export interface MailSettings {
  transport: string;
  smtpUrl: string;
  resendKey: string;
  from: string;
}

/** The mailer MAIL_TRANSPORT names: smtp, resend, or log (development). */
export function mailerFor(settings: MailSettings): Mailer & { kind: "smtp" | "resend" | "log" } {
  if (settings.transport === "smtp") {
    if (!settings.smtpUrl) throw new Error("MAIL_TRANSPORT=smtp needs SMTP_URL");
    return { kind: "smtp", ...smtpMailer(settings.smtpUrl, settings.from) };
  }
  if (settings.transport === "resend")
    return { kind: "resend", ...resendMailer(settings.resendKey, settings.from) };
  return { kind: "log", ...logMailer() };
}

/** Keeps what was sent, for the tests. */
export function memoryMailer() {
  const sent: {
    to: string;
    code: string;
    link: string;
    kind: "sign-in" | "deletion" | "digest";
    text?: string;
  }[] = [];
  return {
    sent,
    async signInCode(to: string, code: string, link: string) {
      sent.push({ to, code, link, kind: "sign-in" });
    },
    async deletionCode(to: string, code: string) {
      sent.push({ to, code, link: "", kind: "deletion" });
    },
    async digest(to: string, items: DigestItem[], siteUrl: string) {
      const mail = digestMail(items, siteUrl);
      sent.push({ to, code: "", link: "", kind: "digest", text: `${mail.subject}\n${mail.text}` });
    },
    lastCode: (to: string, kind: "sign-in" | "deletion" = "sign-in") =>
      [...sent].reverse().find((mail) => mail.to === to && mail.kind === kind)?.code ?? "",
    lastLink: (to: string) => {
      const link = [...sent].reverse().find((mail) => mail.to === to && mail.kind === "sign-in")?.link ?? "";
      return new URL(link).searchParams.get("token") ?? "";
    },
  } satisfies Mailer & Record<string, unknown>;
}
