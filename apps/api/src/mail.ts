import nodemailer from "nodemailer";

/** Sends sign-in codes, account-deletion codes and the notification digest. Development prints
 *  them; production uses SMTP or Resend. */
export interface Mailer {
  signInCode(to: string, code: string, link: string): Promise<void>;
  deletionCode(to: string, code: string): Promise<void>;
  digest(to: string, items: DigestItem[], siteUrl: string): Promise<void>;
  /** A manager made a child account for this address. */
  familyChild(to: string, notice: FamilyChildNotice, siteUrl: string): Promise<void>;
  /** The weekly summary of the children's play, for a parent who turned it on. */
  familySummary(to: string, summary: FamilySummary, siteUrl: string): Promise<void>;
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
    async signInCode(to, code, link) {
      console.log(`[mail] sign-in code for ${to}: ${code}  (${link})`);
    },
    async deletionCode(to, code) {
      console.log(`[mail] deletion code for ${to}: ${code}`);
    },
    async digest(to, items) {
      console.log(`[mail] digest for ${to}: ${items.length} item(s)`);
    },
    async familyChild(to, notice) {
      console.log(`[mail] child account for ${to} in ${notice.familyName}`);
    },
    async familySummary(to, summary) {
      console.log(`[mail] family summary for ${to}: ${summary.children.length} child(ren)`);
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

/** A child account was made for this address: who made it, how to sign in, and what to do if it
 *  is not theirs. In English and Turkish. */
export function familyChildMail(notice: FamilyChildNotice, siteUrl: string) {
  return {
    subject: `${notice.familyName} · AnyTogether`,
    text: [
      `${notice.managerName} made an AnyTogether account for this address in the family "${notice.familyName}".`,
      `${notice.managerName}, "${notice.familyName}" ailesinde bu adres için bir AnyTogether hesabı açtı.`,
      "",
      `Sign in with this address to start / Başlamak için bu adresle giriş yap: ${siteUrl}/family`,
      "",
      'The family\'s parents choose what the account may do. If you do not know this family, sign in and choose "This is not my family": the account leaves it.',
      'Hesabın neler yapabileceğini ailenin ebeveynleri seçer. Bu aileyi tanımıyorsan giriş yap ve "Bu benim ailem değil"i seç: hesap aileden çıkar.',
    ].join("\n"),
  };
}

const hours = (seconds: number, lang: "en" | "tr") => {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (lang === "tr") return h ? `${h} sa ${m} dk` : `${m} dk`;
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** The weekly summary: per child, time played, the games most played and friends added. No
 *  messages, nothing private beyond what the parents see on the site. */
export function familySummaryMail(summary: FamilySummary, siteUrl: string) {
  const lines = (lang: "en" | "tr") =>
    summary.children.flatMap((child) => [
      lang === "en"
        ? `${child.displayName}: ${hours(child.seconds, lang)} played, ${child.friendsAdded} new ${child.friendsAdded === 1 ? "friend" : "friends"}`
        : `${child.displayName}: ${hours(child.seconds, lang)} oyun, ${child.friendsAdded} yeni arkadaş`,
      ...child.games.slice(0, 5).map((game) => `  · ${game.name}: ${hours(game.seconds, lang)}`),
    ]);
  return {
    subject: `${summary.familyName}: the week / haftanın özeti · AnyTogether`,
    text: [
      `${summary.from} – ${summary.until}`,
      "",
      ...lines("en"),
      "",
      ...lines("tr"),
      "",
      `${siteUrl}/family`,
      "",
      `You get this weekly because you turned it on. Turn it off: ${siteUrl}/settings#notifications`,
      `Bunu açtığın için haftada bir alırsın. Kapatmak için: ${siteUrl}/settings#notifications`,
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
    async familyChild(to, notice, siteUrl) {
      await transport.sendMail({ from, to, ...familyChildMail(notice, siteUrl) });
    },
    async familySummary(to, summary, siteUrl) {
      await transport.sendMail({ from, to, ...familySummaryMail(summary, siteUrl) });
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
    familyChild: (to, notice, siteUrl) => send(to, familyChildMail(notice, siteUrl)),
    familySummary: (to, summary, siteUrl) => send(to, familySummaryMail(summary, siteUrl)),
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
    kind: "sign-in" | "deletion" | "digest" | "family-child" | "family-summary";
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
    async familyChild(to: string, notice: FamilyChildNotice, siteUrl: string) {
      const mail = familyChildMail(notice, siteUrl);
      sent.push({ to, code: "", link: "", kind: "family-child", text: `${mail.subject}\n${mail.text}` });
    },
    async familySummary(to: string, summary: FamilySummary, siteUrl: string) {
      const mail = familySummaryMail(summary, siteUrl);
      sent.push({ to, code: "", link: "", kind: "family-summary", text: `${mail.subject}\n${mail.text}` });
    },
    lastCode: (to: string, kind: "sign-in" | "deletion" = "sign-in") =>
      [...sent].reverse().find((mail) => mail.to === to && mail.kind === kind)?.code ?? "",
    lastLink: (to: string) => {
      const link = [...sent].reverse().find((mail) => mail.to === to && mail.kind === "sign-in")?.link ?? "";
      return new URL(link).searchParams.get("token") ?? "";
    },
  } satisfies Mailer & Record<string, unknown>;
}
