import type { MailLanguage } from "@anytogether/shared";
import nodemailer from "nodemailer";
import { MailError, classifyMailError, maskAddress } from "./mailCheck.js";

export type { MailLanguage };

/** Sends sign-in codes, account-deletion codes and the notification digest, each in one language.
 *  Development prints them; production uses SMTP or Resend. */
export interface Mailer {
  signInCode(to: string, code: string, link: string, lang: MailLanguage): Promise<void>;
  deletionCode(to: string, code: string, lang: MailLanguage): Promise<void>;
  digest(to: string, items: DigestItem[], siteUrl: string, lang: MailLanguage): Promise<void>;
  /** A manager made a child account for this address. */
  familyChild(to: string, notice: FamilyChildNotice, siteUrl: string, lang: MailLanguage): Promise<void>;
  /** The weekly summary of the children's play, for a parent who turned it on. */
  familySummary(to: string, summary: FamilySummary, siteUrl: string, lang: MailLanguage): Promise<void>;
}

export interface FamilyChildNotice {
  familyName: string;
  managerName: string;
}

/** A week of play per child, for the parents. */
export interface FamilySummary {
  familyName: string;
  from: string;
  until: string;
  children: {
    displayName: string;
    seconds: number;
    games: { name: string; seconds: number }[];
    friendsAdded: number;
  }[];
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
    async signInCode(to, code, link, lang) {
      console.log(`[mail] sign-in code for ${to}: ${code}  (${link}) [${lang}]`);
    },
    async deletionCode(to, code, lang) {
      console.log(`[mail] deletion code for ${to}: ${code} [${lang}]`);
    },
    async digest(to, items, _siteUrl, lang) {
      console.log(`[mail] digest for ${to}: ${items.length} item(s) [${lang}]`);
    },
    async familyChild(to, notice, _siteUrl, lang) {
      console.log(`[mail] child account for ${to} in ${notice.familyName} [${lang}]`);
    },
    async familySummary(to, summary, _siteUrl, lang) {
      console.log(`[mail] family summary for ${to}: ${summary.children.length} child(ren) [${lang}]`);
    },
  };
}

/** The sign-in mail: the code first, the link after. */
export function signInMail(code: string, link: string, lang: MailLanguage = "en") {
  if (lang === "tr")
    return {
      subject: `AnyTogether giriş kodun: ${code}`,
      text: [
        `AnyTogether giriş kodun: ${code}`,
        "",
        `Ya da giriş yapmak için bu bağlantıyı aç:\n${link}`,
        "",
        "Kod 10 dakika geçerli. Sen istemediysen bu e-postayı yok sayabilirsin.",
      ].join("\n"),
    };
  return {
    subject: `Your AnyTogether code: ${code}`,
    text: [
      `Your AnyTogether sign-in code is ${code}.`,
      "",
      `Or open this link to sign in:\n${link}`,
      "",
      "The code works for 10 minutes. If you did not ask for it, you can ignore this mail.",
    ].join("\n"),
  };
}

/** The code that confirms deleting the account. */
export function deletionMail(code: string, lang: MailLanguage = "en") {
  if (lang === "tr")
    return {
      subject: `AnyTogether hesap silme kodun: ${code}`,
      text: [
        `AnyTogether hesabını silme kodun: ${code}`,
        "",
        "Onayladıktan 14 gün sonra hesabın silinir. O zamana kadar giriş yaparsan hesabın kalır.",
        "",
        "Kod 10 dakika geçerli. Sen istemediysen giriş yap ve cihazlarına bak.",
      ].join("\n"),
    };
  return {
    subject: `Your AnyTogether account deletion code: ${code}`,
    text: [
      `Your code to delete your AnyTogether account is ${code}.`,
      "",
      "Once you confirm, the account is deleted after 14 days. Signing in before then keeps it.",
      "",
      "The code works for 10 minutes. If you did not ask for it, sign in and check your devices.",
    ].join("\n"),
  };
}

/** What waited while someone was away, with no message text (a mailbox is read in more places
 *  than the site). */
