import type { StatusColumn } from "@/content/status";
import type { Language } from "./i18n";
import type { SectionId, SpecPlatform } from "./specs";

/** The full specs page's own texts; the features are in specs.ts and the status board in
 *  content/status.ts. English and Turkish. */
const en = {
  meta: {
    title: "Full specs: every feature of AnyPS5 and AnyTogether · AnyTogether",
    description:
      "Every feature of the AnyPS5 engine, the Mac launcher, AnyPS5 Desktop for Windows and Linux, the AnyPS5 Remote phone app and AnyTogether, on one sheet, with platforms, status and source.",
  },
  kicker: "Full specs",
  title: ["Every feature.", "On one sheet."],
  lead: "The engine, both launchers, the phone app and AnyTogether, feature by feature, with where each one runs. Only what exists today; what is planned is on the status board and the roadmap.",
  block: {
    label: "Sheet",
    sheet: "Full specs",
    rev: "Checked",
    mac: "Mac",
    desktop: "Windows · Linux",
    phone: "Phone",
    features: "Features",
  },
  links: { download: "Download", roadmap: "Roadmap", changelog: "Changelog" },
  sections: {
    engine: {
      nav: "Engine",
      kicker: "ARM Core · engine",
      title: "The engine",
      lead: "AnyPS5-ARM: the PS5 engine port for Apple-silicon Macs, and our own engine builds for Windows and Linux.",
    },
    mac: {
      nav: "Mac",
      kicker: "AnyPS5.app · macOS 14+",
      title: "Launcher for Mac",
      lead: "The SwiftUI launcher laid out like the PS5 home screen: it finds, unlocks and starts your games, and keeps their controls, saves and trophies.",
    },
    desktop: {
      nav: "Windows · Linux",
      kicker: "AnyPS5 Desktop · preview",
      title: "Launcher for Windows and Linux",
      lead: "The same launcher in Flutter for PCs and the Steam Deck, with AnyTogether built in. An early preview.",
    },
    phone: {
      nav: "Phone",
      kicker: "AnyPS5 Remote · iOS · Android",
      title: "The phone app",
      lead: "Your phone as a DualSense, the launcher in your hand, and AnyTogether on the go.",
    },
    online: {
      nav: "Online",
      kicker: "AnyTogether",
      title: "Online, together",
      lead: "Accounts, friends, parties, voice, messages, trophies, share play and online play, the same on every launcher, the phone and this website.",
    },
    more: {
      nav: "More",
      kicker: "Everything else",
      title: "And the rest",
      lead: "The browser pad, the Steam Deck, signed releases and the languages everything speaks.",
    },
  } satisfies Record<SectionId, { nav: string; kicker: string; title: string; lead: string }>,
  platforms: {
    mac: "Mac",
    windows: "Windows",
    linux: "Linux",
    iphone: "iOS",
    android: "Android",
    web: "Web",
  } satisfies Record<SpecPlatform, string>,
  runsOn: "Runs on",
  tags: {
    exp: "Experimental",
    next: "Next release",
    nextOn: "Next release on {platforms}",
  },
  legend: {
    exp: "Off by default or not yet proven on many games.",
    next: "Merged and coming in the next release.",
  },
  stats: { features: "features", exp: "experimental", next: "next release" },
  filter: {
    label: "Filter the sheet",
    placeholder: "Search features",
    all: "All",
    platform: "Platform",
    count: "{n} of {total} features",
    none: "Nothing matches. Try another word or platform.",
    clear: "Clear",
  },
  onThisPage: "On this page",
  permalink: "Link to {code}",
  status: {
    nav: "Status",
    kicker: "Status",
    title: "Shipped, building, planned",
    lead: "What came out lately, what is being built right now and what is planned next.",
    columns: {
      done: ["Done", "Recently shipped."],
      progress: ["In progress", "Being built right now."],
      planned: ["Planned", "Not started yet."],
    } satisfies Record<StatusColumn, [string, string]>,
    next: "Next release",
    updated: "Updated {date}.",
    roadmap: "The whole roadmap",
  },
  source: {
    nav: "Source",
    kicker: "Open source",
    title: "Source & downloads",
    lead: "Everything is on GitHub. Each AnyPS5-ARM branch is its own project, with its own README.",
    latest: "Latest release",
    noReleases: "No tagged releases",
    releases: "All releases",
    repo: "Repository",
    branches: "Branches",
    merged: "Merged into main",
    credits: "Built on and with",
    downloads: "Every file, with its checksum",
  },
  checkedOn: "Checked against the repositories and their releases on {date}.",
  suggest: "Missing something?",
};

export type SpecsStrings = typeof en;

