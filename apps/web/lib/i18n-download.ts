import type { FileKind, Platform } from "./downloads";
import type { Language } from "./i18n";

/** The downloads page: every file of the latest releases, what each one is, how to install it and
 *  what it needs. English and Turkish. */

interface PlatformGuide {
  steps: string[];
  requirements: [string, string][];
}

const en = {
  meta: {
    title: "Download AnyPS5 for Mac, Windows, Linux, iPhone and Android · AnyTogether",
    description:
      "Every file of the latest AnyPS5-ARM and AnyPS5 Desktop releases, with version, size, date and SHA-256, grouped by platform with install steps and requirements.",
  },
  kicker: "Download",
  title: ["Every file.", "Every screen you own."],
  lead: "The latest releases of AnyPS5-ARM and AnyPS5 Desktop, straight from GitHub: each file with its version, size, date and checksum, and how to install it.",
  allReleases: "All releases on GitHub",
  latestOf: "{name} {version}",
  releasedOn: "released {date}",
  down: "GitHub is not answering right now, so the sizes and checksums are missing. These links always lead to the newest files:",
  onThisPage: "Platforms",
  yourSystem: "Your system",
  install: "Install",
  requirements: "Requirements",
  download: "Download",
  downloadName: "Download {name}",
  version: "Version",
  size: "Size",
  date: "Date",
  sha: "SHA-256",
  copy: "Copy",
  copied: "Copied",
  copySha: "Copy the SHA-256 of {name}",
  inTerminal: "Or in Terminal",
  noFiles: "This release has no file for this platform yet.",
  otherTitle: "Other files",
  otherLead: "Also attached to the releases.",
  kinds: {
    app: ["The launcher", "AnyPS5.app, zipped: unzip and open it."],
    script: ["One-line installer", "Puts AnyPS5.app in Applications, with Rosetta 2 if it is missing."],
    engine: ["Engine", "For the launcher's engine picker. The launcher downloads it for you."],
    installer: ["Installer", "Installs for your user, no admin needed, with an uninstaller."],
    portable: ["Portable", "Unzip anywhere and run anyps5_desktop.exe."],
    appimage: ["AppImage", "Any distribution: make it executable and run it."],
    deb: ["Debian package", "Ubuntu and Debian: install it with apt."],
    archive: ["Archive", "Unpack it and run AnyPS5-Desktop/anyps5_desktop."],
    apk: ["Android app", "AnyPS5 Remote: open it on the phone."],
    ipa: ["iPhone app", "AnyPS5 Remote: sideload it with your own Apple ID."],
    other: ["File", "Attached to the release."],
  } satisfies Record<FileKind, [string, string]>,
  products: {
    mac: "AnyPS5-ARM",
    windows: "AnyPS5 Desktop",
    linux: "AnyPS5 Desktop",
    iphone: "AnyPS5 Remote",
    android: "AnyPS5 Remote",
  } satisfies Record<Platform, string>,
  guides: {
    mac: {
      steps: [
        "Paste the one-line installer into Terminal. It puts AnyPS5.app in Applications and installs Rosetta 2 if it is missing; macOS opens it without a warning.",
        "Or unzip AnyPS5-macOS.zip and open the app. The first time, open System Settings → Privacy & Security and click Open Anyway.",
        "Pick the language, a theme and the folder with your games. Already on 0.2.8 or later? Settings → About updates it.",
      ],
      requirements: [
        ["Mac", "Apple silicon (M1 or later)"],
        ["macOS", "14 Sonoma or later"],
        ["Also", "Rosetta 2, installed for you"],
        ["Games", "Decrypted copies of games you own"],
      ],
    },
    windows: {
      steps: [
        "Run the Setup .exe. It installs for your user, no admin needed, with a Start menu shortcut and an uninstaller.",
        "If SmartScreen says “Windows protected your PC”, click More info → Run anyway. Rather not install? Unzip the portable .zip and run anyps5_desktop.exe.",
        "On first start press Download the AnyPS5 engine, choose your games folder, and allow the firewall prompt if you want to pair your phone.",
      ],
      requirements: [
        ["Windows", "10 or 11, x64"],
        ["Hardware", "A CPU and GPU that AnyPS5 supports"],
        ["Status", "Early preview"],
        ["Games", "Decrypted copies of games you own"],
      ],
    },
    linux: {
      steps: [
        "AppImage: chmod +x the file, then run it.",
        "Ubuntu or Debian: sudo apt install ./anyps5-desktop_…_amd64.deb. Or unpack the .tar.gz and run AnyPS5-Desktop/anyps5_desktop.",
        "On first start press Download the AnyPS5 engine and choose your games folder.",
      ],
      requirements: [
        ["Launcher", "x64, glibc 2.34+ (Ubuntu 22.04 or newer), GTK 3"],
        ["Engine", "glibc 2.38+ for games (Ubuntu 24.04, Debian 13, Fedora 39 or newer)"],
        ["Status", "Early preview"],
        ["Games", "Decrypted copies of games you own"],
      ],
    },
    iphone: {
      steps: [
        "Download AnyPS5-Remote.ipa on your computer.",
        "Install it with AltStore, SideStore or Sideloadly, which sign it with your own Apple ID.",
        "Open the launcher on the same Wi-Fi (or plug the iPhone into the Mac) and confirm the four-digit code on both.",
      ],
      requirements: [
        ["iPhone", "iOS 15 or later"],
        ["Computer", "AnyPS5 on a Mac, Windows or Linux"],
        ["Network", "The same Wi-Fi, or a cable on a Mac"],
      ],
    },
    android: {
      steps: [
        "Open AnyPS5-Remote.apk on the phone.",
        "Allow installing from your browser when Android asks.",
        "Open the launcher on the same Wi-Fi and confirm the four-digit code on both.",
      ],
      requirements: [
        ["Android", "7.0 or later"],
        ["Computer", "AnyPS5 on a Mac, Windows or Linux"],
        ["Network", "The same Wi-Fi, or USB debugging and a cable on a Mac"],
      ],
    },
  } satisfies Record<Platform, PlatformGuide>,
  verify: {
    kicker: "Checksums",
    title: "Check what you downloaded.",
    lead: "The SHA-256 beside each file is GitHub's own digest of the uploaded file. Work out your copy's and compare the two:",
    mac: "macOS",
    linux: "Linux",
    windows: "Windows (PowerShell)",
  },
  onlyOurs:
    "Only AnyPS5's own software is offered here. Never game files, firmware or keys: you bring decrypted copies of games you own.",
  older: "Older versions and their notes are on the {link}.",
  changelog: "changelog",
  specs: "Every feature, on one sheet",
};

