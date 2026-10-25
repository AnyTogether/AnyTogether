import { type AddressInfo, type Server, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import type { Mailer } from "../src/mail.js";
import { reporting } from "../src/mail.js";
import { MailError, classifyMailError, mailTest, mailTestReport, scrub } from "../src/mailCheck.js";
import { harness } from "./harness.js";

/** A small SMTP server: STARTTLS not offered, AUTH PLAIN takes one password, and one recipient is
 *  refused. Enough for nodemailer to go through every step. */
function fakeSmtp(options: { password?: string; refuse?: string } = {}) {
  const server: Server = createServer((socket) => {
    let data = false;
    socket.write("220 mail.test ESMTP ready\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 2.0.0 queued as TEST123\r\n");
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO"))
          socket.write("250-mail.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (upper.startsWith("AUTH PLAIN")) {
          const decoded = Buffer.from(line.split(" ")[2] ?? "", "base64")
            .toString()
            .split("\0");
          socket.write(
            decoded[2] === (options.password ?? "right")
              ? "235 2.7.0 ok\r\n"
              : "535 5.7.8 bad credentials\r\n",
          );
        } else if (upper.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (upper.startsWith("RCPT TO"))
          socket.write(
            options.refuse && line.includes(options.refuse) ? "550 5.1.1 no such user\r\n" : "250 ok\r\n",
          );
        else if (upper === "DATA") {
          data = true;
          socket.write("354 go on\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else if (upper === "RSET" || upper === "NOOP") socket.write("250 ok\r\n");
        else socket.write("502 not here\r\n");
      }
    });
  });
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    ),
  );
}

const settings = (smtpUrl: string) => ({
  transport: "smtp",
  smtpUrl,
  resendKey: "",
  from: "AnyTogether <signin@mail.test>",
});
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe("mail-test", () => {
  it("goes through every step and says mail works", async () => {
    const smtp = await fakeSmtp();
    stop = smtp.close;
    const result = await mailTest(settings(`smtp://user:right@localhost:${smtp.port}`), "utku@example.com");
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.step, s.status])).toEqual([
      ["settings", "ok"],
      ["dns", "ok"],
      ["tcp", "ok"],
      ["tls", "warn"],
      ["auth", "ok"],
      ["send", "ok"],
    ]);
    const report = mailTestReport(result);
    expect(report).toContain("no STARTTLS offered");
    expect(report).toContain("queued as TEST123");
    expect(report).toContain("mail works");
    // The password never shows.
    expect(report).not.toContain("right");
  });

  it("names the failing step: auth, recipient, TCP, DNS, settings", async () => {
    const smtp = await fakeSmtp({ refuse: "nobody@" });
    stop = smtp.close;
    const wrong = await mailTest(
      settings(`smtp://user:wrong-secret@localhost:${smtp.port}`),
      "utku@example.com",
    );
    expect(wrong).toMatchObject({ ok: false, failure: "auth" });
    expect(mailTestReport(wrong)).not.toContain("wrong-secret");

    const refused = await mailTest(
      settings(`smtp://user:right@localhost:${smtp.port}`),
      "nobody@example.com",
    );
    expect(refused).toMatchObject({ ok: false, failure: "recipient" });
    expect(mailTestReport(refused)).toContain("550");

    await smtp.close();
    stop = undefined;
    const closed = await mailTest(settings(`smtp://user:right@127.0.0.1:${smtp.port}`), "utku@example.com");
    expect(closed).toMatchObject({ ok: false, failure: "tcp" });

    const nowhere = await mailTest(
      settings("smtp://user:right@no-such-host.invalid:587"),
      "utku@example.com",
    );
    expect(nowhere).toMatchObject({ ok: false, failure: "dns" });

    expect(await mailTest(settings("not a url"), "utku@example.com")).toMatchObject({ failure: "config" });
    expect(await mailTest(settings("smtp://h:587"), "not-an-address")).toMatchObject({ failure: "config" });
    const warned = await mailTest(settings("smtp://user:right@no-such-host.invalid:465"), "utku@example.com");
    expect(warned.steps[1]).toMatchObject({ step: "settings", status: "warn" });
    expect((await mailTest({ ...settings(""), transport: "log" }, "utku@example.com")).ok).toBe(true);
  });

  it("runs from the admin command line with the API's settings", async () => {
    const smtp = await fakeSmtp();
    stop = smtp.close;
    const h = await harness();
    try {
      const printed = await run(["mail-test", "utku@example.com"], {
        ...h.deps,
        mail: settings(`smtp://user:right@localhost:${smtp.port}`),
      });
      expect(printed).toContain("ok   send");
      expect(printed.split("\n").at(-1)).toBe("mail works");
      expect(await run(["mail-test"], h.deps)).toContain("usage");
    } finally {
      await h.close();
    }
  });
});

describe("mail failures", () => {
  it("are sorted into classes without secrets", () => {
    expect(classifyMailError({ code: "EDNS", message: "getaddrinfo ENOTFOUND smtp.x" }).failure).toBe("dns");
    expect(
      classifyMailError({ code: "ECONNECTION", message: "connect ECONNREFUSED 1.2.3.4:587" }).failure,
    ).toBe("tcp");
    expect(classifyMailError({ code: "ETIMEDOUT", message: "Connection timeout" }).failure).toBe("timeout");
    expect(classifyMailError({ code: "ESOCKET", message: "wrong version number" }).failure).toBe("tls");
    expect(classifyMailError({ code: "EAUTH", responseCode: 535 }).failure).toBe("auth");
    expect(classifyMailError({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }).failure).toBe(
      "recipient",
    );
    expect(classifyMailError({ command: "MAIL FROM", responseCode: 553 }).failure).toBe("sender");
    expect(classifyMailError({ status: 401 }).failure).toBe("auth");
    expect(classifyMailError({ status: 429 }).failure).toBe("rate_limited");
    expect(scrub("connect to smtps://me:hunter2@mail.x:465 failed, key re_abcdefghijkl")).toBe(
      "connect to smtps://***@mail.x:465 failed, key re_***",
    );
  });

  it("are logged as one line with their class and thrown as MailError", async () => {
    const lines: string[] = [];
    const broken: Mailer = {
      signInCode: async () => {
        throw Object.assign(new Error("Invalid login: 535 5.7.8 bad credentials"), {
          code: "EAUTH",
          responseCode: 535,
        });
      },
      deletionCode: async () => {},
      digest: async () => {},
      familyChild: async () => {},
      familySummary: async () => {},
    };
    const mailer = reporting("smtp", broken, (line) => lines.push(line));
    await expect(mailer.signInCode("utku@example.com", "123456", "https://x")).rejects.toBeInstanceOf(
      MailError,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[mail] sign-in code to u***@example.com via smtp failed: auth");
    expect(lines[0]).not.toContain("123456");
  });

  it("make a sign-in code request answer 503 mail_unavailable", async () => {
    const failing: Mailer = {
      signInCode: async () => {
        throw new MailError("tcp", "connect ECONNREFUSED");
      },
      deletionCode: async () => {},
      digest: async () => {},
      familyChild: async () => {},
      familySummary: async () => {},
    };
    const h = await harness({ mailer: failing });
    try {
      const answer = await h.call("POST", "/api/v1/auth/email/start", { email: "utku@example.com" });
      expect(answer.status).toBe(503);
      expect(answer.body.code).toBe("mail_unavailable");
      expect(answer.headers.get("retry-after")).toBe("60");
    } finally {
      await h.close();
    }
  });
});
