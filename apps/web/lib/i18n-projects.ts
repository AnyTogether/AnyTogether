import type { Language } from "./i18n";

/** The projects page: every repository, its branches, the licences and how to help. English and
 *  Turkish. The numbers (stars, forks, last push) come from the API's cached copy of GitHub's. */

export interface RepoCard {
  repo: string;
  name: string;
  license: string;
  role: string;
  lead: string;
  /** What is in it, one line each. */
  parts: [string, string][];
  links: [string, string][];
  /** Branches with one line each (AnyPS5-ARM). */
  branches?: [string, string][];
  /** The last release shown from the release cache: which project. */
  release?: "macos" | "desktop";
}

const gh = "https://github.com";

const en = {
  meta: {
    title: "Open source: every AnyPS5 and AnyTogether repository · AnyTogether",
    description:
      "AnyPS5-ARM (GPL-2.0), AnyPS5 Desktop (GPL-2.0), AnyTogether (MIT) and the upstream AnyPS5 engine: what each holds, its branches, licences and how to contribute.",
  },
  kicker: "Open source",
  title: ["Every line is public.", "Here is where it lives."],
  lead: "Three repositories make AnyPS5 and AnyTogether, built on the upstream AnyPS5 engine. All of them are on GitHub, free to read, build, run and improve.",
  stats: { stars: "stars", forks: "forks", issues: "open issues", pushed: "last push {date}" },
  latest: "Latest release {version}",
  branches: "Branches",
  inside: "What's inside",
  repos: [
    {
      repo: "utkuhalis/AnyPS5-ARM",
      name: "AnyPS5-ARM",
      license: "GPL-2.0",
      role: "Engine · Mac launcher · phone app",
      lead: "The macOS port of AnyPS5 for Apple silicon, the PS5-style launcher AnyPS5.app, and AnyPS5 Remote, the phone app that is your DualSense. Releases carry every platform's files.",
      parts: [
        [
          "Engine",
          "The relinker and system libraries that turn a PS5 game into a Mac app: Mach-O output, Vulkan through MoltenVK on Metal, the game's code under Rosetta 2.",
        ],
        [
          "Launcher",
          "AnyPS5.app in SwiftUI: unlocking, controls, trophies, saves, frame generation, share play and AnyTogether.",
        ],
        [
          "Phone app",
          "AnyPS5 Remote in Flutter for iOS and Android: the pad, motion, rumble, Remote Play and the online pages.",
        ],
      ],
      links: [
        ["Repository", `${gh}/utkuhalis/AnyPS5-ARM`],
        ["User guide", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/user/GUIDE.md`],
        ["Compatibility", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/user/COMPATIBILITY.md`],
        ["macOS port notes", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/dev/MACOS_PORT.md`],
      ],
      branches: [
        ["main", "The whole project: engine, launcher and phone app. Releases are made from here."],
        ["launcher", "The launcher alone: AnyPS5.app in SwiftUI, for macOS 14 and newer."],
        [
          "mobile-controller",
          "The phone app alone: AnyPS5 Remote for Android and iOS, from one Flutter code base.",
        ],
        ["rosetta", "The engine alone, with the game's x86-64 code running under Rosetta 2."],
        ["native-arm64", "The engine with its own x86-64 to arm64 translator: games without Rosetta."],
        [
          "anytogether",
          "AnyTogether's plan in English and Turkish: what is built and what is still planned.",
        ],
      ],
      release: "macos",
    },
    {
      repo: "utkuhalis/AnyPS5-Desktop",
      name: "AnyPS5 Desktop",
      license: "GPL-2.0",
      role: "Windows · Linux launcher",
      lead: "The AnyPS5-ARM launcher for PCs: the same PS5-style home screen, unlocking and starting games, per-game controls, trophies, saves and AnyTogether. Early preview.",
      parts: [
        [
          "Launcher",
          "Flutter for Windows 10/11 and Linux x64, with a setup, an AppImage, a .deb and portable builds.",
        ],
        ["Engine", "Downloads AnyPS5's engine for your system and checks it against GitHub's checksums."],
        [
          "AnyTogether",
          "Sign-in, friends, messages, parties and voice, play time and trophies, joining a friend's game.",
        ],
      ],
      links: [
        ["Repository", `${gh}/utkuhalis/AnyPS5-Desktop`],
        ["Releases", `${gh}/utkuhalis/AnyPS5-Desktop/releases`],
        ["Issues", `${gh}/utkuhalis/AnyPS5-Desktop/issues`],
      ],
      release: "desktop",
    },
    {
      repo: "utkuhalis/AnyTogether",
      name: "AnyTogether",
      license: "MIT",
      role: "Server · this website",
      lead: "The online home of the AnyPS5 launchers: the API, the realtime gateway and this website. Run your own with Docker Compose; every launcher and the phone can point at it.",
      parts: [
        [
          "Server",
          "apps/api (REST, Hono) and apps/realtime (WebSocket: presence, messages, signalling), PostgreSQL and Valkey.",
        ],
        [
          "Website",
          "apps/web, Next.js: profiles, friends, parties, share play, the Theme Hub and these pages.",
        ],
        ["Tests", "API tests against a real database, and e2e/: every client against one real stack."],
      ],
      links: [
        ["Repository", `${gh}/utkuhalis/AnyTogether`],
        ["Self-hosting guide", `${gh}/utkuhalis/AnyTogether/blob/main/docs/self-hosting.md`],
        ["Cross-client tests", `${gh}/utkuhalis/AnyTogether/blob/main/e2e/README.md`],
      ],
    },
  ] as [RepoCard, RepoCard, RepoCard],
  upstream: {
    title: "AnyPS5, upstream.",
    lead: "boykopovar/AnyPS5 is the open source PS5 compatibility layer everything here is built on: the relinker, the system libraries and the shader recompiler, for Linux and Windows. AnyPS5-ARM is its macOS port and merges its work back in.",
    credits:
      "Also thanks to {link}, the community macOS port that added Mach-O output, merged into AnyPS5-ARM.",
    repo: "Repository",
    discussions: "Game bring-up discussions",
  },
  licences: {
    title: "What you may do with it.",
    items: [
      [
        "GPL-2.0: AnyPS5-ARM, AnyPS5 Desktop",
        "Like the engine they are built on. Use, study, change and share them; what you share changed must stay GPL-2.0, with its source.",
      ],
      [
        "MIT: AnyTogether",
        "The server and this website. Run it, change it, build on it, keep the copyright notice.",
      ],
      [
        "No game files, ever",
        "None of these projects contains or offers game files, firmware or keys. You bring decrypted copies of games you own.",
      ],
    ] as [string, string][],
  },
  contribute: {
    title: "Make it better.",
    lead: "Bug reports from real games are the most useful thing anyone can send. So are pull requests, compatibility reports and themes.",
    items: [
      [
        "Report a crash",
        "When a game stops, the Mac launcher's Open Issue fills in the crash report template for you; attach the file Export Report saved.",
        `${gh}/utkuhalis/AnyPS5-ARM/issues/new?template=crash.yml`,
      ],
      [
        "Open an issue",
        "Bugs and performance problems have their own forms on AnyPS5-ARM; AnyPS5 Desktop and AnyTogether take plain issues.",
        `${gh}/utkuhalis/AnyPS5-ARM/issues/new/choose`,
      ],
      [
        "Send a pull request",
        "Fork, branch, and open a pull request against main. Keep it small and say what you tested.",
        `${gh}/utkuhalis/AnyPS5-ARM/pulls`,
      ],
      [
        "Tell how a game runs",
        "One tap after you play, or a report on the website: the community compatibility list grows from them.",
        "/compatibility",
      ],
      ["Share a theme", "Make one in the launcher's Theme Studio and share it on the Theme Hub.", "/themes"],
      [
        "Translate",
        "Everything is in English and Turkish today. Open an issue to start another language.",
        `${gh}/utkuhalis/AnyTogether/issues/new`,
      ],
    ] as [string, string, string][],
  },
  down: "GitHub's numbers are not here right now.",
};

export type ProjectsStrings = typeof en;

const tr: ProjectsStrings = {
  meta: {
    title: "Açık kaynak: tüm AnyPS5 ve AnyTogether depoları · AnyTogether",
    description:
      "AnyPS5-ARM (GPL-2.0), AnyPS5 Desktop (GPL-2.0), AnyTogether (MIT) ve upstream AnyPS5 motoru: her birinde ne var, dalları, lisansları ve nasıl katkıda bulunulur.",
  },
  kicker: "Açık kaynak",
  title: ["Her satır açık.", "İşte nerede durduğu."],
  lead: "AnyPS5 ve AnyTogether'ı üç depo oluşturuyor; hepsi upstream AnyPS5 motorunun üzerine kurulu. Hepsi GitHub'da: okumak, derlemek, çalıştırmak ve geliştirmek serbest.",
  stats: { stars: "yıldız", forks: "fork", issues: "açık sorun", pushed: "son gönderim {date}" },
  latest: "Son sürüm {version}",
  branches: "Dallar",
  inside: "İçinde neler var",
  repos: [
    {
      ...en.repos[0],
      role: "Motor · Mac launcher'ı · telefon uygulaması",
      lead: "AnyPS5'in Apple silicon için macOS uyarlaması, PS5 tarzı launcher AnyPS5.app ve telefonunu DualSense yapan AnyPS5 Remote. Sürümler her platformun dosyalarını taşır.",
      parts: [
        [
          "Motor",
          "Bir PS5 oyununu Mac uygulamasına çeviren relinker ve sistem kütüphaneleri: Mach-O çıktısı, Metal üzerinde MoltenVK ile Vulkan, oyunun kodu Rosetta 2 altında.",
        ],
        [
          "Launcher",
          "SwiftUI ile AnyPS5.app: kilit açma, kontroller, kupalar, kayıtlar, kare üretimi, birlikte oynama ve AnyTogether.",
        ],
        [
          "Telefon uygulaması",
          "iOS ve Android için Flutter ile AnyPS5 Remote: kumanda, hareket, titreşim, Remote Play ve çevrimiçi sayfalar.",
        ],
      ],
      links: [
        ["Depo", `${gh}/utkuhalis/AnyPS5-ARM`],
        ["Kullanım rehberi", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/user/GUIDE.md#türkçe`],
        ["Uyumluluk", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/user/COMPATIBILITY.md`],
        ["macOS uyarlama notları", `${gh}/utkuhalis/AnyPS5-ARM/blob/main/docs/dev/MACOS_PORT.md`],
      ],
      branches: [
        ["main", "Projenin tamamı: motor, launcher ve telefon uygulaması. Sürümler buradan çıkar."],
        ["launcher", "Yalnızca launcher: SwiftUI ile AnyPS5.app, macOS 14 ve sonrası için."],
        [
          "mobile-controller",
          "Yalnızca telefon uygulaması: tek Flutter kod tabanından Android ve iOS için AnyPS5 Remote.",
        ],
        ["rosetta", "Yalnızca motor; oyunun x86-64 kodu Rosetta 2 altında çalışır."],
        ["native-arm64", "Kendi x86-64'ten arm64'e çeviricisiyle motor: Rosetta'sız oyunlar."],
        ["anytogether", "AnyTogether'ın İngilizce ve Türkçe planı: neyin yapıldığı, neyin planlandığı."],
      ],
    },
    {
      ...en.repos[1],
      role: "Windows · Linux launcher'ı",
      lead: "PC'ler için AnyPS5-ARM launcher'ı: aynı PS5 tarzı ana ekran, oyunların kilidini açıp başlatma, oyun başına kontroller, kupalar, kayıtlar ve AnyTogether. Erken sürüm.",
      parts: [
        [
          "Launcher",
          "Windows 10/11 ve Linux x64 için Flutter; kurulum, AppImage, .deb ve taşınabilir sürümlerle.",
        ],
        ["Motor", "Sistemin için AnyPS5 motorunu indirir ve GitHub'ın sağlama toplamlarıyla doğrular."],
        [
          "AnyTogether",
          "Giriş, arkadaşlar, mesajlar, partiler ve ses, oyun süresi ve kupalar, arkadaşının oyununa katılma.",
        ],
      ],
      links: [
        ["Depo", `${gh}/utkuhalis/AnyPS5-Desktop`],
        ["Sürümler", `${gh}/utkuhalis/AnyPS5-Desktop/releases`],
        ["Sorunlar", `${gh}/utkuhalis/AnyPS5-Desktop/issues`],
      ],
    },
    {
      ...en.repos[2],
      role: "Sunucu · bu site",
      lead: "AnyPS5 launcher'larının çevrimiçi evi: API, anlık bağlantı sunucusu ve bu site. Docker Compose ile kendininkini çalıştır; her launcher ve telefon ona bağlanabilir.",
      parts: [
        [
          "Sunucu",
          "apps/api (REST, Hono) ve apps/realtime (WebSocket: çevrimiçi durumu, mesajlar, sinyalleşme), PostgreSQL ve Valkey.",
        ],
        [
          "Site",
          "apps/web, Next.js: profiller, arkadaşlar, partiler, birlikte oynama, Tema Merkezi ve bu sayfalar.",
        ],
        [
          "Testler",
          "Gerçek veritabanına karşı API testleri ve e2e/: tüm istemciler tek bir gerçek sunucuya karşı.",
        ],
      ],
      links: [
        ["Depo", `${gh}/utkuhalis/AnyTogether`],
        ["Kendi sunucunu kur", `${gh}/utkuhalis/AnyTogether/blob/main/docs/self-hosting.md`],
        ["İstemciler arası testler", `${gh}/utkuhalis/AnyTogether/blob/main/e2e/README.md`],
      ],
    },
  ],
  upstream: {
    title: "Upstream AnyPS5.",
    lead: "boykopovar/AnyPS5, buradaki her şeyin üzerine kurulduğu açık kaynak PS5 uyumluluk katmanı: Linux ve Windows için relinker, sistem kütüphaneleri ve gölgelendirici derleyicisi. AnyPS5-ARM onun macOS uyarlaması ve çalışmalarını düzenli olarak birleştirir.",
    credits:
      "Mach-O çıktısını ekleyen ve AnyPS5-ARM'a birleştirilen topluluk macOS uyarlaması {link} için de teşekkürler.",
    repo: "Depo",
    discussions: "Oyun çalıştırma tartışmaları",
  },
  licences: {
    title: "Onunla ne yapabilirsin.",
    items: [
      [
        "GPL-2.0: AnyPS5-ARM, AnyPS5 Desktop",
        "Üzerine kuruldukları motor gibi. Kullan, incele, değiştir ve paylaş; değiştirip paylaştığın da kaynağıyla birlikte GPL-2.0 kalmalı.",
      ],
      ["MIT: AnyTogether", "Sunucu ve bu site. Çalıştır, değiştir, üzerine kur; telif bildirimini koru."],
      [
        "Asla oyun dosyası yok",
        "Bu projelerin hiçbiri oyun dosyası, firmware ya da anahtar içermez veya sunmaz. Sahip olduğun oyunların şifresi çözülmüş kopyalarını sen getirirsin.",
      ],
    ],
  },
  contribute: {
    title: "Daha iyi yap.",
    lead: "Gerçek oyunlardan gelen hata raporları birinin gönderebileceği en faydalı şey. Pull request'ler, uyumluluk raporları ve temalar da öyle.",
    items: [
      [
        "Çökme bildir",
        "Bir oyun durduğunda Mac launcher'ının Sorun Aç düğmesi çökme raporu şablonunu senin için doldurur; Raporu Dışa Aktar'ın kaydettiği dosyayı ekle.",
        `${gh}/utkuhalis/AnyPS5-ARM/issues/new?template=crash.yml`,
      ],
      [
        "Sorun aç",
        "Hataların ve performans sorunlarının AnyPS5-ARM'da kendi formları var; AnyPS5 Desktop ve AnyTogether düz sorun kabul eder.",
        `${gh}/utkuhalis/AnyPS5-ARM/issues/new/choose`,
      ],
      [
        "Pull request gönder",
        "Fork'la, dal aç ve main'e karşı pull request aç. Küçük tut ve neyi denediğini yaz.",
        `${gh}/utkuhalis/AnyPS5-ARM/pulls`,
      ],
      [
        "Oyunun nasıl çalıştığını söyle",
        "Oynadıktan sonra tek dokunuş ya da sitede bir rapor: topluluk uyumluluk listesi bunlarla büyür.",
        "/compatibility",
      ],
      ["Tema paylaş", "Launcher'ın Tema Stüdyosu'nda bir tane yap ve Tema Merkezi'nde paylaş.", "/themes"],
      [
        "Çevir",
        "Bugün her şey İngilizce ve Türkçe. Başka bir dil başlatmak için bir sorun aç.",
        `${gh}/utkuhalis/AnyTogether/issues/new`,
      ],
    ],
  },
  down: "GitHub'ın sayıları şu an burada değil.",
};

export const projectsStrings = (language: Language): ProjectsStrings => (language === "tr" ? tr : en);