export type DownloadPageStrings = typeof en;

const tr: DownloadPageStrings = {
  meta: {
    title: "Mac, Windows, Linux, iPhone ve Android için AnyPS5'i indir · AnyTogether",
    description:
      "AnyPS5-ARM ve AnyPS5 Desktop'ın son sürümlerindeki her dosya; sürümü, boyutu, tarihi ve SHA-256'sıyla, platforma göre, kurulum adımları ve gereksinimleriyle.",
  },
  kicker: "İndir",
  title: ["Her dosya.", "Sahip olduğun her ekran."],
  lead: "AnyPS5-ARM ve AnyPS5 Desktop'ın son sürümleri, doğrudan GitHub'dan: her dosya sürümü, boyutu, tarihi ve sağlama toplamıyla, nasıl kurulacağıyla birlikte.",
  allReleases: "GitHub'da tüm sürümler",
  latestOf: "{name} {version}",
  releasedOn: "{date} tarihinde çıktı",
  down: "GitHub şu an yanıt vermiyor; boyutlar ve sağlama toplamları eksik. Bu bağlantılar her zaman en yeni dosyalara gider:",
  onThisPage: "Platformlar",
  yourSystem: "Senin sistemin",
  install: "Kurulum",
  requirements: "Gereksinimler",
  download: "İndir",
  downloadName: "{name} dosyasını indir",
  version: "Sürüm",
  size: "Boyut",
  date: "Tarih",
  sha: "SHA-256",
  copy: "Kopyala",
  copied: "Kopyalandı",
  copySha: "{name} SHA-256 değerini kopyala",
  inTerminal: "Ya da Terminal'de",
  noFiles: "Bu sürümde bu platform için henüz dosya yok.",
  otherTitle: "Diğer dosyalar",
  otherLead: "Sürümlere ekli diğer dosyalar.",
  kinds: {
    app: ["Launcher", "AnyPS5.app, zip içinde: aç ve çalıştır."],
    script: ["Tek satırlık kurulum", "AnyPS5.app'i Uygulamalar'a koyar; eksikse Rosetta 2'yi de kurar."],
    engine: ["Motor", "Launcher'ın motor seçicisi için. Launcher senin yerine indirir."],
    installer: ["Kurulum", "Kullanıcın için kurar, yönetici gerekmez; kaldırıcısı da var."],
    portable: ["Taşınabilir", "Herhangi bir yere aç ve anyps5_desktop.exe'yi çalıştır."],
    appimage: ["AppImage", "Her dağıtımda: çalıştırılabilir yap ve aç."],
    deb: ["Debian paketi", "Ubuntu ve Debian: apt ile kur."],
    archive: ["Arşiv", "Aç ve AnyPS5-Desktop/anyps5_desktop'ı çalıştır."],
    apk: ["Android uygulaması", "AnyPS5 Remote: telefonda aç."],
    ipa: ["iPhone uygulaması", "AnyPS5 Remote: kendi Apple kimliğinle yükle."],
    other: ["Dosya", "Sürüme ekli."],
  },
  products: en.products,
  guides: {
    mac: {
      steps: [
        "Tek satırlık kurulumu Terminal'e yapıştır. AnyPS5.app'i Uygulamalar'a koyar, eksikse Rosetta 2'yi kurar; macOS uyarı vermeden açar.",
        "Ya da AnyPS5-macOS.zip'i aç ve uygulamayı çalıştır. İlk seferde Sistem Ayarları → Gizlilik ve Güvenlik'te Yine de Aç'a tıkla.",
        "Dili, bir temayı ve oyunlarının klasörünü seç. Zaten 0.2.8 ya da sonrası mı var? Ayarlar → Hakkında günceller.",
      ],
      requirements: [
        ["Mac", "Apple silicon (M1 ve sonrası)"],
        ["macOS", "14 Sonoma ve sonrası"],
        ["Ayrıca", "Rosetta 2, senin için kurulur"],
        ["Oyunlar", "Sahip olduğun oyunların şifresi çözülmüş kopyaları"],
      ],
    },
    windows: {
      steps: [
        "Setup .exe'yi çalıştır. Kullanıcın için kurar, yönetici gerekmez; Başlat menüsü kısayolu ve kaldırıcısı olur.",
        "SmartScreen “Windows bilgisayarınızı korudu” derse Ek bilgi → Yine de çalıştır'a tıkla. Kurmak istemiyor musun? Taşınabilir .zip'i aç ve anyps5_desktop.exe'yi çalıştır.",
        "İlk açılışta AnyPS5 motorunu indir'e bas, oyun klasörünü seç; telefonu eşleştireceksen güvenlik duvarı sorusuna izin ver.",
      ],
      requirements: [
        ["Windows", "10 ya da 11, x64"],
        ["Donanım", "AnyPS5'in desteklediği bir işlemci ve ekran kartı"],
        ["Durum", "Erken sürüm"],
        ["Oyunlar", "Sahip olduğun oyunların şifresi çözülmüş kopyaları"],
      ],
    },
    linux: {
      steps: [
        "AppImage: dosyaya chmod +x ver, sonra çalıştır.",
        "Ubuntu ya da Debian: sudo apt install ./anyps5-desktop_…_amd64.deb. Ya da .tar.gz'yi aç ve AnyPS5-Desktop/anyps5_desktop'ı çalıştır.",
        "İlk açılışta AnyPS5 motorunu indir'e bas ve oyun klasörünü seç.",
      ],
      requirements: [
        ["Launcher", "x64, glibc 2.34+ (Ubuntu 22.04 ve sonrası), GTK 3"],
        ["Motor", "Oyunlar için glibc 2.38+ (Ubuntu 24.04, Debian 13, Fedora 39 ve sonrası)"],
        ["Durum", "Erken sürüm"],
        ["Oyunlar", "Sahip olduğun oyunların şifresi çözülmüş kopyaları"],
      ],
    },
    iphone: {
      steps: [
        "AnyPS5-Remote.ipa'yı bilgisayarına indir.",
        "AltStore, SideStore ya da Sideloadly ile kur; uygulamayı kendi Apple kimliğinle imzalarlar.",
        "Launcher'ı aynı Wi-Fi'da aç (ya da iPhone'u Mac'e kabloyla tak) ve dört haneli kodu iki tarafta da onayla.",
      ],
      requirements: [
        ["iPhone", "iOS 15 ve sonrası"],
        ["Bilgisayar", "Mac, Windows ya da Linux'ta AnyPS5"],
        ["Ağ", "Aynı Wi-Fi, ya da Mac'te kablo"],
      ],
    },
    android: {
      steps: [
        "AnyPS5-Remote.apk'yı telefonda aç.",
        "Android sorduğunda tarayıcından kurmaya izin ver.",
        "Launcher'ı aynı Wi-Fi'da aç ve dört haneli kodu iki tarafta da onayla.",
      ],
      requirements: [
        ["Android", "7.0 ve sonrası"],
        ["Bilgisayar", "Mac, Windows ya da Linux'ta AnyPS5"],
        ["Ağ", "Aynı Wi-Fi, ya da Mac'te USB hata ayıklama ve kablo"],
      ],
    },
  },
  verify: {
    kicker: "Sağlama toplamları",
    title: "İndirdiğini doğrula.",
    lead: "Her dosyanın yanındaki SHA-256, GitHub'ın yüklenen dosya için hesapladığı değerdir. Kendi kopyanınkini hesapla ve ikisini karşılaştır:",
    mac: "macOS",
    linux: "Linux",
    windows: "Windows (PowerShell)",
  },
  onlyOurs:
    "Burada yalnızca AnyPS5'in kendi yazılımı var. Asla oyun dosyası, firmware ya da anahtar yok: sahip olduğun oyunların şifresi çözülmüş kopyalarını sen getirirsin.",
  older: "Eski sürümler ve notları {link} sayfasında.",
  changelog: "sürüm notları",
  specs: "Her özellik, tek sayfada",
};

export const downloadPageStrings = (language: Language): DownloadPageStrings => (language === "tr" ? tr : en);