export function digestMail(items: DigestItem[], siteUrl: string, lang: MailLanguage = "en") {
  const messages = items.filter((i) => i.kind === "message");
  const requests = items.filter((i) => i.kind === "friend_request");
  const total = messages.reduce((sum, i) => sum + i.count, 0);
  const from = (i: DigestItem) => (i.title ? `${i.name} (${i.title})` : i.name);
  if (lang === "tr") {
    const parts = [
      ...(total ? [`${total} yeni mesaj`] : []),
      ...(requests.length ? [`${requests.length} arkadaşlık isteği`] : []),
    ];
    return {
      subject: `AnyTogether: ${parts.join(", ")}`,
      text: [
        "Sen yokken:",
        ...messages.map((i) => `- ${from(i)}: ${i.count} mesaj`),
        ...requests.map((i) => `- ${i.name} arkadaşın olmak istiyor`),
        "",
        `${siteUrl}/notifications`,
        "",
        `Bunu açtığın için en fazla 6 saatte bir alırsın. Kapatmak için: ${siteUrl}/settings#notifications`,
      ].join("\n"),
    };
  }
  const parts = [
    ...(total ? [`${total} new ${total === 1 ? "message" : "messages"}`] : []),
    ...(requests.length
      ? [`${requests.length} friend ${requests.length === 1 ? "request" : "requests"}`]
      : []),
  ];
  return {
    subject: `AnyTogether: ${parts.join(", ")}`,
    text: [
      "While you were away:",
      ...messages.map((i) => `- ${i.count} ${i.count === 1 ? "message" : "messages"} from ${from(i)}`),
      ...requests.map((i) => `- ${i.name} wants to be your friend`),
      "",
      `${siteUrl}/notifications`,
      "",
      `You get this at most every 6 hours because you turned it on. Turn it off here: ${siteUrl}/settings#notifications`,
    ].join("\n"),
  };
}

/** A child account was made for this address: who made it, how to sign in, and what to do if it
 *  is not theirs. */
export function familyChildMail(notice: FamilyChildNotice, siteUrl: string, lang: MailLanguage = "en") {
  if (lang === "tr")
    return {
      subject: `AnyTogether: ${notice.familyName} ailesinde senin için bir hesap`,
      text: [
        `${notice.managerName}, "${notice.familyName}" ailesinde bu adres için bir AnyTogether hesabı açtı.`,
        "",
        `Başlamak için bu adresle giriş yap: ${siteUrl}/family`,
        "",
        "Hesabın neler yapabileceğini ailenin ebeveynleri seçer.",
        'Bu aileyi tanımıyorsan giriş yap ve "Bu benim ailem değil" seçeneğine bas. Hesap o zaman aileden çıkar.',
      ].join("\n"),
    };
  return {
    subject: `AnyTogether: an account for you in ${notice.familyName}`,
    text: [
      `${notice.managerName} made an AnyTogether account for this address in the family "${notice.familyName}".`,
      "",
      `Sign in with this address to start: ${siteUrl}/family`,
      "",
      "The family's parents choose what the account may do.",
      'If you do not know this family, sign in and choose "This is not my family". The account then leaves it.',
    ].join("\n"),
  };
}

