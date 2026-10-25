import { lookup } from "node:dns/promises";
import { type Socket, connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import nodemailer from "nodemailer";
import type { MailSettings } from "./mail.js";

/** What went wrong with a mail, in words a server operator can act on; never a password. */
export type MailFailure =
  | "config"
  | "dns"
  | "tcp"
  | "timeout"
  | "tls"
  | "auth"
  | "sender"
  | "recipient"
  | "rejected"
  | "rate_limited"
  | "http"
  | "unknown";

const hints: Record<MailFailure, string> = {
  config:
    "the mail settings are incomplete or malformed (MAIL_TRANSPORT, SMTP_URL, RESEND_API_KEY, MAIL_FROM)",
  dns: "the mail server's name does not resolve: check the host in SMTP_URL, and the server's DNS",
  tcp: "nothing answers on that port: check the port, the provider's status and any firewall in between",
  timeout: "the mail server did not answer in time: a firewall dropping the port, or the provider is down",
  tls: "the encrypted connection failed: port 465 wants smtps:// (TLS from the start), 587 and 25 want smtp:// (STARTTLS)",
  auth: "the mail server refused the user name or password (or the API key)",
  sender: "the mail server refused the sender: MAIL_FROM must be an address the account may send from",
  recipient: "the mail server refused that recipient address",
  rejected: "the mail server took the connection but refused the mail",
  rate_limited: "the mail provider says too many mails for now",
  http: "the mail provider's API answered with an error",
  unknown: "something else; the detail says what",
};

/** Takes passwords and keys out of anything that might be logged. */
export function scrub(text: string) {
  return text
    .replace(/(smtps?:\/\/)[^@/\s]*@/gi, "$1***@")
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/g, "re_***")
    .replace(/(AUTH (?:PLAIN|LOGIN))\s+\S+/gi, "$1 ***")
    .slice(0, 300);
}

/** "u***@example.com": enough to tell addresses apart in a log. */
export const maskAddress = (address: string) => address.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

/** Sorts an error from nodemailer, the network or Resend into a failure class with a short,
 *  secret-free detail. */
export function classifyMailError(error: unknown): { failure: MailFailure; detail: string; hint: string } {
  const e = (error ?? {}) as {
    code?: string;
    errno?: string;
    command?: string;
    responseCode?: number;
    response?: string;
    message?: string;
    status?: number;
    failure?: MailFailure;
  };
  const text = `${e.message ?? ""} ${e.response ?? ""}`;
  const failure: MailFailure = (() => {
    if (e.failure) return e.failure;
    if (e.status)
      return e.status === 401 || e.status === 403
        ? "auth"
        : e.status === 429
          ? "rate_limited"
          : e.status === 422
            ? "rejected"
            : "http";
    if (
      e.code === "EDNS" ||
      e.code === "ENOTFOUND" ||
      e.code === "EAI_AGAIN" ||
      /getaddrinfo|ENOTFOUND/.test(text)
    )
      return "dns";
    if (e.code === "ETIMEDOUT" || e.code === "ETIMEOUT" || /timed? ?out/i.test(text)) return "timeout";
    if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534 || e.responseCode === 530)
      return "auth";
    if (e.code === "ETLS" || /SSL|TLS|certificate|wrong version number|self.signed/i.test(text)) return "tls";
    if (
      e.code === "ECONNECTION" ||
      e.code === "ECONNREFUSED" ||
      e.code === "ECONNRESET" ||
      e.code === "EHOSTUNREACH" ||
      /ECONNREFUSED|ECONNRESET|EHOSTUNREACH/.test(text)
    )
      return "tcp";
    if (e.code === "EENVELOPE" || e.command === "RCPT TO") return "recipient";
    if (e.command === "MAIL FROM") return "sender";
    if (e.responseCode && e.responseCode >= 400) return "rejected";
    return "unknown";
  })();
  const detail = scrub(
    [e.responseCode, e.command, e.response ?? e.message].filter(Boolean).join(" ") || String(error),
  );
  return { failure, detail, hint: hints[failure] };
}

