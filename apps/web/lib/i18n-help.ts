import type { Language } from "./i18n";

/** The help page: first steps, questions and troubleshooting. Install steps per platform come from
 *  the downloads page's texts (i18n-download.ts). Answers may hold links as [text](href). English
 *  and Turkish. */

export interface Faq {
  id: string;
  q: string;
  a: string[];
}

const guide = "https://github.com/AnyTogether/AnyPS5-ARM/blob/main/docs/user/GUIDE.md";
const selfHosting = "https://github.com/AnyTogether/AnyTogether/blob/main/docs/self-hosting.md";
const crash = "https://github.com/AnyTogether/AnyPS5-ARM/issues/new?template=crash.yml";
const desktopIssues = "https://github.com/AnyTogether/AnyPS5-Desktop/issues/new";
const macCompat = "https://github.com/AnyTogether/AnyPS5-ARM/blob/main/docs/user/COMPATIBILITY.md";

const en = {
  meta: {
    title: "Help: install, first steps, questions and troubleshooting · AnyTogether",
    description:
      "How to install AnyPS5 on Mac, Windows, Linux and the phone, your first game, answers about games, performance, frame generation, phone pairing, share play and self-hosting, and what to do when something goes wrong.",
  },
  kicker: "Help",
  title: ["Get playing.", "And unstuck."],
  lead: "Installing on every platform, your first game, the questions people ask most, and what to try when something goes wrong. The user guide on GitHub goes deeper.",
  guide: "The full user guide",
  guideHref: guide,
  toc: {
    label: "On this page",
    install: "Install",
    start: "First steps",
    faq: "Questions",
    trouble: "Troubleshooting",
    more: "Still stuck",
  },
  install: {
    title: "Pick your platform.",
    lead: "Every file, with sizes and checksums, is on the downloads page.",
    files: "Files and checksums",
    needs: "Needs",
  },
  start: {
    title: "From download to playing.",
    steps: [
      [
        "Install the launcher",
        "AnyPS5-ARM on a Mac, AnyPS5 Desktop on Windows or Linux. On a PC, press Download the AnyPS5 engine on first start.",
      ],
      [
        "Choose your games folder",
        "The folder with the decrypted copies of your games; subfolders are scanned and games you add later show up on their own.",
      ],
      [
        "Unlock a game",
        "A game that is not converted yet shows a lock. Unlock relinks it for your computer; on a Mac the files are clones, so it takes no extra space.",
      ],
      [
        "Play",
        "Play starts it. ⋯ opens its settings: resolution, window, vertical sync, controls (keyboard and mouse to pad), trophies and more. A controller just works.",
      ],
      [
        "Pair your phone",
        "Open AnyPS5 Remote on the same Wi-Fi, confirm the four-digit code, and the phone is a DualSense: up to four phones, four players.",
      ],
      [
        "Sign in to AnyTogether (optional)",
        "Settings → AnyTogether: an email code, a passkey through the website, or one tap on your paired phone. Friends, parties, share play and trophies follow.",
      ],
    ] as [string, string][],
  },
  faq: {
    title: "Asked often.",
    items: [
      {
        id: "legal",
        q: "Is it legal? Where do the games come from?",
        a: [
          "AnyPS5 is not an emulator and has nothing from Sony in it: it relinks a game's own program to run natively, against system libraries written from scratch. It never talks to Sony's servers.",
          "You bring the games: decrypted copies of games you own. No game files, firmware or keys are offered anywhere on this site or in the projects, and asking for them gets you nowhere. Laws differ between countries; check what yours allows.",
        ],
      },
      {
        id: "games",
        q: "Which games work?",
        a: [
          `More every release. Players' reports for Mac, Windows and Linux are on the [community compatibility list](/compatibility); the games tested on macOS, with their frame rates, are in the [Mac compatibility list](${macCompat}).`,
          "Recent releases were tested on Cat Quest III, Hollow Knight: Silksong, Dreaming Sarah, Plants vs. Zombies: Replanted and DOOM. After you play, the launcher asks how it ran: one tap adds your report.",
        ],
      },
      {
        id: "performance",
        q: "How do I get the best performance?",
        a: [
          "The first run of a game compiles its shaders, so it can stutter; later runs load them from the shader cache. If a game misbehaves after an update, Clear Shader Cache in its settings gives it a clean start.",
          "Turn on the performance overlay in the game's settings to see the frame rate. On a Mac, keep it plugged in and out of Low Power Mode, and pick an output resolution for titles that offer one. A newer engine (Settings → Engine) often runs games better.",
        ],
      },
      {
        id: "framegen",
        q: "What is frame generation?",
        a: [
          "On the Mac, a frame is made between each two of the game's, from the motion between them, so a 60 fps game shows 120 on a 120 Hz display.",
          "Turn it on in a game's settings. It needs vertical sync, and turns itself off on a 60 Hz display, in Low Power Mode, and wherever it would cost the game frames.",
        ],
      },
      {
        id: "phone",
        q: "How do I pair my phone?",
        a: [
          "Install AnyPS5 Remote, keep the phone on the same Wi-Fi as the computer and open the launcher: the phone finds it. The first time, both show the same four-digit code to confirm; after that it connects by itself. If nothing is found, type the computer's address.",
          "On a Mac a cable works too: an iPhone connects through it by itself, an Android phone with USB debugging on and adb installed. Up to four phones play as four players. AnyPS5 Desktop pairs the phone as well; playing Windows and Linux games with it needs an engine built from AnyPS5-ARM, which is [on the roadmap](/roadmap).",
        ],
      },
      {
        id: "share-play",
        q: "How does share play work?",
        a: [
          "While a game runs on your Mac, open the Friends panel and choose Share play. Friends watch in their browser, on the phone or in their launcher, and you can let each one play as player 2, 3 or 4 with their own pad. Your controller stays player 1; take a pad back at any time.",
          "Up to four can watch (from three on, each gets 540p). macOS asks once for the screen recording permission; only the game is sent. In a browser, a controller works, and so does the keyboard.",
        ],
      },
      {
        id: "account",
        q: "Do I need an account?",
        a: [
          "No. Signed out, the launchers work exactly as before. An AnyTogether account adds friends, messages, parties and voice, share play, trophies on your profile and the Theme Hub. There is no password: an email code, a passkey or your phone.",
        ],
      },
      {
        id: "self-hosting",
        q: "Can I run my own server?",
        a: [
          `Yes. AnyTogether is MIT licensed and the whole server runs on one machine with Docker Compose; the [self-hosting guide](${selfHosting}) walks through it. Point the launchers and the phone at it in Settings → AnyTogether → Server.`,
        ],
      },
      {
        id: "crash",
        q: "A game crashed. How do I report it?",
        a: [
          `On a Mac, the launcher shows why the game stopped and opens its crash report. Export Report saves the log, macOS's crash report and your settings in one file; Open Issue opens a [filled-in GitHub issue](${crash}) with your name, email and tokens taken out. Attach the exported file.`,
          `For a hard bug, turn on Detailed Logging (Trace) in the game's options and play again. The log is at ~/Library/Logs/AnyPS5/<TITLE ID>.log. On Windows or Linux, [open an issue on AnyPS5 Desktop](${desktopIssues}).`,
        ],
      },
      {
        id: "update",
        q: "How do I update?",
        a: [
          "On a Mac with 0.2.8 or later, Settings → About offers the new version and replaces itself. The engine has its own updates in Settings → Engine, and a game unlocked with an older engine offers Update and Play, keeping saves and trophies. AnyPS5 Desktop checks for engine updates in Settings → AnyPS5 Engine.",
        ],
      },
      {
        id: "free",
        q: "Does it cost anything?",
        a: [
          "No. Everything is free and open source, nothing is sold and nothing tracks you. Your AnyTogether data is yours to export or delete from Settings.",
        ],
      },
    ] as Faq[],
  },
  trouble: {
    title: "When something goes wrong.",
    items: [
      [
        "macOS says the app can't be opened",
        "Open System Settings → Privacy & Security and click Open Anyway. Or install with the Terminal one-liner: what curl downloads is not quarantined, so there is no warning.",
      ],
      [
        "A game says it is encrypted",
        "AnyPS5 needs a decrypted copy of the game. An encrypted dump is reported instead of converted.",
      ],
      [
        "A game stops at start or on a black screen",
        "Read the reason the launcher shows, then check the compatibility list. Try another engine version in Settings → Engine, and send a crash report.",
      ],
      [
        "Stutters the first time",
        "Shaders are being compiled; later runs load them from the cache. Clear Shader Cache only when a game misbehaves.",
      ],
      [
        "The phone does not find the computer",
        "Same Wi-Fi on both, allow local network access if the phone asks, and allow the firewall prompt on Windows. Or type the computer's address in the phone app.",
      ],
      [
        "Windows protected your PC",
        "SmartScreen does not know the installer yet: click More info → Run anyway.",
      ],
      [
        "Linux: the launcher runs but games do not",
        "Games run through AnyPS5's current Linux engine, which needs glibc 2.38 or newer (Ubuntu 24.04, Debian 13, Fedora 39 or newer).",
      ],
      [
        "Share play viewers see nothing",
        "Allow AnyPS5 in System Settings → Privacy & Security → Screen Recording, then start share play again.",
      ],
    ] as [string, string][],
  },
  more: {
    title: "Still stuck?",
    lead: "The user guide has every setting and the details behind them. If something is broken, an issue with a crash report helps the most.",
    guide: "Read the user guide",
    issue: "Report a crash",
    contribute: "Other ways to help",
  },
};

