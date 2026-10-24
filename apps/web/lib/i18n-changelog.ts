import type { Language } from "./i18n";

/** The changelog's texts, English and Turkish. The release notes themselves are GitHub's, in
 *  English. */
const en = {
  meta: {
    title: "Changelog: every AnyPS5 release · AnyTogether",
    description:
      "The release notes of AnyPS5-ARM (the Mac launcher, the engine and the phone app) and AnyPS5 Desktop (Windows and Linux), newest first, with each release's downloads.",
  },
  kicker: "Changelog",
  title: ["What's new.", "Every release, newest first."],
  lead: "The release notes of AnyPS5-ARM (the Mac launcher, the engine and the phone app) and AnyPS5 Desktop (Windows and Linux), as they are published on GitHub, with each release's files.",
  filter: "Show",
  all: "All",
  projects: {
    macos: ["AnyPS5-ARM", "Mac · phone"],
    desktop: ["AnyPS5 Desktop", "Windows · Linux"],
  },
  latest: "Latest",
  prerelease: "Pre-release",
  files: "Downloads",
  onGitHub: "On GitHub",
  showNotes: "Release notes",
  count: "{n} releases",
  englishOnly: "",
  down: "GitHub is not answering right now. Every release and its notes are on GitHub:",
  none: "No releases to show.",
  current: "For the newest files with checksums and install steps, see {link}.",
  downloads: "Download",
};

export type ChangelogStrings = typeof en;

const tr: ChangelogStrings = {
  meta: {
    title: "Sürüm notları: AnyPS5'in her sürümü · AnyTogether",
    description:
      "AnyPS5-ARM (Mac launcher'ı, motor ve telefon uygulaması) ve AnyPS5 Desktop (Windows ve Linux) sürüm notları; en yenisi önce, her sürümün indirmeleriyle.",
  },
  kicker: "Sürüm notları",
  title: ["Neler yeni.", "Her sürüm, en yenisi önce."],
  lead: "AnyPS5-ARM (Mac launcher'ı, motor ve telefon uygulaması) ve AnyPS5 Desktop (Windows ve Linux) sürüm notları; GitHub'da yayımlandıkları gibi, her sürümün dosyalarıyla.",
  filter: "Göster",
  all: "Tümü",
  projects: {
    macos: ["AnyPS5-ARM", "Mac · telefon"],
    desktop: ["AnyPS5 Desktop", "Windows · Linux"],
  },
  latest: "En yeni",
  prerelease: "Ön sürüm",
  files: "İndirmeler",
  onGitHub: "GitHub'da",
  showNotes: "Sürüm notları",
  count: "{n} sürüm",
  englishOnly: "Sürüm notları GitHub'da İngilizce yazılıyor.",
  down: "GitHub şu an yanıt vermiyor. Her sürüm ve notları GitHub'da:",
  none: "Gösterilecek sürüm yok.",
  current: "Sağlama toplamları ve kurulum adımlarıyla en yeni dosyalar için: {link}.",
  downloads: "İndir",
};

export const changelogStrings = (language: Language): ChangelogStrings => (language === "tr" ? tr : en);