/** A mail that could not be sent, with its class (for the logs and a 503 to the client). */
export class MailError extends Error {
  constructor(
    readonly failure: MailFailure,
    readonly detail: string,
  ) {
    super(`mail failed: ${failure}: ${detail}`);
  }
}

interface Step {
  step: string;
  status: "ok" | "warn" | "fail";
  text: string;
}

/** The SMTP server SMTP_URL names, and how it is reached: TLS from the start for smtps://,
 *  STARTTLS otherwise. */
export function smtpTarget(url: string) {
  const parsed = new URL(url);
  // As nodemailer reads the URL: smtps:// is TLS from the start, smtp:// is STARTTLS whatever the port.
  const implicit = parsed.protocol === "smtps:";
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "smtps:" ? 465 : 587)),
    implicitTls: implicit,
    user: decodeURIComponent(parsed.username),
    hasPassword: parsed.password.length > 0,
  };
}

const withTimeout = <T>(work: Promise<T>, ms: number, what: string) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(Object.assign(new Error(`${what} timed out after ${ms / 1000}s`), { code: "ETIMEDOUT" })),
        ms,
      ),
    ),
  ]);

/** Reads the server's first lines after a command (or the greeting), until a line without "-". */
function reader(socket: Socket) {
  let buffer = "";
  const waiting: ((text: string) => void)[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\r\n");
    const done = lines.findIndex((line) => /^\d{3} /.test(line));
    if (done >= 0 && waiting.length) {
      const text = lines.slice(0, done + 1).join("\n");
      buffer = lines.slice(done + 1).join("\r\n");
      waiting.shift()?.(text);
    }
  });
  return (send?: string) =>
    withTimeout(
      new Promise<string>((resolve) => {
        waiting.push(resolve);
        if (send) socket.write(`${send}\r\n`);
      }),
      8000,
      send ? (send.split(" ")[0] ?? "reply") : "greeting",
    );
}

/** Sends a test mail and says, step by step, where it went wrong if it did: the settings, DNS, the
 *  TCP connection, TLS (as the port wants it), signing in, and the server taking the recipient.
 *  `admin mail-test <address>` prints it. */
