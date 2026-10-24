/** Sends sign-in codes. Development prints them; production uses Resend. */
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

export function resendMailer(apiKey: string, from: string, fetcher: typeof fetch = fetch): Mailer {
  return {
    async signInCode(to, code, link) {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          subject: `${code} is your AnyTogether code`,
          text: `Your AnyTogether sign-in code is ${code}.\n\nOr open this link: ${link}\n\nIt works for 10 minutes. If you did not ask for it, ignore this mail.`,
        }),
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
