import { rateLimitText } from "@/lib/rateLimit";
import { describe, expect, it } from "vitest";

const en = {
  language: "en",
  tooMany: "Too many tries.",
  tooManyWait: "Too many changes for now. Try again {when}.",
};
const tr = {
  language: "tr",
  tooMany: "Çok fazla deneme.",
  tooManyWait: "Şimdilik çok fazla değişiklik yaptın. {when} yeniden dene.",
};

describe("the rate limit message", () => {
  it("says how long to wait, in the page's language", () => {
    expect(rateLimitText(180, en)).toBe("Too many changes for now. Try again in 3 minutes.");
    expect(rateLimitText(45, en)).toBe("Too many changes for now. Try again in 45 seconds.");
    expect(rateLimitText(7200, en)).toBe("Too many changes for now. Try again in 2 hours.");
    expect(rateLimitText(180, tr)).toBe("Şimdilik çok fazla değişiklik yaptın. 3 dakika sonra yeniden dene.");
  });

  it("falls back to the plain line without a wait", () => {
    expect(rateLimitText(undefined, en)).toBe("Too many tries.");
    expect(rateLimitText("soon", tr)).toBe("Çok fazla deneme.");
  });
});
