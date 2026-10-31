import { fill } from "@/lib/people";

type WaitTexts = { language: string; tooMany: string; tooManyWait: string };

/** "Too many changes for now. Try again in 3 minutes.": the wait the API gave (`retryAfter`,
 *  seconds, in its 429 answer), in words. Without one, the plain "too many" line. */
export function rateLimitText(retryAfter: unknown, texts: WaitTexts) {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return texts.tooMany;
  const words = new Intl.RelativeTimeFormat(texts.language, { numeric: "always" });
  const when =
    seconds < 60
      ? words.format(Math.ceil(seconds), "second")
      : seconds < 5400
        ? words.format(Math.ceil(seconds / 60), "minute")
        : words.format(Math.round(seconds / 3600), "hour");
  return fill(texts.tooManyWait, { when });
}