const tr: SpecsStrings = {
  meta: {
    title: "Tüm özellikler: AnyPS5 ve AnyTogether'ın her özelliği · AnyTogether",
    description:
      "AnyPS5 motoru, Mac launcher'ı, Windows ve Linux için AnyPS5 Desktop, AnyPS5 Remote telefon uygulaması ve AnyTogether'ın her özelliği tek sayfada; platformları, durumu ve kaynağıyla.",
  },
  kicker: "Tüm özellikler",
  title: ["Her özellik.", "Tek sayfada."],
  lead: "Motor, iki launcher, telefon uygulaması ve AnyTogether; özellik özellik, her birinin nerede çalıştığıyla. Yalnızca bugün var olanlar; planlananlar durum panosunda ve yol haritasında.",
  block: {
    label: "Sayfa",
    sheet: "Tüm özellikler",
    rev: "Denetlendi",
    mac: "Mac",
    desktop: "Windows · Linux",
    phone: "Telefon",
    features: "Özellik",
  },
  links: { download: "İndir", roadmap: "Yol haritası", changelog: "Sürüm notları" },
  sections: {
    engine: {
      nav: "Motor",
      kicker: "ARM Core · motor",
      title: "Motor",
      lead: "AnyPS5-ARM: Apple silicon Mac'ler için PS5 motoru portu ve Windows ile Linux için kendi motor derlemelerimiz.",
    },
    mac: {
      nav: "Mac",
      kicker: "AnyPS5.app · macOS 14+",
      title: "Mac launcher'ı",
      lead: "PS5 ana ekranı gibi dizilmiş SwiftUI launcher'ı: oyunlarını bulur, kilidini açar, başlatır; kontrollerini, kayıtlarını ve kupalarını saklar.",
    },
    desktop: {
      nav: "Windows · Linux",
      kicker: "AnyPS5 Desktop · önizleme",
      title: "Windows ve Linux launcher'ı",
      lead: "PC'ler ve Steam Deck için Flutter ile aynı launcher, AnyTogether yerleşik. Erken bir önizleme.",
    },
    phone: {
      nav: "Telefon",
      kicker: "AnyPS5 Remote · iOS · Android",
      title: "Telefon uygulaması",
      lead: "Telefonun bir DualSense, launcher avucunda, AnyTogether yanında.",
    },
    online: {
      nav: "Çevrimiçi",
      kicker: "AnyTogether",
      title: "Çevrimiçi, birlikte",
      lead: "Hesaplar, arkadaşlar, partiler, ses, mesajlar, kupalar, Share play ve çevrimiçi oyun; her launcher'da, telefonda ve bu sitede aynı.",
    },
    more: {
      nav: "Diğer",
      kicker: "Geri kalan her şey",
      title: "Ve gerisi",
      lead: "Tarayıcı kumandası, Steam Deck, imzalı sürümler ve her şeyin konuştuğu diller.",
    },
  },
  platforms: {
    mac: "Mac",
    windows: "Windows",
    linux: "Linux",
    iphone: "iOS",
    android: "Android",
    web: "Web",
  },
  runsOn: "Çalıştığı yer",
  tags: {
    exp: "Deneysel",
    next: "Sonraki sürüm",
    nextOn: "{platforms} için sonraki sürüm",
  },
  legend: {
    exp: "Varsayılan olarak kapalı ya da henüz pek çok oyunda kanıtlanmadı.",
    next: "Birleştirildi, bir sonraki sürümle geliyor.",
  },
  stats: { features: "özellik", exp: "deneysel", next: "sonraki sürüm" },
  filter: {
    label: "Sayfayı süz",
    placeholder: "Özellik ara",
    all: "Tümü",
    platform: "Platform",
    count: "{total} özellikten {n} tanesi",
    none: "Eşleşen yok. Başka bir kelime ya da platform dene.",
    clear: "Temizle",
  },
  onThisPage: "Bu sayfada",
  permalink: "{code} bağlantısı",
  status: {
    nav: "Durum",
    kicker: "Durum",
    title: "Çıkanlar, yapılanlar, planlananlar",
    lead: "Son çıkanlar, şu an üzerinde çalışılanlar ve sırada planlananlar.",
    columns: {
      done: ["Bitti", "Yakın zamanda çıktı."],
      progress: ["Yapılıyor", "Şu an üzerinde çalışılıyor."],
      planned: ["Planlandı", "Henüz başlanmadı."],
    },
    next: "Sonraki sürüm",
    updated: "{date} tarihinde güncellendi.",
    roadmap: "Tüm yol haritası",
  },
  source: {
    nav: "Kaynak",
    kicker: "Açık kaynak",
    title: "Kaynak ve indirmeler",
    lead: "Her şey GitHub'da. AnyPS5-ARM'ın her dalı kendi README'siyle ayrı bir proje.",
    latest: "Son sürüm",
    noReleases: "Etiketli sürüm yok",
    releases: "Tüm sürümler",
    repo: "Depo",
    branches: "Dallar",
    merged: "main'e birleşenler",
    credits: "Üzerine ve birlikte kurulduklarımız",
    downloads: "Her dosya, sağlamasıyla",
  },
  checkedOn: "{date} tarihinde depolara ve sürümlerine göre denetlendi.",
  suggest: "Eksik bir şey mi var?",
};

export const specsStrings = (language: Language): SpecsStrings => (language === "tr" ? tr : en);