const hours = (seconds: number, lang: MailLanguage) => {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (lang === "tr") return h ? `${h} sa ${m} dk` : `${m} dk`;
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** The weekly summary: per child, time played, the games most played and friends added. No
 *  messages, nothing private beyond what the parents see on the site. */
export function familySummaryMail(summary: FamilySummary, siteUrl: string, lang: MailLanguage = "en") {
  const lines = summary.children.flatMap((child) => [
    lang === "tr"
      ? `${child.displayName}: ${hours(child.seconds, lang)} oyun, ${child.friendsAdded} yeni arkadaş`
      : `${child.displayName}: ${hours(child.seconds, lang)} played, ${child.friendsAdded} new ${child.friendsAdded === 1 ? "friend" : "friends"}`,
    ...child.games.slice(0, 5).map((game) => `  - ${game.name}: ${hours(game.seconds, lang)}`),
  ]);
  return {
    subject:
      lang === "tr"
        ? `${summary.familyName}: AnyTogether'da haftanın özeti`
        : `${summary.familyName}: the week on AnyTogether`,
    text: [
      `${summary.from} – ${summary.until}`,
      "",
      ...lines,
      "",
      `${siteUrl}/family`,
      "",
      lang === "tr"
        ? `Bunu açtığın için haftada bir alırsın. Kapatmak için: ${siteUrl}/settings#notifications`
        : `You get this weekly because you turned it on. Turn it off here: ${siteUrl}/settings#notifications`,
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
    async signInCode(to, code, link, lang) {
      await transport.sendMail({ from, to, ...signInMail(code, link, lang) });
    },
    async deletionCode(to, code, lang) {
      await transport.sendMail({ from, to, ...deletionMail(code, lang) });
    },
    async digest(to, items, siteUrl, lang) {
      await transport.sendMail({ from, to, ...digestMail(items, siteUrl, lang) });
    },
    async familyChild(to, notice, siteUrl, lang) {
      await transport.sendMail({ from, to, ...familyChildMail(notice, siteUrl, lang) });
    },
    async familySummary(to, summary, siteUrl, lang) {
      await transport.sendMail({ from, to, ...familySummaryMail(summary, siteUrl, lang) });
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
    if (!response.ok)
      throw Object.assign(
        new Error(`${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`),
        {
          status: response.status,
        },
      );
  };
  return {
    signInCode: (to, code, link, lang) => send(to, signInMail(code, link, lang)),
    deletionCode: (to, code, lang) => send(to, deletionMail(code, lang)),
    digest: (to, items, siteUrl, lang) => send(to, digestMail(items, siteUrl, lang)),
    familyChild: (to, notice, siteUrl, lang) => send(to, familyChildMail(notice, siteUrl, lang)),
    familySummary: (to, summary, siteUrl, lang) => send(to, familySummaryMail(summary, siteUrl, lang)),
  };
}

export interface MailSettings {
  transport: string;
  smtpUrl: string;
  resendKey: string;
  from: string;
}

/** The mailer MAIL_TRANSPORT names: smtp, resend, or log (development). A mail that fails is
 *  logged with its class (DNS, TCP, TLS, auth, recipient, …; never a password) and thrown as a
 *  MailError. */
export function mailerFor(settings: MailSettings): Mailer & { kind: "smtp" | "resend" | "log" } {
  if (settings.transport === "smtp") {
    if (!settings.smtpUrl) throw new Error("MAIL_TRANSPORT=smtp needs SMTP_URL");
    return { kind: "smtp", ...reporting("smtp", smtpMailer(settings.smtpUrl, settings.from)) };
  }
  if (settings.transport === "resend")
    return { kind: "resend", ...reporting("resend", resendMailer(settings.resendKey, settings.from)) };
  return { kind: "log", ...logMailer() };
}

/** The same mailer, its failures logged as one classified line and thrown as MailError. */
export function reporting(kind: string, mailer: Mailer, log: (line: string) => void = console.error): Mailer {
  const guard =
    <A extends unknown[]>(what: string, send: (to: string, ...rest: A) => Promise<void>) =>
    async (to: string, ...rest: A) => {
      try {
        await send(to, ...rest);
      } catch (error) {
        const { failure, detail, hint } = classifyMailError(error);
        log(`[mail] ${what} to ${maskAddress(to)} via ${kind} failed: ${failure}: ${detail} (${hint})`);
        throw new MailError(failure, detail);
      }
    };
  return {
    signInCode: guard("sign-in code", mailer.signInCode),
    deletionCode: guard("deletion code", mailer.deletionCode),
    digest: guard("digest", mailer.digest),
    familyChild: guard("family child notice", mailer.familyChild),
    familySummary: guard("family summary", mailer.familySummary),
  };
}

/** Keeps what was sent, for the tests. */
export function memoryMailer() {
  const sent: {
    to: string;
    code: string;
    link: string;
    kind: "sign-in" | "deletion" | "digest" | "family-child" | "family-summary";
    text?: string;
    lang: MailLanguage;
  }[] = [];
  return {
    sent,
    async signInCode(to: string, code: string, link: string, lang: MailLanguage) {
      const mail = signInMail(code, link, lang);
      sent.push({ to, code, link, kind: "sign-in", text: `${mail.subject}\n${mail.text}`, lang });
    },
    async deletionCode(to: string, code: string, lang: MailLanguage) {
      const mail = deletionMail(code, lang);
      sent.push({ to, code, link: "", kind: "deletion", text: `${mail.subject}\n${mail.text}`, lang });
    },
    async digest(to: string, items: DigestItem[], siteUrl: string, lang: MailLanguage) {
      const mail = digestMail(items, siteUrl, lang);
      sent.push({ to, code: "", link: "", kind: "digest", text: `${mail.subject}\n${mail.text}`, lang });
    },
    async familyChild(to: string, notice: FamilyChildNotice, siteUrl: string, lang: MailLanguage) {
      const mail = familyChildMail(notice, siteUrl, lang);
      const text = `${mail.subject}\n${mail.text}`;
      sent.push({ to, code: "", link: "", kind: "family-child", text, lang });
    },
    async familySummary(to: string, summary: FamilySummary, siteUrl: string, lang: MailLanguage) {
      const mail = familySummaryMail(summary, siteUrl, lang);
      const text = `${mail.subject}\n${mail.text}`;
      sent.push({ to, code: "", link: "", kind: "family-summary", text, lang });
    },
    lastCode: (to: string, kind: "sign-in" | "deletion" = "sign-in") =>
      [...sent].reverse().find((mail) => mail.to === to && mail.kind === kind)?.code ?? "",
    lastLink: (to: string) => {
      const link = [...sent].reverse().find((mail) => mail.to === to && mail.kind === "sign-in")?.link ?? "";
      return new URL(link).searchParams.get("token") ?? "";
    },
  } satisfies Mailer & Record<string, unknown>;
}