export async function mailTest(settings: MailSettings, to: string, options: { timeoutMs?: number } = {}) {
  const steps: Step[] = [];
  const add = (step: string, ok: boolean | "warn", text: string) =>
    steps.push({ step, status: ok === "warn" ? "warn" : ok ? "ok" : "fail", text: scrub(text) });
  const fail = (step: string, error: unknown) => {
    const { failure, detail, hint } = classifyMailError(error);
    add(step, false, `${failure}: ${detail}\n      ${hint}`);
    return { ok: false, failure, steps };
  };
  const timeout = options.timeoutMs ?? 10_000;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return fail("address", { failure: "config", message: `not an address: ${to}` });

  if (settings.transport === "log") {
    add("transport", true, "MAIL_TRANSPORT=log: mails are printed to the API's log, nothing is sent");
    return { ok: true, failure: null, steps };
  }

  if (settings.transport === "resend") {
    if (!settings.resendKey)
      return fail("settings", { failure: "config", message: "RESEND_API_KEY is empty" });
    add("settings", true, `resend, from ${settings.from}`);
    try {
      const addresses = await withTimeout(lookup("api.resend.com", { all: true }), timeout, "DNS");
      add("dns", true, `api.resend.com → ${addresses.map((a) => a.address).join(", ")}`);
    } catch (error) {
      return fail("dns", error);
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${settings.resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: settings.from, to, ...testMail() }),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await response.text();
      if (!response.ok)
        return fail("send", { status: response.status, message: `${response.status} ${text}` });
      add("send", true, `accepted by Resend (${response.status})`);
      return { ok: true, failure: null, steps };
    } catch (error) {
      return fail("send", error);
    }
  }

  if (settings.transport !== "smtp")
    return fail("settings", {
      failure: "config",
      message: `MAIL_TRANSPORT=${settings.transport}: use log, smtp or resend`,
    });
  let target: ReturnType<typeof smtpTarget>;
  try {
    target = smtpTarget(settings.smtpUrl);
    if (!target.host) throw new Error("no host");
  } catch {
    return fail("settings", {
      failure: "config",
      message: "SMTP_URL is not a URL like smtp://user:password@host:587",
    });
  }
  add(
    "settings",
    true,
    `smtp ${target.host}:${target.port}, ${target.implicitTls ? "TLS from the start" : "STARTTLS"}, ${target.user ? `user ${target.user}${target.hasPassword ? " with a password" : " without a password"}` : "no sign-in"}, from ${settings.from}`,
  );
  if (target.port === 465 && !target.implicitTls)
    add("settings", "warn", "port 465 normally wants smtps:// (TLS from the start)");
  if ((target.port === 587 || target.port === 25) && target.implicitTls)
    add("settings", "warn", `port ${target.port} normally wants smtp:// (STARTTLS), not smtps://`);

  try {
    const addresses = await withTimeout(lookup(target.host, { all: true }), timeout, "DNS");
    add("dns", true, `${target.host} → ${addresses.map((a) => a.address).join(", ")}`);
  } catch (error) {
    return fail("dns", error);
  }

  try {
    const socket = await withTimeout(
      new Promise<Socket>((resolve, reject) => {
        const s = connect({ host: target.host, port: target.port });
        s.once("connect", () => resolve(s));
        s.once("error", reject);
      }),
      timeout,
      "TCP connection",
    );
    add("tcp", true, `connected to ${target.host}:${target.port}`);
    if (target.implicitTls) {
      socket.destroy();
      const secure = await withTimeout(
        new Promise<ReturnType<typeof tlsConnect>>((resolve, reject) => {
          const t = tlsConnect({ host: target.host, port: target.port, servername: target.host });
          t.once("secureConnect", () => resolve(t));
          t.once("error", reject);
        }),
        timeout,
        "TLS handshake",
      );
      const cert = secure.getPeerCertificate();
      add(
        "tls",
        secure.authorized || "warn",
        `${secure.getProtocol() ?? "TLS"}${cert?.subject?.CN ? `, certificate for ${cert.subject.CN}` : ""}${cert?.valid_to ? ` until ${cert.valid_to}` : ""}${secure.authorized ? "" : ` (not trusted: ${secure.authorizationError})`}`,
      );
      secure.destroy();
    } else {
      const read = reader(socket);
      const greeting = await read();
      const hello = await read("EHLO anytogether.mail-test");
      await read("QUIT").catch(() => "");
      socket.destroy();
      const startTls = /STARTTLS/i.test(hello);
      add(
        "tls",
        startTls || "warn",
        startTls
          ? `STARTTLS offered (${greeting.split("\n")[0]})`
          : `no STARTTLS offered: the password would go unencrypted (${greeting.split("\n")[0]})`,
      );
    }
  } catch (error) {
    return fail(steps.some((s) => s.step === "tcp") ? "tls" : "tcp", error);
  }

  const transport = nodemailer.createTransport(settings.smtpUrl, {
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  } as never);
  try {
    await transport.verify();
    add(
      "auth",
      true,
      target.user ? `signed in as ${target.user}` : "the server takes mail without signing in",
    );
  } catch (error) {
    transport.close();
    return fail("auth", error);
  }
  try {
    const info = await transport.sendMail({ from: settings.from, to, ...testMail() });
    transport.close();
    if (info.rejected?.length)
      return fail("send", { command: "RCPT TO", message: `refused ${info.rejected.join(", ")}` });
    add("send", true, `accepted: ${info.response ?? "ok"}`);
    return { ok: true, failure: null, steps };
  } catch (error) {
    transport.close();
    return fail("send", error);
  }
}

/** The test mail, in English and Turkish. */
export function testMail() {
  return {
    subject: "AnyTogether mail test / posta testi",
    text: [
      "This is a test mail from your AnyTogether server: mail works.",
      "Bu, AnyTogether sunucundan bir test postası: posta çalışıyor.",
    ].join("\n"),
  };
}

/** The test's steps as the command line prints them. */
export function mailTestReport(result: Awaited<ReturnType<typeof mailTest>>) {
  const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
  const lines = result.steps.map((s) => `${mark[s.status]} ${s.step.padEnd(9)} ${s.text}`);
  lines.push(result.ok ? "mail works" : `mail does not work: ${result.failure}`);
  return lines.join("\n");
}