export type HelpStrings = typeof en;

const tr: HelpStrings = {
  meta: {
    title: "Yardım: kurulum, ilk adımlar, sorular ve sorun giderme · AnyTogether",
    description:
      "AnyPS5'i Mac, Windows, Linux ve telefona kurmak, ilk oyunun, oyunlar, performans, kare üretimi, telefon eşleştirme, birlikte oynama ve kendi sunucun hakkında yanıtlar, ve bir şeyler ters gittiğinde ne yapılacağı.",
  },
  kicker: "Yardım",
  title: ["Oynamaya başla.", "Takıldığın yerden kurtul."],
  lead: "Her platformda kurulum, ilk oyunun, en çok sorulanlar ve bir şeyler ters gittiğinde denenecekler. GitHub'daki kullanım rehberi daha ayrıntılı.",
  guide: "Tüm kullanım rehberi",
  guideHref: `${guide}#türkçe`,
  toc: {
    label: "Bu sayfada",
    install: "Kurulum",
    start: "İlk adımlar",
    faq: "Sorular",
    trouble: "Sorun giderme",
    more: "Hâlâ takıldıysan",
  },
  install: {
    title: "Platformunu seç.",
    lead: "Boyutları ve sağlama toplamlarıyla her dosya indirme sayfasında.",
    files: "Dosyalar ve sağlama toplamları",
    needs: "Gerekenler",
  },
  start: {
    title: "İndirmekten oynamaya.",
    steps: [
      [
        "Launcher'ı kur",
        "Mac'te AnyPS5-ARM, Windows ya da Linux'ta AnyPS5 Desktop. PC'de ilk açılışta AnyPS5 motorunu indir'e bas.",
      ],
      [
        "Oyun klasörünü seç",
        "Oyunlarının şifresi çözülmüş kopyalarının olduğu klasör; alt klasörler de taranır, sonradan eklediğin oyunlar kendiliğinden görünür.",
      ],
      [
        "Bir oyunun kilidini aç",
        "Henüz dönüştürülmemiş oyunda kilit görünür. Kilidi Aç onu bilgisayarın için yeniden bağlar; Mac'te dosyalar kopya değil klon olduğundan ek yer kaplamaz.",
      ],
      [
        "Oyna",
        "Oyna başlatır. ⋯ ayarlarını açar: çözünürlük, pencere, dikey eşitleme, kontroller (klavye ve fareyle kumanda), kupalar ve fazlası. Kumanda doğrudan çalışır.",
      ],
      [
        "Telefonunu eşleştir",
        "AnyPS5 Remote'u aynı Wi-Fi'da aç, dört haneli kodu onayla; telefon artık bir DualSense: dört telefona kadar, dört oyuncu.",
      ],
      [
        "AnyTogether'a giriş yap (isteğe bağlı)",
        "Ayarlar → AnyTogether: e-posta kodu, site üzerinden passkey ya da eşleşmiş telefonda tek dokunuş. Arkadaşlar, partiler, birlikte oynama ve kupalar gelir.",
      ],
    ],
  },
  faq: {
    title: "Sık sorulanlar.",
    items: [
      {
        id: "legal",
        q: "Yasal mı? Oyunlar nereden geliyor?",
        a: [
          "AnyPS5 bir emülatör değil ve içinde Sony'den hiçbir şey yok: oyunun kendi programını, sıfırdan yazılmış sistem kütüphanelerine bağlayıp yerel olarak çalıştırır. Sony'nin sunucularıyla asla konuşmaz.",
          "Oyunları sen getirirsin: sahip olduğun oyunların şifresi çözülmüş kopyaları. Bu sitede ya da projelerde hiçbir yerde oyun dosyası, firmware ya da anahtar sunulmaz; istemek de bir yere götürmez. Yasalar ülkeden ülkeye değişir; seninkinin neye izin verdiğine bak.",
        ],
      },
      {
        id: "games",
        q: "Hangi oyunlar çalışıyor?",
        a: [
          `Her sürümde daha fazlası. Mac, Windows ve Linux için oyuncuların raporları [topluluk uyumluluk listesinde](/compatibility); macOS'ta denenen oyunlar kare hızlarıyla [Mac uyumluluk listesinde](${macCompat}).`,
          "Son sürümler Cat Quest III, Hollow Knight: Silksong, Dreaming Sarah, Plants vs. Zombies: Replanted ve DOOM'da denendi. Oynadıktan sonra launcher nasıl çalıştığını sorar: tek dokunuş raporunu ekler.",
        ],
      },
      {
        id: "performance",
        q: "En iyi performansı nasıl alırım?",
        a: [
          "Bir oyunun ilk açılışında gölgelendiricileri derlenir, bu yüzden takılabilir; sonraki açılışlar onları önbellekten yükler. Bir güncellemeden sonra oyun tuhaf davranırsa, ayarlarındaki Gölgelendirici Önbelleğini Temizle temiz bir başlangıç sağlar.",
          "Kare hızını görmek için oyunun ayarlarından performans göstergesini aç. Mac'te fişe takılı tut, Düşük Güç Modu'nda oynama ve sunan oyunlarda bir çıkış çözünürlüğü seç. Daha yeni bir motor (Ayarlar → Motor) çoğu zaman oyunları daha iyi çalıştırır.",
        ],
      },
      {
        id: "framegen",
        q: "Kare üretimi nedir?",
        a: [
          "Mac'te, oyunun her iki karesi arasına aradaki hareketten bir kare üretilir; böylece 60 fps bir oyun 120 Hz ekranda 120 gösterir.",
          "Bir oyunun ayarlarından açılır. Dikey eşitleme gerekir; 60 Hz ekranda, Düşük Güç Modu'nda ve oyuna kare kaybettireceği her yerde kendini kapatır.",
        ],
      },
      {
        id: "phone",
        q: "Telefonumu nasıl eşleştiririm?",
        a: [
          "AnyPS5 Remote'u kur, telefonu bilgisayarla aynı Wi-Fi'da tut ve launcher'ı aç: telefon onu bulur. İlk seferde ikisi de aynı dört haneli kodu gösterir, onaylarsın; sonra kendiliğinden bağlanır. Bir şey bulunmazsa bilgisayarın adresini yaz.",
          "Mac'te kablo da olur: iPhone onunla kendiliğinden bağlanır, Android telefon USB hata ayıklama açık ve Mac'te adb kuruluyken. Dört telefona kadar dört oyuncu. AnyPS5 Desktop da telefonu eşleştirir; Windows ve Linux oyunlarında onunla oynamak için AnyPS5-ARM'dan derlenmiş bir motor gerekiyor, bu [yol haritasında](/roadmap).",
        ],
      },
      {
        id: "share-play",
        q: "Birlikte oynama nasıl çalışıyor?",
        a: [
          "Mac'inde bir oyun çalışırken Arkadaşlar panelini aç ve Birlikte oyna'yı seç. Arkadaşların tarayıcıda, telefonda ya da launcher'larında izler; her birine kendi kumandasıyla 2., 3. ya da 4. oyuncu olarak oynama izni verebilirsin. Senin kumandan 1. oyuncu kalır; bir kumandayı istediğin an geri alırsın.",
          "En çok dört kişi izleyebilir (üçten itibaren her biri 540p alır). macOS bir kez ekran kaydı izni ister; yalnızca oyun gönderilir. Tarayıcıda kumanda da klavye de çalışır.",
        ],
      },
      {
        id: "account",
        q: "Hesap gerekiyor mu?",
        a: [
          "Hayır. Giriş yapmadan launcher'lar tam önceki gibi çalışır. Bir AnyTogether hesabı arkadaşları, mesajları, partileri ve sesi, birlikte oynamayı, profilindeki kupaları ve Tema Merkezi'ni ekler. Şifre yok: e-posta kodu, passkey ya da telefonun.",
        ],
      },
      {
        id: "self-hosting",
        q: "Kendi sunucumu çalıştırabilir miyim?",
        a: [
          `Evet. AnyTogether MIT lisanslı ve tüm sunucu tek makinede Docker Compose ile çalışır; [kurulum rehberi](${selfHosting}) adım adım anlatır. Launcher'ları ve telefonu Ayarlar → AnyTogether → Sunucu'dan ona yönlendir.`,
        ],
      },
      {
        id: "crash",
        q: "Bir oyun çöktü. Nasıl bildiririm?",
        a: [
          `Mac'te launcher oyunun neden durduğunu gösterir ve çökme raporunu açar. Raporu Dışa Aktar günlüğü, macOS'un çökme raporunu ve ayarlarını tek dosyaya kaydeder; Sorun Aç, adın, e-postan ve anahtarların çıkarılmış [hazır bir GitHub sorunu](${crash}) açar. Dışa aktardığın dosyayı ekle.`,
          `Zor bir hata için oyunun seçeneklerinden Ayrıntılı Günlük'ü (Trace) aç ve yeniden oyna. Günlük ~/Library/Logs/AnyPS5/<TITLE ID>.log konumunda. Windows ya da Linux'ta [AnyPS5 Desktop'ta bir sorun aç](${desktopIssues}).`,
        ],
      },
      {
        id: "update",
        q: "Nasıl güncellerim?",
        a: [
          "0.2.8 ve sonrası olan bir Mac'te Ayarlar → Hakkında yeni sürümü sunar ve kendini değiştirir. Motorun güncellemeleri Ayarlar → Motor'da; eski bir motorla kilidi açılmış oyun, kayıtları ve kupaları koruyarak Güncelle ve Oyna sunar. AnyPS5 Desktop motor güncellemelerini Ayarlar → AnyPS5 Motoru'nda denetler.",
        ],
      },
      {
        id: "free",
        q: "Ücretli mi?",
        a: [
          "Hayır. Her şey ücretsiz ve açık kaynak; hiçbir şey satılmaz, hiçbir şey seni takip etmez. AnyTogether verilerin senin: Ayarlar'dan dışa aktar ya da sil.",
        ],
      },
    ],
  },
  trouble: {
    title: "Bir şeyler ters gittiğinde.",
    items: [
      [
        "macOS uygulamanın açılamayacağını söylüyor",
        "Sistem Ayarları → Gizlilik ve Güvenlik'i aç ve Yine de Aç'a tıkla. Ya da Terminal'deki tek satırla kur: curl'ün indirdiği karantinaya alınmaz, uyarı çıkmaz.",
      ],
      [
        "Oyun şifreli olduğunu söylüyor",
        "AnyPS5, oyunun şifresi çözülmüş bir kopyasına ihtiyaç duyar. Şifreli bir dump dönüştürülmez, bildirilir.",
      ],
      [
        "Oyun açılışta ya da siyah ekranda duruyor",
        "Launcher'ın gösterdiği nedeni oku, sonra uyumluluk listesine bak. Ayarlar → Motor'dan başka bir motor sürümü dene ve bir çökme raporu gönder.",
      ],
      [
        "İlk seferde takılıyor",
        "Gölgelendiriciler derleniyor; sonraki açılışlar önbellekten yükler. Gölgelendirici önbelleğini yalnızca oyun tuhaf davranırsa temizle.",
      ],
      [
        "Telefon bilgisayarı bulamıyor",
        "İkisi de aynı Wi-Fi'da olsun, telefon sorarsa yerel ağ erişimine izin ver, Windows'ta güvenlik duvarı sorusuna izin ver. Ya da telefon uygulamasına bilgisayarın adresini yaz.",
      ],
      [
        "Windows bilgisayarınızı korudu",
        "SmartScreen kurulumu henüz tanımıyor: Ek bilgi → Yine de çalıştır'a tıkla.",
      ],
      [
        "Linux: launcher çalışıyor ama oyunlar çalışmıyor",
        "Oyunlar AnyPS5'in güncel Linux motoruyla çalışır; glibc 2.38 ya da sonrası gerekir (Ubuntu 24.04, Debian 13, Fedora 39 ve sonrası).",
      ],
      [
        "Birlikte oynamada izleyiciler bir şey görmüyor",
        "Sistem Ayarları → Gizlilik ve Güvenlik → Ekran Kaydı'nda AnyPS5'e izin ver, sonra birlikte oynamayı yeniden başlat.",
      ],
    ],
  },
  more: {
    title: "Hâlâ takıldın mı?",
    lead: "Kullanım rehberinde her ayar ve arkasındaki ayrıntılar var. Bir şey bozuksa, çökme raporlu bir sorun en çok işe yarar.",
    guide: "Kullanım rehberini oku",
    issue: "Çökme bildir",
    contribute: "Yardım etmenin diğer yolları",
  },
};

export const helpStrings = (language: Language): HelpStrings => (language === "tr" ? tr : en);
