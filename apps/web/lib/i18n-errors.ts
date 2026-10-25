import type { Language } from "./i18n";

/** The not-found and error pages, in English and Turkish. The error pages are client components
 *  without the server's strings(), so they take these by language. */
export const errorStringsEn = {
  notFound: {
    kicker: "404 · Not found",
    title: ["Nothing here,", "or not any more."] as [string, string],
    lead: "That page, or that person, does not exist. The link may be old, or the handle may have changed.",
    home: "Go home",
    help: "Help",
  },
  error: {
    kicker: "Error",
    title: ["Something broke", "on our side."] as [string, string],
    lead: "This page could not be shown. Trying again often helps; if it keeps happening, report it with the error ID below.",
    retry: "Try again",
    home: "Go home",
    report: "Report it",
    reference: "Error ID",
    noReference: "This happened in your browser, so the server has no record of it.",
  },
};

export type ErrorStrings = typeof errorStringsEn;

export const errorStringsTr: ErrorStrings = {
  notFound: {
    kicker: "404 · Bulunamadı",
    title: ["Burada bir şey yok,", "ya da artık yok."],
    lead: "Bu sayfa ya da bu kişi yok. Bağlantı eski olabilir ya da kullanıcı adı değişmiş olabilir.",
    home: "Ana sayfa",
    help: "Yardım",
  },
  error: {
    kicker: "Hata",
    title: ["Bizim tarafta", "bir şey bozuldu."],
    lead: "Bu sayfa gösterilemedi. Yeniden denemek çoğu zaman işe yarar; sürerse aşağıdaki hata kimliğiyle bildir.",
    retry: "Yeniden dene",
    home: "Ana sayfa",
    report: "Bildir",
    reference: "Hata kimliği",
    noReference: "Bu, tarayıcında oldu; sunucuda bir kaydı yok.",
  },
};

export const errorStrings = (language: Language | string): ErrorStrings =>
  language === "tr" ? errorStringsTr : errorStringsEn;

/** Where people report a problem: the project's issues. */
export const reportUrl = "https://github.com/utkuhalis/AnyTogether/issues";
