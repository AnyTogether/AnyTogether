/** The full specs sheet (/specs): every feature of AnyPS5-ARM (the engine, the Mac launcher, the
 *  phone app), AnyPS5 Desktop and AnyTogether, grouped by product, in English and Turkish. Only
 *  what exists goes here: what is merely planned belongs on the roadmap (lib/roadmap.ts) and the
 *  status board (content/status.ts). Built from the READMEs, docs/ and release notes of the three
 *  repositories, checked on `checked`.
 *
 *  - `exp`: experimental, off by default or not yet proven on many games.
 *  - `next`: merged on main but not in a published release yet. The page compares the version
 *    with the latest published release, so the tag goes away by itself once that release is out.
 *    `on` narrows it to some platforms (a feature already out on Windows and Linux, say, that the
 *    Mac gets in its next release). */

import type { Language } from "./i18n";

import { type SpecPlatform, specPlatforms } from "./spec-platforms";

export { type SpecPlatform, searchable, specPlatforms } from "./spec-platforms";

export type Project = "macos" | "desktop";
export interface NextRelease {
  project: Project;
  version: string;
  on?: SpecPlatform[];
}

type Pair = readonly [title: string, line: string];
export interface Spec {
  p: SpecPlatform[];
  en: Pair;
  tr: Pair;
  exp?: true;
  next?: NextRelease;
}
export interface SpecGroup {
  id: string;
  en: string;
  tr: string;
  items: Spec[];
}
export type SectionId = "engine" | "mac" | "desktop" | "phone" | "online" | "more";
export interface SpecSection {
  id: SectionId;
  /** The prefix of its items' reference codes: ENG-01, MAC-12. */
  code: string;
  groups: SpecGroup[];
}

/** When the sheet was last checked against the repositories and their releases. */
export const checked = "2026-10-26";

/** The newest published versions when the sheet was checked, for when the release list cannot be
 *  reached. */
export const publishedWhenChecked: Record<Project, string> = { macos: "0.2.23", desktop: "0.1.9" };

const M: SpecPlatform[] = ["mac"];
const PC: SpecPlatform[] = ["windows", "linux"];
const LIN: SpecPlatform[] = ["linux"];
const DESK: SpecPlatform[] = ["mac", "windows", "linux"];
const PHONE: SpecPlatform[] = ["iphone", "android"];
const WEB: SpecPlatform[] = ["web"];
const EVERY: SpecPlatform[] = ["mac", "windows", "linux", "iphone", "android", "web"];
const APPS: SpecPlatform[] = ["mac", "windows", "linux", "iphone", "android"];
const MAC_PHONE_WEB: SpecPlatform[] = ["mac", "iphone", "android", "web"];
const DESK_WEB: SpecPlatform[] = ["mac", "windows", "linux", "web"];

const EXP = { exp: true } as const;
const MAC_0_2_23 = { next: { project: "macos", version: "0.2.23" } } as const;
const MAC_AFTER_0_2_23 = { next: { project: "macos", version: "0.2.24" } } as const;

const s = (p: SpecPlatform[], en: Pair, tr: Pair, extra: { exp?: true; next?: NextRelease } = {}): Spec => ({
  p,
  en,
  tr,
  ...extra,
});

export const sections: SpecSection[] = [
  {
    id: "engine",
    code: "ENG",
    groups: [
      {
        id: "approach",
        en: "How it runs",
        tr: "Nasıl çalışır",
        items: [
          s(
            DESK,
            [
              "Relinked, not emulated",
              "The relinker turns a PS5 executable into a native program, linked against the console's system libraries rebuilt as ordinary shared libraries.",
            ],
            [
              "Emülasyon değil, yeniden bağlama",
              "Relinker PS5 çalıştırılabilirini yerel bir programa çevirir; konsolun sistem kütüphaneleri sıradan paylaşımlı kütüphaneler olarak yeniden yazıldı.",
            ],
          ),
          s(
            M,
            [
              "Rosetta 2 on Apple silicon",
              "The game's x86-64 code runs under Rosetta 2, the relinker writes a Mach-O executable, and the result is a normal .app you open from Finder.",
            ],
            [
              "Apple silicon'da Rosetta 2",
              "Oyunun x86-64 kodu Rosetta 2 altında çalışır, relinker Mach-O yazar; sonuç Finder'dan açılan sıradan bir .app'tir.",
            ],
          ),
          s(
            M,
            [
              "Native arm64 engine",
              "On the native-arm64 branch, game code is translated to arm64 ahead of time with LLVM: DOOM plays E1M1 at its own 35 FPS, no Rosetta in the process.",
            ],
            [
              "Yerel arm64 motoru",
              "native-arm64 dalında oyun kodu LLVM ile önceden arm64'e çevrilir: DOOM, süreçte Rosetta olmadan E1M1'i kendi 35 FPS'iyle oynatır.",
            ],
            EXP,
          ),
          s(
            PC,
            [
              "Our own Windows and Linux engine",
              "Releases carry AnyPS5-ARM's toolkit for Windows (WinLibs GCC) and Linux (Ubuntu 22.04, glibc 2.35), with the online bridge and the phone pad.",
            ],
            [
              "Kendi Windows ve Linux motorumuz",
              "Sürümler AnyPS5-ARM'ın Windows (WinLibs GCC) ve Linux (Ubuntu 22.04, glibc 2.35) araç setini taşır; çevrimiçi köprü ve telefon kumandası dahil.",
            ],
          ),
          s(
            DESK,
            [
              "Level with upstream",
              "Upstream AnyPS5's work is merged in again and again (1,465 commits in one sync), its new code made to work on macOS.",
            ],
            [
              "Upstream ile aynı seviyede",
              "Upstream AnyPS5'in çalışmaları tekrar tekrar alınır (tek seferde 1.465 commit), yeni kodu macOS'ta çalışır hale getirilir.",
            ],
          ),
          s(
            M,
            [
              "Self-contained game apps",
              "An unlocked game is one .app with its libraries, MoltenVK, per-title patches and a launch script inside; it starts from Finder too.",
            ],
            [
              "Kendi içinde oyun uygulamaları",
              "Kilidi açılan oyun; kütüphaneleri, MoltenVK, oyuna özel yamaları ve başlatma betiğiyle tek bir .app'tir; Finder'dan da açılır.",
            ],
          ),
        ],
      },
      {
        id: "graphics",
        en: "Graphics",
        tr: "Grafik",
        items: [
          s(
            M,
            [
              "Vulkan on Metal",
              "The PS5 graphics driver runs on Vulkan through MoltenVK, which runs on Metal. Nothing to install, no Vulkan SDK.",
            ],
            [
              "Metal üzerinde Vulkan",
              "PS5 grafik sürücüsü MoltenVK üzerinden Vulkan'da, o da Metal'de çalışır. Kurulacak bir şey yok, Vulkan SDK gerekmez.",
            ],
          ),
          s(
            M,
            [
              "Metal's gaps covered",
              "Placeholder images for missing null descriptors, one-lane waves where Metal has no subgroups, single-sample MSAA storage, clamped depth ranges.",
            ],
            [
              "Metal'in eksikleri kapatıldı",
              "Eksik null tanımlayıcılar için yer tutucu görüntüler, alt grup olmayan yerde tek şeritli dalgalar, tek örnekli MSAA depolama, sınırlanmış derinlik aralıkları.",
            ],
          ),
          s(
            M,
            [
              "Argument buffers",
              "Metal argument buffers lift the limit of 31 storage buffers per shader stage.",
            ],
            [
              "Argüman tamponları",
              "Metal argüman tamponları, shader aşaması başına 31 depolama tamponu sınırını kaldırır.",
            ],
          ),
          s(
            M,
            [
              "Guest write watch",
              "Watched pages are write-protected instead of compared before every draw: Dreaming Sarah went from about 18 to 60 fps.",
            ],
            [
              "Yazma izleme",
              "İzlenen sayfalar her çizimden önce karşılaştırılmak yerine yazmaya karşı korunur: Dreaming Sarah yaklaşık 18'den 60 fps'e çıktı.",
            ],
          ),
          s(
            DESK,
            [
              "Shader recompiler and cache",
              "Console shaders are recompiled to SPIR-V and kept between starts; the cache can be turned off or cleared for each game.",
            ],
            [
              "Shader derleyici ve önbellek",
              "Konsol shader'ları SPIR-V'ye yeniden derlenir ve açılışlar arasında saklanır; önbellek her oyun için kapatılıp temizlenebilir.",
            ],
          ),
          s(
            M,
            [
              "Frame generation",
              "A frame made between each two of the game's from their motion, so 60 fps shows as 120 on a 120 Hz display; it steps aside where it would cost frames.",
            ],
            [
              "Kare üretimi",
              "Oyunun her iki karesi arasına hareketten bir kare üretilir; 120 Hz ekranda 60 fps 120 görünür. Kare kaybettireceği yerde kenara çekilir.",
            ],
            EXP,
          ),
          s(
            M,
            [
              "Live frame cap",
              "A frame rate cap and a frame generation pause that the launcher changes while the game runs (ANYPS5_FPS_CAP, ANYPS5_POWER_CONTROL).",
            ],
            [
              "Canlı kare sınırı",
              "Launcher'ın oyun çalışırken değiştirdiği kare hızı sınırı ve kare üretimi duraklatma (ANYPS5_FPS_CAP, ANYPS5_POWER_CONTROL).",
            ],
            MAC_AFTER_0_2_23,
          ),
          s(
            M,
            [
              "Performance overlay",
              "Minimal: one line of FPS, generated frames, frame time, GPU, CPU and memory. Detailed: a panel with the frame-time graph. Never in screenshots.",
            ],
            [
              "Performans göstergesi",
              "Minimal: FPS, üretilen kareler, kare süresi, GPU, CPU ve bellek tek satırda. Ayrıntılı: kare süresi grafiğiyle panel. Ekran görüntülerine girmez.",
            ],
          ),
          s(
            DESK,
            [
              "Window, full screen, resolution",
              "Full screen or a window sized as a share of the display, vertical sync, and the output resolution of titles with a resolution patch.",
            ],
            [
              "Pencere, tam ekran, çözünürlük",
              "Tam ekran ya da ekranın bir payı kadar pencere, dikey senkronizasyon ve çözünürlük yaması olan oyunlarda çıkış çözünürlüğü.",
            ],
          ),
        ],
      },
      {
        id: "input",
        en: "Input",
        tr: "Giriş",
        items: [
          s(
            DESK,
            [
              "Controllers in games",
              "DualSense, DualShock 4, Xbox, Switch Pro and more, read by the engine through SDL.",
            ],
            [
              "Oyunlarda kumandalar",
              "DualSense, DualShock 4, Xbox, Switch Pro ve fazlası; motor SDL ile okur.",
            ],
          ),
          s(
            DESK,
            [
              "Keyboard as a pad",
              "A per-game layout maps every button and stick direction to a key, with a slow-walk key and ramps for sticks and triggers.",
            ],
            [
              "Kumanda olarak klavye",
              "Oyuna özel düzen her tuşu ve çubuk yönünü bir klavye tuşuna bağlar; yavaş yürüme tuşu, çubuk ve tetik rampaları dahil.",
            ],
          ),
          s(
            M,
            [
              "Mouse as the camera",
              "The middle button or F7 captures the mouse to drive the right stick: sensitivity, curve, minimum tilt, top speed, smoothing, decay.",
            ],
            [
              "Kamera olarak fare",
              "Orta tuş ya da F7 fareyi yakalar ve sağ çubuğu sürer: hassasiyet, eğri, en az eğim, en yüksek hız, yumuşatma, sönüm.",
            ],
          ),
          s(
            DESK,
            [
              "Remote pad bridge",
              "Phones and browsers become DualSense pads through a local bridge: sticks, buttons, touchpad, motion, rumble, trigger effects and light bar.",
            ],
            [
              "Uzaktan kumanda köprüsü",
              "Telefonlar ve tarayıcılar yerel bir köprüyle DualSense olur: çubuklar, tuşlar, touchpad, hareket, titreşim, tetik efektleri ve ışık çubuğu.",
            ],
          ),
          s(
            DESK,
            [
              "Up to four players",
              "Each phone or controller becomes the next player at its first press, and the game hears that player sign in, as on the console.",
            ],
            [
              "Dört oyuncuya kadar",
              "Her telefon ya da kumanda ilk basışta sıradaki oyuncu olur; oyun, konsoldaki gibi o oyuncunun girişini duyar.",
            ],
          ),
          s(
            DESK,
            [
              "Press packet",
              "A 24-byte packet holds buttons on player 1's pad for 50 to 2000 ms without taking a seat, so the quick menu can pause any game.",
            ],
            [
              "Basış paketi",
              "24 baytlık bir paket, koltuk almadan 1. oyuncunun kumandasında tuşları 50–2000 ms basılı tutar; böylece hızlı menü her oyunu duraklatabilir.",
            ],
            MAC_0_2_23,
          ),
        ],
      },
      {
        id: "system",
        en: "Sound, saves, trophies, fonts",
        tr: "Ses, kayıtlar, kupalar, yazı tipleri",
        items: [
          s(
            DESK,
            [
              "Sound",
              "The console's audio output and decoders are rebuilt as host libraries, so games play their music, voices and effects.",
            ],
            [
              "Ses",
              "Konsolun ses çıkışı ve çözücüleri ana sistem kütüphaneleri olarak yeniden yazıldı; oyunlar müziğini, seslerini ve efektlerini çalar.",
            ],
          ),
          s(
            DESK,
            [
              "Save data",
              "Saves live with the installed game and survive unlocking again and engine updates.",
            ],
            [
              "Kayıt verisi",
              "Kayıtlar kurulu oyunla birlikte durur; yeniden kilit açmaya ve motor güncellemelerine dayanır.",
            ],
          ),
          s(
            DESK,
            [
              "Trophies recorded",
              "Each unlock is recorded from the game's own trophy package, in the game's language when it has one.",
            ],
            ["Kupalar kaydedilir", "Her kupa oyunun kendi kupa paketinden, varsa oyunun dilinde kaydedilir."],
          ),
          s(
            DESK,
            [
              "System fonts",
              "Games that ask for the console's fonts get Noto: Latin, Mono, Thai and Arabic built in, Japanese, Chinese and Korean fetched once and checked.",
            ],
            [
              "Sistem yazı tipleri",
              "Konsolun yazı tiplerini isteyen oyunlar Noto alır: Latin, Mono, Tay ve Arap yerleşik; Japonca, Çince ve Korece bir kez inip doğrulanır.",
            ],
          ),
          s(
            DESK,
            [
              "Logs that explain",
              "Repeated lines fold after one notice, the last lines say how the game ended, and trace switches record more for a hard bug.",
            ],
            [
              "Anlatan günlükler",
              "Tekrar eden satırlar bir uyarıdan sonra katlanır, son satırlar oyunun nasıl bittiğini söyler, iz anahtarları zor hatada daha çok kaydeder.",
            ],
          ),
        ],
      },
      {
        id: "online",
        en: "Online bridge",
        tr: "Çevrimiçi köprü",
        items: [
          s(
            DESK,
            [
              "Online bridge",
              "The engine talks to the launcher over loopback, with a fresh secret and an HMAC handshake every start. Nothing ever goes to Sony.",
            ],
            [
              "Çevrimiçi köprü",
              "Motor, her açılışta yeni bir sır ve HMAC el sıkışmasıyla yerel bağlantı üzerinden launcher'la konuşur. Sony'ye hiçbir şey gitmez.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Signed in as you",
              "Games see your AnyTogether handle as the online ID and your AnyTogether friends as their friends list; Plus checks pass.",
            ],
            [
              "Senin adınla oturum",
              "Oyunlar AnyTogether kullanıcı adını çevrimiçi kimlik, AnyTogether arkadaşlarını arkadaş listesi olarak görür; Plus kontrolleri geçer.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Platform web API",
              "Requests pass untouched to the launcher, which answers Player Sessions, profiles and presence, and pushes events when players come and go.",
            ],
            [
              "Platform web API'si",
              "İstekler olduğu gibi launcher'a gider; launcher Player Sessions, profil ve durumu yanıtlar, oyuncular gelip gidince olay yollar.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Virtual LAN",
              "Each player gets an address in 198.18.0.0/15 from their user ID; LAN broadcasts and multicast reach every player.",
            ],
            [
              "Sanal LAN",
              "Her oyuncu kullanıcı kimliğinden 198.18.0.0/15 içinde bir adres alır; LAN yayınları ve multicast her oyuncuya ulaşır.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Datagram P2P",
              "P2P datagram sockets and UDP to a virtual address ride the bridge, up to 65,495 bytes a packet.",
            ],
            [
              "Datagram P2P",
              "P2P datagram soketleri ve sanal adrese UDP köprüden geçer; paket başına 65.495 bayta kadar.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Stream P2P",
              "Stream sockets between players ride a reliable, ordered channel, the same bytes on every system, so a Mac and a PC stream to each other.",
            ],
            [
              "Akış P2P",
              "Oyuncular arası akış soketleri güvenilir, sıralı bir kanalda, her sistemde aynı baytlarla gider; Mac ile PC birbirine akar.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Observation log",
              "What each game asks for online is written per title as JSON lines, which is how we learn what a game needs next.",
            ],
            [
              "Gözlem günlüğü",
              "Her oyunun çevrimiçi istekleri oyun başına JSON satırları olarak yazılır; bir oyunun sıradaki ihtiyacı böyle öğrenilir.",
            ],
            EXP,
          ),
        ],
      },
    ],
  },
  {
    id: "mac",
    code: "MAC",
    groups: [
      {
        id: "home",
        en: "Home and library",
        tr: "Ana ekran ve kütüphane",
        items: [
          s(
            M,
            [
              "PS5-style home screen",
              "A row of tiles with the selected game's artwork drifting behind, and its status, size, title ID, version and trophies.",
            ],
            [
              "PS5 tarzı ana ekran",
              "Arkada seçili oyunun görseli kayarken bir kutucuk şeridi; oyunun durumu, boyutu, title ID'si, sürümü ve kupaları.",
            ],
          ),
          s(
            M,
            ["Game library", "Every game in a grid, from a games folder and its subfolders."],
            ["Oyun kütüphanesi", "Oyun klasörü ve alt klasörlerindeki tüm oyunlar bir ızgarada."],
          ),
          s(
            M,
            [
              "Three-step first start",
              "Language, theme and games folder; the launcher offers to move itself to Applications.",
            ],
            [
              "Üç adımlı ilk açılış",
              "Dil, tema ve oyun klasörü; launcher kendini Uygulamalar'a taşımayı önerir.",
            ],
          ),
          s(
            M,
            [
              "Games that show up by themselves",
              "A game copied in appears once its copy is complete, with a notice and its icon; plugged-in drives are looked at too.",
            ],
            [
              "Kendiliğinden görünen oyunlar",
              "Kopyalanan oyun kopyası bitince bildirim ve simgesiyle görünür; takılan sürücülere de bakılır.",
            ],
          ),
          s(
            M,
            [
              "Game music",
              "Rest on a game and its theme song fades in as on the PS5, with volumes for the music and the interface sounds.",
            ],
            [
              "Oyun müziği",
              "Bir oyunda durunca PS5'teki gibi tema şarkısı yükselir; müzik ve arayüz sesleri için ayrı ses düzeyi.",
            ],
          ),
          s(
            M,
            [
              "Start screen",
              "The game's icon, a timer and a bar until its window appears; Esc cancels, and a game that cannot start says so.",
            ],
            [
              "Açılış ekranı",
              "Penceresi açılana dek oyunun simgesi, süre ve çubuk; Esc iptal eder, açılamayan oyun bunu söyler.",
            ],
          ),
          s(
            M,
            [
              "Full screen launcher",
              "Full screen the first time, then as you left it; F11, ⌃⌘F or Settings switch it.",
            ],
            [
              "Tam ekran launcher",
              "İlk seferde tam ekran, sonra bıraktığın gibi; F11, ⌃⌘F ya da Ayarlar değiştirir.",
            ],
            MAC_0_2_23,
          ),
        ],
      },
      {
        id: "unlock",
        en: "Unlocking",
        tr: "Kilit açma",
        items: [
          s(
            M,
            [
              "One-click unlock",
              "Opens SELF containers, relinks to Mach-O and builds the app with a PS5-style progress bar; an encrypted dump is reported, not converted.",
            ],
            [
              "Tek tıkla kilit açma",
              "SELF kaplarını açar, Mach-O'ya bağlar, uygulamayı PS5 tarzı ilerleme çubuğuyla kurar; şifreli dump bildirilir, dönüştürülmez.",
            ],
          ),
          s(
            M,
            [
              "No extra space",
              "Game files are APFS clones of the dump; on exFAT or HFS+ drives they are linked instead of copied.",
            ],
            [
              "Ek yer yok",
              "Oyun dosyaları dump'ın APFS klonlarıdır; exFAT ya da HFS+ sürücülerde kopyalanmaz, bağlanır.",
            ],
          ),
          s(
            M,
            [
              "Unity games",
              "Unity's own modules and plugins are converted with the game, so titles like Silksong unlock in one click.",
            ],
            [
              "Unity oyunları",
              "Unity'nin modülleri ve eklentileri oyunla dönüştürülür; Silksong gibi oyunlar tek tıkla açılır.",
            ],
          ),
          s(
            M,
            [
              "Free space check",
              "Unlock looks at the drive first and says how much is needed and free, and the ways out.",
            ],
            [
              "Boş alan kontrolü",
              "Kilit açma önce sürücüye bakar; ne kadar gerektiğini, ne kadar boş olduğunu ve çıkış yollarını söyler.",
            ],
          ),
          s(
            M,
            [
              "New games prepared in the background",
              "One at a time at background priority; it waits while you play and never runs on a battery below 30 %.",
            ],
            [
              "Arka planda hazırlanan oyunlar",
              "Arka plan önceliğinde tek tek; sen oynarken bekler, yüzde 30'un altındaki pilde hiç çalışmaz.",
            ],
          ),
          s(
            M,
            [
              "Faster unlocks",
              "The relinker's output is kept, up to eight workers place the files, and an engine is checked in full only when it changes.",
            ],
            [
              "Daha hızlı kilit açma",
              "Relinker çıktısı saklanır, dosyaları sekize kadar işçi yerleştirir, motor yalnızca değişince baştan doğrulanır.",
            ],
          ),
          s(
            M,
            [
              "Update and Play",
              "A game unlocked with an older engine offers Update and Play or Play Now; saves and trophies stay.",
            ],
            [
              "Güncelle ve Oyna",
              "Eski motorla açılmış oyun Güncelle ve Oyna ya da Şimdi Oyna sunar; kayıtlar ve kupalar kalır.",
            ],
          ),
          s(
            M,
            [
              "Engine picker",
              "Engines from the project's releases, downloaded and checked, for every game or just one, or an engine you built yourself.",
            ],
            [
              "Motor seçici",
              "Projenin sürümlerindeki motorlar indirilip doğrulanır; tüm oyunlar ya da tek oyun için, ya da kendi derlediğin motor.",
            ],
          ),
        ],
      },
      {
        id: "game",
        en: "Per-game settings",
        tr: "Oyun ayarları",
        items: [
          s(
            M,
            [
              "Settings for each game",
              "Resolution, window or full screen and its size, vertical sync, frame generation, the overlay and the game's language, applied at every start.",
            ],
            [
              "Her oyuna kendi ayarları",
              "Çözünürlük, pencere ya da tam ekran ve boyutu, dikey senkronizasyon, kare üretimi, gösterge ve oyun dili; her açılışta uygulanır.",
            ],
          ),
          s(
            M,
            [
              "Controls editor",
              "Pick a button and press the key you want; in Unreal Engine games each button says what the game does with it.",
            ],
            [
              "Kontrol düzenleyici",
              "Bir tuş seç, istediğin klavye tuşuna bas; Unreal Engine oyunlarında her tuş oyunda ne yaptığını söyler.",
            ],
          ),
          s(
            M,
            [
              "Advanced settings",
              "Stick dead zones, the mouse camera, keyboard ramps and the shader cache, each with a line on what it does.",
            ],
            [
              "Gelişmiş ayarlar",
              "Çubuk ölü bölgeleri, fare kamerası, klavye rampaları ve shader önbelleği; her biri ne yaptığını söyleyen bir satırla.",
            ],
          ),
          s(
            M,
            [
              "Export and import settings",
              "A game's keys and settings as one file, to share a setup that works.",
            ],
            [
              "Ayarları dışa ve içe aktar",
              "Bir oyunun tuşları ve ayarları tek dosyada; işe yarayan kurulumu paylaşmak için.",
            ],
          ),
          s(
            M,
            [
              "Screenshots and clips",
              "A game's F12 shots and clips in a grid and full screen; L1 and R1 go to the next game.",
            ],
            [
              "Ekran görüntüleri ve klipler",
              "Oyunun F12 görüntüleri ve klipleri ızgarada ve tam ekranda; L1 ve R1 sonraki oyuna geçer.",
            ],
          ),
          s(
            M,
            [
              "Save backups",
              "Saves and trophies as a zip in Documents; a restore backs up what the game had first.",
            ],
            [
              "Kayıt yedekleri",
              "Kayıtlar ve kupalar Belgeler'de bir zip'te; geri yükleme önce oyunda olanı yedekler.",
            ],
          ),
          s(
            M,
            [
              "Links",
              "anyps5://game and anyps5://play select or start a game; a folder opened with AnyPS5 can become the games folder.",
            ],
            [
              "Bağlantılar",
              "anyps5://game ve anyps5://play bir oyunu seçer ya da başlatır; AnyPS5 ile açılan klasör oyun klasörü olabilir.",
            ],
          ),
        ],
      },
      {
        id: "trophies",
        en: "Trophies",
        tr: "Kupalar",
        items: [
          s(
            M,
            [
              "Trophy list",
              "As the console shows it: the weighted percentage, the count per grade, icons, descriptions, the day earned, progress like 23/51.",
            ],
            [
              "Kupa listesi",
              "Konsoldaki gibi: ağırlıklı yüzde, derece başına sayı, simgeler, açıklamalar, kazanma günü, 23/51 gibi ilerleme.",
            ],
          ),
          s(
            M,
            [
              "Trophy card over the game",
              "Drops in with the trophy's icon, name, grade and sound, in full screen too, without taking the keyboard or the mouse.",
            ],
            [
              "Oyunun üstünde kupa kartı",
              "Kupanın simgesi, adı, derecesi ve sesiyle iner; tam ekranda da, klavyeyi ya da fareyi almadan.",
            ],
          ),
          s(
            M,
            ["Hidden trophies", "Stay hidden until earned; Show reveals one, or always show them all."],
            ["Gizli kupalar", "Kazanılana dek gizli kalır; Göster birini açar, ya da hepsini hep göster."],
          ),
        ],
      },
      {
        id: "controllers",
        en: "Controllers and input",
        tr: "Kumandalar ve giriş",
        items: [
          s(
            M,
            [
              "Controllers screen",
              "Each pad with its connection and battery, a live test, vibration test, light bar colour, ○ to confirm and a dead zone.",
            ],
            [
              "Kumandalar ekranı",
              "Her kumanda bağlantısı ve piliyle; canlı test, titreşim testi, ışık çubuğu rengi, ○ ile onay ve ölü bölge.",
            ],
          ),
          s(
            M,
            [
              "DualShock 3 over USB",
              "Read with the launcher's own USB reader, since macOS does not support it.",
            ],
            ["USB ile DualShock 3", "macOS desteklemediği için launcher'ın kendi USB okuyucusuyla okunur."],
          ),
          s(
            M,
            [
              "Troubleshooter",
              "Says what it sees (no pad, a pad without a layout, a low battery, Steam taking the pad) and what to do.",
            ],
            [
              "Sorun giderici",
              "Gördüğünü (kumanda yok, düzensiz kumanda, düşük pil, kumandayı alan Steam) ve ne yapılacağını söyler.",
            ],
          ),
          s(
            M,
            [
              "Controller vibration",
              "Soft pulses for select, back, errors, trophies and calls, only while the launcher is in front.",
            ],
            [
              "Kumanda titreşimi",
              "Seçme, geri, hata, kupa ve aramalar için yumuşak titreşimler; yalnızca launcher öndeyken.",
            ],
          ),
          s(
            M,
            [
              "PS button",
              "Brings the launcher in front of the game and back; the game reads the pad only while its own window is in front.",
            ],
            [
              "PS tuşu",
              "Launcher'ı oyunun önüne getirir ve geri döndürür; oyun kumandayı yalnızca kendi penceresi öndeyken okur.",
            ],
          ),
          s(
            M,
            [
              "Keyboard, mouse, hints",
              "Arrows, Return and Esc, Q and E for L1 and R1, click and double-click; the key hints at the bottom can be clicked.",
            ],
            [
              "Klavye, fare, ipuçları",
              "Oklar, Return ve Esc, L1 ve R1 için Q ve E, tıklama ve çift tıklama; alttaki tuş ipuçları tıklanabilir.",
            ],
          ),
          s(
            M,
            [
              "Settings with a pad",
              "Move through Settings like a console: ✕ edits a value, ← → change it, L1 and R1 change the section.",
            ],
            [
              "Kumandayla Ayarlar",
              "Ayarlar'da konsol gibi gezin: ✕ değeri düzenler, ← → değiştirir, L1 ve R1 bölümü değiştirir.",
            ],
            MAC_0_2_23,
          ),
          s(
            M,
            [
              "Hints that follow you",
              "The hints show the pad's buttons or the keys, whichever you used last, and switch live.",
            ],
            [
              "Seni izleyen ipuçları",
              "İpuçları en son hangisini kullandıysan kumandanın tuşlarını ya da klavyeyi gösterir, anında değişir.",
            ],
            MAC_0_2_23,
          ),
          s(
            M,
            [
              "PS quick menu",
              "PS over a game pauses it and opens Resume, Game Settings and Close Game; held, it asks Close game? or Quit AnyPS5.",
            ],
            [
              "PS hızlı menü",
              "Oyunda PS oyunu duraklatıp Devam, Oyun Ayarları ve Oyunu Kapat'ı açar; basılı tutunca oyunu kapatmayı ya da AnyPS5'ten çıkmayı sorar.",
            ],
            MAC_0_2_23,
          ),
          s(
            M,
            [
              "Shortcuts",
              "Home, Quick Menu, Screenshot, Save Clip and Full Screen on any key or pad chord, pressed or held; clashes are refused.",
            ],
            [
              "Kısayollar",
              "Ana Ekran, Hızlı Menü, Ekran Görüntüsü, Klip Kaydet ve Tam Ekran herhangi bir tuşa ya da tuş birleşimine; çakışmalar reddedilir.",
            ],
            MAC_0_2_23,
          ),
        ],
      },
      {
        id: "look",
        en: "Look",
        tr: "Görünüm",
        items: [
          s(
            M,
            [
              "Animated themes",
              "Cosmic, Aurora and Sunset, an accent colour, and your own picture or looping video behind.",
            ],
            [
              "Hareketli temalar",
              "Kozmik, Aurora ve Gün Batımı, bir vurgu rengi ve arkada kendi resmin ya da döngülü videon.",
            ],
          ),
          s(
            M,
            [
              "Glass",
              "A see-through window with your desktop frosted behind, Liquid Glass panels on macOS 26 and an Ice accent; Reduce Transparency keeps it solid.",
            ],
            [
              "Cam",
              "Arkada masaüstünün buzlu göründüğü saydam pencere, macOS 26'da Liquid Glass paneller ve Buz vurgusu; Saydamlığı Azalt katı tutar.",
            ],
          ),
          s(
            M,
            [
              "Theme Studio",
              "Make your own theme (motion, colours, accent, picture or video, menu music) and save it as one .anyps5theme file.",
            ],
            [
              "Tema Stüdyosu",
              "Kendi temanı yap (hareket, renkler, vurgu, resim ya da video, menü müziği) ve tek bir .anyps5theme dosyası olarak kaydet.",
            ],
          ),
          s(
            M,
            [
              "Themes from the Hub",
              "Themes people share, installed with one press; Share on the Hub sends yours.",
            ],
            [
              "Hub'dan temalar",
              "İnsanların paylaştığı temalar tek basışla kurulur; Hub'da Paylaş seninkini gönderir.",
            ],
          ),
          s(
            M,
            [
              "Profile picture",
              "Pick an image, drag and zoom it in the circle; it can become your AnyTogether picture.",
            ],
            ["Profil resmi", "Bir resim seç, dairede sürükle ve yakınlaştır; AnyTogether resmin olabilir."],
          ),
          s(
            M,
            ["English and Turkish", "The whole launcher in both; the phone follows its language."],
            ["İngilizce ve Türkçe", "Launcher'ın tamamı iki dilde; telefon onun dilini izler."],
          ),
        ],
      },
      {
        id: "capture",
        en: "Capture and broadcast",
        tr: "Çekim ve yayın",
        items: [
          s(
            M,
            [
              "Clips",
              "The last seconds of play, picture and sound, saved as an MP4 with Create, ⌥F12 or the phone's Create button.",
            ],
            [
              "Klipler",
              "Oyunun son saniyeleri, görüntü ve sesiyle; Create, ⌥F12 ya da telefonun Create tuşuyla MP4 olarak kaydedilir.",
            ],
          ),
          s(
            M,
            [
              "Longer replay buffer",
              "The last 30 s, 1, 3 or 5 minutes in memory; a press of Create saves a clip, a hold takes a screenshot.",
            ],
            [
              "Daha uzun tekrar tamponu",
              "Son 30 sn, 1, 3 ya da 5 dakika bellekte; Create'e basmak klip kaydeder, basılı tutmak ekran görüntüsü alır.",
            ],
            MAC_0_2_23,
          ),
          s(
            M,
            ["Screenshots", "F12 from anywhere, into Pictures › AnyPS5 or a folder you choose."],
            ["Ekran görüntüleri", "Her yerden F12; Resimler › AnyPS5'e ya da seçtiğin klasöre."],
          ),
          s(
            M,
            [
              "Broadcast live",
              "Twitch, YouTube or any RTMP/RTMPS server at 720p60, 1080p30 or 1080p60, with a microphone, live stats and reconnects; the key stays masked.",
            ],
            [
              "Canlı yayın",
              "Twitch, YouTube ya da herhangi bir RTMP/RTMPS sunucusu; 720p60, 1080p30 ya da 1080p60, mikrofon, canlı istatistik, yeniden bağlanma; anahtar hep gizli.",
            ],
          ),
        ],
      },
      {
        id: "system",
        en: "Mac integration",
        tr: "Mac entegrasyonu",
        items: [
          s(
            M,
            [
              "Add to Steam",
              "AnyPS5 and each unlocked game in your Steam library with Cosmic artwork, starting straight into the game.",
            ],
            [
              "Steam'e Ekle",
              "AnyPS5 ve her açılmış oyun Kozmik görsellerle Steam kütüphanende; doğrudan oyunu açar.",
            ],
          ),
          s(
            M,
            [
              "Save Sync",
              "Saves and trophies the same on all your Macs through iCloud Drive or any folder; whatever is replaced is backed up first.",
            ],
            [
              "Kayıt Eşitleme",
              "Kayıtlar ve kupalar iCloud Drive ya da herhangi bir klasörle tüm Mac'lerinde aynı; değişen her şey önce yedeklenir.",
            ],
          ),
          s(
            M,
            [
              "Self-updates",
              "Checks at start and every six hours, downloads quietly, checks the signature, then offers Restart Now or Later.",
            ],
            [
              "Kendini güncelleme",
              "Açılışta ve altı saatte bir bakar, sessizce indirir, imzayı doğrular, sonra Şimdi Yeniden Başlat ya da Sonra sunar.",
            ],
          ),
          s(
            M,
            ["Update channel", "Stable or Nightly; going back to Stable never downgrades."],
            ["Güncelleme kanalı", "Kararlı ya da Gecelik; Kararlı'ya dönmek asla sürüm düşürmez."],
          ),
          s(
            M,
            [
              "Crash reports",
              "Why a game stopped, in plain words; Export Report and Open Issue with your name, email and tokens taken out.",
            ],
            [
              "Çökme raporları",
              "Oyunun neden durduğu sade bir dille; adın, e-postan ve anahtarların çıkarılmış Raporu Dışa Aktar ve Hata Bildir.",
            ],
          ),
          s(
            M,
            [
              "Low Power Mode notice",
              "A card says when Low Power Mode holds the display at 60 Hz and frame generation cannot help.",
            ],
            [
              "Düşük Güç Modu uyarısı",
              "Düşük Güç Modu ekranı 60 Hz'de tutup kare üretimi yardım edemediğinde bir kart söyler.",
            ],
          ),
          s(
            M,
            [
              "Battery & Heat",
              "On battery or when the Mac runs hot: a frame cap, lower resolution, frame generation paused, a lighter launcher; Undo in the quick menu.",
            ],
            [
              "Pil ve Isı",
              "Pildeyken ya da Mac ısındığında: kare sınırı, daha düşük çözünürlük, duraklayan kare üretimi, hafif launcher; Geri Al hızlı menüde.",
            ],
            MAC_AFTER_0_2_23,
          ),
          s(
            M,
            [
              "Discord Rich Presence",
              "The game you play on your Discord profile, as itself with its own name and icon when Discord knows it.",
            ],
            [
              "Discord Rich Presence",
              "Oynadığın oyun Discord profilinde; Discord tanıyorsa kendi adı ve simgesiyle.",
            ],
          ),
          s(
            M,
            [
              "One-line install",
              "curl | sh puts AnyPS5.app in Applications without the quarantine warning and installs Rosetta 2 if it is missing.",
            ],
            [
              "Tek satırla kurulum",
              "curl | sh, AnyPS5.app'i karantina uyarısı olmadan Uygulamalar'a koyar, yoksa Rosetta 2'yi kurar.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "desktop",
    code: "PC",
    groups: [
      {
        id: "home",
        en: "Home and library",
        tr: "Ana ekran ve kütüphane",
        items: [
          s(
            PC,
            [
              "The same PS5-style home",
              "Tile row, hero, library grid and the Cosmic, Aurora and Sunset backgrounds, from the Mac launcher's own shader.",
            ],
            [
              "Aynı PS5 tarzı ana ekran",
              "Kutucuk şeridi, büyük görsel, kütüphane ızgarası ve Mac launcher'ın kendi shader'ından Kozmik, Aurora ve Gün Batımı.",
            ],
          ),
          s(
            PC,
            [
              "Library from a folder",
              "Finds your dumps with their names in each language, icons and backgrounds; new games show up by themselves.",
            ],
            [
              "Klasörden kütüphane",
              "Dump'larını her dildeki adları, simgeleri ve arka planlarıyla bulur; yeni oyunlar kendiliğinden görünür.",
            ],
          ),
          s(
            PC,
            [
              "Sounds and theme songs",
              "The Mac launcher's interface sounds, and each game's theme song decoded from its AT9 and faded in.",
            ],
            [
              "Sesler ve tema şarkıları",
              "Mac launcher'ın arayüz sesleri ve AT9'undan çözülüp yükselen her oyunun tema şarkısı.",
            ],
          ),
          s(
            PC,
            ["Full screen", "Starts full screen, then as you left it; F11 or Settings switch it."],
            ["Tam ekran", "Tam ekran açılır, sonra bıraktığın gibi; F11 ya da Ayarlar değiştirir."],
          ),
          s(
            PC,
            [
              "A mouse that feels right",
              "Close and Back on every panel, right click goes back, lists scroll by click and drag, double click plays.",
            ],
            [
              "Doğru hissettiren fare",
              "Her panelde Kapat ve Geri, sağ tık geri gider, listeler tıklayıp sürükleyerek kayar, çift tık oynatır.",
            ],
          ),
          s(
            PC,
            [
              "Smooth on laptops",
              "Skia on Windows, surfaces drawn once and reused, and nothing drawn at all while a game is in front.",
            ],
            [
              "Dizüstünde akıcı",
              "Windows'ta Skia, yüzeyler bir kez çizilip yeniden kullanılır, oyun öndeyken hiçbir şey çizilmez.",
            ],
          ),
        ],
      },
      {
        id: "unlock",
        en: "Unlocking and the engine",
        tr: "Kilit açma ve motor",
        items: [
          s(
            PC,
            [
              "Unlock and play",
              "Opens SELF containers byte for byte as upstream does, relinks for the host and lays the game out with its libraries.",
            ],
            [
              "Aç ve oyna",
              "SELF kaplarını upstream gibi bayt bayt açar, ana sistem için bağlar, oyunu kütüphaneleriyle yerleştirir.",
            ],
          ),
          s(
            PC,
            [
              "An engine that downloads itself",
              "Resumable, checksum-checked downloads, versions side by side, updates offered, or a folder of your own.",
            ],
            [
              "Kendini indiren motor",
              "Kaldığı yerden süren, sağlaması doğrulanan indirmeler; yan yana sürümler, güncelleme önerisi ya da kendi klasörün.",
            ],
          ),
          s(
            PC,
            [
              "The AnyPS5-ARM engine",
              "One switch to our signed Windows and Linux engine, which the phone pad and online play need.",
            ],
            [
              "AnyPS5-ARM motoru",
              "Tek seçimle imzalı Windows ve Linux motorumuz; telefon kumandası ve çevrimiçi oyun ona ihtiyaç duyar.",
            ],
          ),
          s(
            PC,
            [
              "No copies across drives",
              "A dump on another drive is linked, not copied; where no link can be made it says how many GB and why first.",
            ],
            [
              "Sürücüler arası kopya yok",
              "Başka sürücüdeki dump kopyalanmaz, bağlanır; bağ kurulamazsa önce kaç GB ve neden olduğunu söyler.",
            ],
          ),
          s(
            PC,
            [
              "Room checked, games prepared",
              "Unlock checks the drive first; new games are prepared at the lowest priority, never on a low battery.",
            ],
            [
              "Yer denetlenir, oyunlar hazırlanır",
              "Kilit açma önce sürücüye bakar; yeni oyunlar en düşük öncelikle hazırlanır, düşük pilde asla.",
            ],
          ),
          s(
            LIN,
            [
              "glibc check",
              "On Linux the launcher says when an engine needs a newer glibc than the system has.",
            ],
            [
              "glibc kontrolü",
              "Linux'ta bir motor sistemdekinden yeni glibc istiyorsa launcher bunu söyler.",
            ],
          ),
          s(
            PC,
            [
              "Per-game settings",
              "Resolution, window or full screen and window size, keyboard layout; full screen works with upstream's engine too.",
            ],
            [
              "Oyun ayarları",
              "Çözünürlük, pencere ya da tam ekran ve pencere boyutu, klavye düzeni; tam ekran upstream motoruyla da çalışır.",
            ],
          ),
        ],
      },
      {
        id: "controllers",
        en: "Controllers",
        tr: "Kumandalar",
        items: [
          s(
            PC,
            [
              "Controllers through SDL2",
              "DualSense and DualShock 4 over USB and Bluetooth with motors and light bar, Xbox, Switch Pro, 8BitDo and more, several at once.",
            ],
            [
              "SDL2 ile kumandalar",
              "USB ve Bluetooth ile motorlu, ışık çubuklu DualSense ve DualShock 4, Xbox, Switch Pro, 8BitDo ve fazlası; aynı anda birkaç tane.",
            ],
          ),
          s(
            PC,
            [
              "Controllers screen",
              "Battery, live tests, vibration, light bar, ○ to confirm, and a dead zone for the launcher and for games.",
            ],
            [
              "Kumandalar ekranı",
              "Pil, canlı testler, titreşim, ışık çubuğu, ○ ile onay ve launcher ile oyunlar için ölü bölge.",
            ],
          ),
          s(
            PC,
            [
              "Troubleshooter",
              "Finds Steam's PlayStation support, DS4Windows, DualSenseX, HidHide and Linux input permissions, with the command to copy.",
            ],
            [
              "Sorun giderici",
              "Steam'in PlayStation desteğini, DS4Windows, DualSenseX, HidHide ve Linux giriş izinlerini bulur; kopyalanacak komutuyla.",
            ],
          ),
          s(
            PC,
            [
              "Stays out of your game",
              "With a game in front only PS or Guide reaches the launcher, and PS switches both ways.",
            ],
            [
              "Oyununa karışmaz",
              "Oyun öndeyken launcher'a yalnızca PS ya da Guide ulaşır; PS iki yöne de geçirir.",
            ],
          ),
          s(
            PC,
            [
              "Vibration and input feel",
              "Soft pulses in the launcher, one repeat pace for pad and keys, and a resting stick that no longer jitters.",
            ],
            [
              "Titreşim ve giriş hissi",
              "Launcher'da yumuşak titreşimler, kumanda ve tuşlarda tek tekrar hızı, artık titremeyen çubuk.",
            ],
          ),
          s(
            PC,
            [
              "Settings with a pad, live hints",
              "✕ edits a value and ← → change it; hints show the pad's buttons or the keys, whichever you used last.",
            ],
            [
              "Kumandayla Ayarlar, canlı ipuçları",
              "✕ değeri düzenler, ← → değiştirir; ipuçları en son hangisini kullandıysan kumandayı ya da klavyeyi gösterir.",
            ],
          ),
          s(
            PC,
            [
              "PS quick menu",
              "PS pauses the game and opens Resume, Game Settings and Close Game, saying Paused or Still running; held, it asks first.",
            ],
            [
              "PS hızlı menü",
              "PS oyunu duraklatıp Devam, Oyun Ayarları ve Oyunu Kapat'ı açar, Duraklatıldı ya da Hâlâ çalışıyor der; basılı tutunca önce sorar.",
            ],
          ),
          s(
            PC,
            [
              "Shortcuts",
              "Launcher actions on any key or pad chord, pressed or held; conflicts are refused.",
            ],
            [
              "Kısayollar",
              "Launcher eylemleri herhangi bir tuşa ya da tuş birleşimine, basarak ya da basılı tutarak; çakışmalar reddedilir.",
            ],
          ),
        ],
      },
      {
        id: "look",
        en: "Look",
        tr: "Görünüm",
        items: [
          s(
            PC,
            [
              "Glass",
              "See-through window: Acrylic on Windows 11, acrylic blur on Windows 10, blur on KDE Plasma; it turns solid by itself on a slow GPU.",
            ],
            [
              "Cam",
              "Saydam pencere: Windows 11'de Acrylic, Windows 10'da akrilik bulanıklık, KDE Plasma'da bulanıklık; yavaş GPU'da kendiliğinden katılaşır.",
            ],
          ),
          s(
            PC,
            [
              "Cosmic, Aurora, Sunset",
              "The Mac launcher's animated themes and its accent colours, with the Ice accent for Glass.",
            ],
            [
              "Kozmik, Aurora, Gün Batımı",
              "Mac launcher'ın hareketli temaları ve vurgu renkleri; Cam için Buz vurgusuyla.",
            ],
          ),
        ],
      },
      {
        id: "trophies",
        en: "Trophies, captures, saves",
        tr: "Kupalar, çekimler, kayıtlar",
        items: [
          s(
            PC,
            ["Trophy list", "Every trophy as on the console; △ or Y reveals a hidden one, or show them all."],
            ["Kupa listesi", "Konsoldaki gibi her kupa; △ ya da Y gizli olanı açar, ya da hepsini göster."],
          ),
          s(
            PC,
            [
              "Trophy card over the game",
              "A PS5-style card with the trophy sound over the game and a picture of the moment; a notification on Wayland.",
            ],
            [
              "Oyunun üstünde kupa kartı",
              "Kupa sesiyle PS5 tarzı kart oyunun üstünde ve anın bir resmi; Wayland'de bir bildirim.",
            ],
          ),
          s(
            PC,
            [
              "Clips and screenshots",
              "A replay buffer of 30 s to 5 min (with ffmpeg): a short press of Create saves a clip, a long one a screenshot.",
            ],
            [
              "Klipler ve ekran görüntüleri",
              "30 sn ile 5 dk arası tekrar tamponu (ffmpeg ile): Create'e kısa basış klip, uzun basış ekran görüntüsü.",
            ],
          ),
          s(
            PC,
            ["Gallery", "A game's screenshots, trophy moments and clips with a play badge."],
            ["Galeri", "Oyunun ekran görüntüleri, kupa anları ve oynat rozetli klipleri."],
          ),
          s(
            PC,
            ["Save backups", "Saves and trophies stay with each game and can be backed up and restored."],
            ["Kayıt yedekleri", "Kayıtlar ve kupalar her oyunla kalır; yedeklenip geri yüklenebilir."],
          ),
          s(
            PC,
            [
              "System fonts",
              "Noto ships with the launcher; Japanese, Chinese and Korean download the first time a game needs them; your own folder comes first.",
            ],
            [
              "Sistem yazı tipleri",
              "Noto launcher'la gelir; Japonca, Çince ve Korece bir oyun ilk istediğinde iner; önce kendi klasörün gelir.",
            ],
          ),
        ],
      },
      {
        id: "steam",
        en: "Steam and Steam Deck",
        tr: "Steam ve Steam Deck",
        items: [
          s(
            PC,
            [
              "Add to Steam",
              "AnyPS5 as a non-Steam game with Cosmic artwork, so Big Picture, Steam Input and the Deck's Game Mode start it.",
            ],
            [
              "Steam'e Ekle",
              "AnyPS5 Kozmik görsellerle Steam dışı oyun olarak; Big Picture, Steam Input ve Deck'in Oyun Modu onu başlatır.",
            ],
          ),
          s(
            PC,
            [
              "Add My Games Too",
              "Each unlocked game gets its own entry and art and starts straight into the game; the launcher closes when it ends.",
            ],
            [
              "Oyunlarımı da Ekle",
              "Her açılmış oyun kendi girdisi ve görseliyle doğrudan oyunu açar; oyun bitince launcher kapanır.",
            ],
          ),
          s(
            PC,
            [
              "Careful with Steam's file",
              "Writes only while Steam is closed, keeps a backup, and Remove from Steam takes out only AnyPS5's entries.",
            ],
            [
              "Steam dosyasına özen",
              "Yalnızca Steam kapalıyken yazar, yedek tutar; Steam'den Kaldır yalnızca AnyPS5 girdilerini çıkarır.",
            ],
          ),
        ],
      },
      {
        id: "system",
        en: "System",
        tr: "Sistem",
        items: [
          s(
            PC,
            [
              "Installers",
              "A per-user Windows setup that needs no admin, and a portable zip; AppImage, .deb and .tar.gz on Linux.",
            ],
            [
              "Kurulum paketleri",
              "Yönetici gerektirmeyen kullanıcı başına Windows kurulumu ve taşınabilir zip; Linux'ta AppImage, .deb ve .tar.gz.",
            ],
          ),
          s(
            PC,
            [
              "Signed, quiet updates",
              "A new version downloads in the background, checked against the signed checksums, then Restart Now or Later.",
            ],
            [
              "İmzalı, sessiz güncellemeler",
              "Yeni sürüm arka planda iner, imzalı sağlamalarla doğrulanır; sonra Şimdi Yeniden Başlat ya da Sonra.",
            ],
          ),
          s(
            PC,
            [
              "Crash reports",
              "Why a game stopped, Save crash_log.txt, Copy Report for Discord, and a pre-filled issue with personal details taken out.",
            ],
            [
              "Çökme raporları",
              "Oyunun neden durduğu, crash_log.txt kaydet, Discord için Raporu Kopyala ve kişisel bilgileri çıkarılmış hazır hata kaydı.",
            ],
          ),
          s(
            PC,
            [
              "Detailed logging",
              "Trace for one start, every start, or a whole session with --trace; logs are capped so they never fill the disk.",
            ],
            [
              "Ayrıntılı günlük",
              "Tek açılış, her açılış ya da --trace ile tüm oturum için iz; günlükler diski doldurmasın diye sınırlıdır.",
            ],
          ),
          s(
            PC,
            [
              "Sign-in kept safe",
              "Sealed with DPAPI on Windows; the desktop keyring on Linux, or a file only you can read.",
            ],
            [
              "Güvende tutulan oturum",
              "Windows'ta DPAPI ile mühürlü; Linux'ta masaüstü anahtarlığı ya da yalnızca senin okuyabildiğin bir dosya.",
            ],
          ),
          s(
            PC,
            [
              "Phone pairing",
              "AnyPS5 Remote finds it on the network or over adb, with the same pairing card and four seats.",
            ],
            [
              "Telefon eşleştirme",
              "AnyPS5 Remote onu ağda ya da adb ile bulur; aynı eşleştirme kartı ve dört koltuk.",
            ],
          ),
          s(
            PC,
            [
              "Command-line tool",
              "anyps5_tool unwraps, scans, installs, plays, lists pads and edits Steam shortcuts, no window needed.",
            ],
            [
              "Komut satırı aracı",
              "anyps5_tool pencere olmadan açar, tarar, kurar, oynatır, kumandaları listeler ve Steam kısayollarını düzenler.",
            ],
          ),
          s(
            PC,
            [
              "AnyTogether built in",
              "Sign-in, friends, messages, parties and voice with a talk key read across the desktop, trophies, levels and online play.",
            ],
            [
              "Yerleşik AnyTogether",
              "Oturum, arkadaşlar, mesajlar, masaüstünün her yerinde okunan konuşma tuşuyla parti ve ses, kupalar, seviyeler ve çevrimiçi oyun.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "phone",
    code: "APP",
    groups: [
      {
        id: "connect",
        en: "Connecting",
        tr: "Bağlanma",
        items: [
          s(
            PHONE,
            [
              "Finds the launcher by itself",
              "On the same Wi-Fi it finds the Mac or PC; the first time both show the same four-digit code, then it just connects.",
            ],
            [
              "Launcher'ı kendi bulur",
              "Aynı Wi-Fi'da Mac'i ya da PC'yi bulur; ilk seferde ikisi aynı dört haneli kodu gösterir, sonra doğrudan bağlanır.",
            ],
          ),
          s(
            PHONE,
            [
              "On a cable",
              "An iPhone on the Mac's cable connects by itself; an Android phone does with USB debugging and adb.",
            ],
            [
              "Kabloyla",
              "Mac'e kabloyla takılan iPhone kendiliğinden bağlanır; Android telefon USB hata ayıklama ve adb ile.",
            ],
          ),
          s(
            PHONE,
            ["Mac and PC", "Pairs with AnyPS5 on the Mac and with AnyPS5 Desktop on Windows and Linux."],
            ["Mac ve PC", "Mac'teki AnyPS5 ile ve Windows ile Linux'taki AnyPS5 Desktop ile eşleşir."],
          ),
          s(
            PHONE,
            [
              "Installs your way",
              "The APK on Android; the IPA on an iPhone (iOS 15 or newer) through AltStore, SideStore or Sideloadly.",
            ],
            [
              "Dilediğin gibi kur",
              "Android'de APK; iPhone'da (iOS 15 ya da üstü) AltStore, SideStore ya da Sideloadly ile IPA.",
            ],
          ),
        ],
      },
      {
        id: "pad",
        en: "The pad",
        tr: "Kumanda",
        items: [
          s(
            PHONE,
            [
              "A whole DualSense",
              "Both sticks, ✕ ○ □ △, L1 R1 L2 R2, the D-pad, Options and the touchpad, any of them at once, with the latency shown.",
            ],
            [
              "Tam bir DualSense",
              "İki çubuk, ✕ ○ □ △, L1 R1 L2 R2, yön tuşları, Options ve touchpad; hepsi aynı anda, gecikme görünür.",
            ],
          ),
          s(
            PHONE,
            [
              "A touchpad that works",
              "Slide to move, tap to click, hold to press, two fingers for two touches; a double tap on a stick is L3 or R3.",
            ],
            [
              "Gerçekten çalışan touchpad",
              "Kaydırınca gezer, dokununca tıklar, basılı tutunca basar, iki parmak iki dokunuş; çubuğa çift dokunuş L3 ya da R3.",
            ],
          ),
          s(
            PHONE,
            [
              "Rumble, triggers, light",
              "The game's two motors, a pulse on L2 and R2 where the trigger would push back, and the light bar's colour.",
            ],
            [
              "Titreşim, tetikler, ışık",
              "Oyunun iki motoru, tetiğin direnç göstereceği yerde L2 ve R2'de nabız ve ışık çubuğunun rengi.",
            ],
          ),
          s(
            PHONE,
            [
              "Motion",
              "The accelerometer and gyroscope are the DualSense's motion sensors, turned to however you hold the phone.",
            ],
            [
              "Hareket",
              "İvmeölçer ve jiroskop DualSense'in hareket sensörleridir; telefonu nasıl tutarsan ona göre döner.",
            ],
          ),
          s(
            PHONE,
            [
              "Your own layout per game",
              "Move, size, fade or hide any control, or make it a toggle or turbo; the computer keeps it with the game.",
            ],
            [
              "Oyuna özel kendi düzenin",
              "Her kontrolü taşı, boyutlandır, soldur ya da gizle, aç-kapa ya da turbo yap; bilgisayar oyunla birlikte saklar.",
            ],
          ),
          s(
            PHONE,
            [
              "Four phones, four players",
              "Up to four phones at once, each its own player, its number on the launcher.",
            ],
            [
              "Dört telefon, dört oyuncu",
              "Aynı anda dört telefona kadar; her biri ayrı oyuncu, numarası launcher'da.",
            ],
          ),
          s(
            PHONE,
            ["PS and Create", "PS goes back to the launcher; Create saves the last seconds as a clip."],
            ["PS ve Create", "PS launcher'a döner; Create son saniyeleri klip olarak kaydeder."],
          ),
          s(
            PHONE,
            ["Vibration test", "About › Test plays the large motor, the small one and a trigger's pulses."],
            ["Titreşim testi", "Hakkında › Test büyük motoru, küçüğü ve bir tetiğin nabızlarını çalar."],
          ),
        ],
      },
      {
        id: "launcher",
        en: "The launcher on the phone",
        tr: "Telefonda launcher",
        items: [
          s(
            PHONE,
            [
              "Launcher mode",
              "The computer's games with their icons and the same selection on both; Play, Back to Game, Close Game and the arrows drive its screen.",
            ],
            [
              "Launcher modu",
              "Bilgisayarın oyunları simgeleriyle, iki tarafta aynı seçim; Oyna, Oyuna Dön, Oyunu Kapat ve oklar onun ekranını yönetir.",
            ],
          ),
          s(
            PHONE,
            [
              "What the computer is doing",
              "While a game unlocks, updates or starts, a card shows the step, a filling bar and the time it has taken.",
            ],
            [
              "Bilgisayar ne yapıyor",
              "Oyun açılırken, güncellenirken ya da başlarken bir kart adımı, dolan çubuğu ve geçen süreyi gösterir.",
            ],
          ),
          s(
            PHONE,
            [
              "Trophies on the phone",
              "An earned trophy drops in at the top with its icon and grade, and the phone buzzes.",
            ],
            ["Telefonda kupalar", "Kazanılan kupa simgesi ve derecesiyle üstte belirir, telefon titrer."],
          ),
          s(
            PHONE,
            [
              "Remote Play",
              "The Mac's game on the phone's screen behind the pad, picture and sound, up to 720p60 in low-latency H.264.",
            ],
            [
              "Uzaktan Oynatma",
              "Mac'teki oyun görüntü ve sesiyle kumandanın arkasında telefon ekranında; düşük gecikmeli H.264 ile 720p60'a kadar.",
            ],
          ),
          s(
            PHONE,
            ["Go Live", "Start and stop the Mac's broadcast from the phone."],
            ["Yayına Geç", "Mac'in yayınını telefondan başlat ve durdur."],
          ),
          s(
            PHONE,
            [
              "Wears your theme",
              "The phone takes the launcher's colours and its language, English or Turkish.",
            ],
            ["Temanı giyer", "Telefon launcher'ın renklerini ve dilini alır: İngilizce ya da Türkçe."],
          ),
          s(
            PHONE,
            [
              "Fits every screen",
              "Checked on an iPhone SE held sideways, a Pro Max and an iPad, with larger text too.",
            ],
            ["Her ekrana sığar", "Yan tutulan iPhone SE, Pro Max ve iPad'de, büyük yazıyla da denendi."],
          ),
        ],
      },
      {
        id: "social",
        en: "AnyTogether on the phone",
        tr: "Telefonda AnyTogether",
        items: [
          s(
            PHONE,
            [
              "Sign in with one tap",
              "With an email code or the computer's account; a signed-in phone signs the launcher in, and back.",
            ],
            [
              "Tek dokunuşla oturum",
              "E-posta koduyla ya da bilgisayarın hesabıyla; oturumu açık telefon launcher'ı da açar, tersi de.",
            ],
          ),
          s(
            PHONE,
            [
              "Friends, messages, parties",
              "The same conversations as everywhere, with photos, clips, voice notes, reactions and replies; party voice with mute and deafen.",
            ],
            [
              "Arkadaşlar, mesajlar, partiler",
              "Her yerdeki aynı konuşmalar; fotoğraf, klip, sesli not, tepki ve yanıtlarla; sessize alma ve sağırlaştırmalı parti sesi.",
            ],
          ),
          s(
            PHONE,
            ["Calls over any screen", "1:1 calls; an incoming one shows over the pad too."],
            ["Her ekranın üstünde arama", "Bire bir aramalar; gelen arama kumandanın üstünde de görünür."],
          ),
          s(
            PHONE,
            [
              "Share play on the phone",
              "Watch a friend's game and, when they let you, play as player 2 to 4 with the phone's pad.",
            ],
            [
              "Telefonda Share play",
              "Arkadaşının oyununu izle; izin verirse telefonun kumandasıyla 2. ile 4. oyuncu arası ol.",
            ],
          ),
          s(
            PHONE,
            [
              "Find players, join codes",
              "The board, Live now and people; look a code or link up and ask to join; open the party's Discord link.",
            ],
            [
              "Oyuncu bul, katılma kodları",
              "İlan panosu, Şimdi canlı ve kişiler; bir kodu ya da bağlantıyı bulup katılmak iste; partinin Discord bağlantısını aç.",
            ],
          ),
          s(
            PHONE,
            [
              "Profile and progress",
              "Your profile and picture, the activity feed, leaderboards, notifications, your trophy level and Appear offline.",
            ],
            [
              "Profil ve ilerleme",
              "Profilin ve resmin, etkinlik akışı, sıralamalar, bildirimler, kupa seviyen ve Çevrimdışı görün.",
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "online",
    code: "NET",
    groups: [
      {
        id: "account",
        en: "Account and privacy",
        tr: "Hesap ve gizlilik",
        items: [
          s(
            EVERY,
            [
              "No password",
              "Sign in with a code sent by email, an email link, Discord on the website, or by typing a launcher's code on the website.",
            ],
            [
              "Parola yok",
              "E-postayla gelen kod, e-posta bağlantısı, web sitesinde Discord ya da launcher'ın gösterdiği kodu sitede yazarak giriş.",
            ],
          ),
          s(
            WEB,
            [
              "Passkeys",
              "Touch ID, Face ID, Windows Hello or your phone, added on the website; launchers sign in through it too.",
            ],
            [
              "Geçiş anahtarları",
              "Touch ID, Face ID, Windows Hello ya da telefonun, web sitesinde eklenir; launcher'lar da onunla giriş yapar.",
            ],
          ),
          s(
            APPS,
            ["One tap between devices", "A signed-in phone signs a launcher in, and a launcher the phone."],
            ["Cihazlar arası tek dokunuş", "Oturumu açık telefon bir launcher'ı açar, launcher da telefonu."],
          ),
          s(
            EVERY,
            ["Profiles", "Picture, name, handle, bio and country, with games, hours, trophies and points."],
            [
              "Profiller",
              "Resim, ad, kullanıcı adı, biyografi ve ülke; oyunlar, saatler, kupalar ve puanlarla.",
            ],
          ),
          s(
            WEB,
            [
              "Friends-only name and picture",
              "A real name and picture only you and your accepted friends see, beside your public handle; friends can report them.",
            ],
            [
              "Yalnızca arkadaşlara ad ve resim",
              "Yalnızca senin ve kabul ettiğin arkadaşlarının gördüğü gerçek ad ve resim, herkese açık kullanıcı adının yanında; arkadaşlar bildirebilir.",
            ],
          ),
          s(
            EVERY,
            [
              "Privacy per part",
              "Who sees your games, trophies, friends, online status and gallery: everyone, friends or only you.",
            ],
            [
              "Parça parça gizlilik",
              "Oyunlarını, kupalarını, arkadaşlarını, çevrimiçi durumunu ve galerini kim görür: herkes, arkadaşlar ya da yalnızca sen.",
            ],
          ),
          s(
            EVERY,
            [
              "Appear offline",
              "Friends see you as offline while messages, parties and cloud saves keep working; your other devices follow.",
            ],
            [
              "Çevrimdışı görün",
              "Arkadaşların seni çevrimdışı görür; mesajlar, partiler ve bulut kayıtları çalışır, diğer cihazların da uyar.",
            ],
          ),
          s(
            WEB,
            ["Linked accounts", "Your Steam and Discord on your profile, or kept hidden."],
            ["Bağlı hesaplar", "Steam ve Discord'un profilinde, ya da gizli."],
          ),
          s(
            WEB,
            ["Profile look", "A cover and an accent drawn in the launcher's colours; nothing is uploaded."],
            ["Profil görünümü", "Launcher'ın renkleriyle çizilen kapak ve vurgu; hiçbir şey yüklenmez."],
          ),
          s(
            WEB,
            [
              "Your data, your call",
              "See every sign-in and end it, export your data, or delete your account.",
            ],
            ["Verin, kararın", "Her oturumu gör ve kapat, verini dışa aktar ya da hesabını sil."],
          ),
        ],
      },
      {
        id: "friends",
        en: "Friends and messages",
        tr: "Arkadaşlar ve mesajlar",
        items: [
          s(
            EVERY,
            [
              "Friends and presence",
              "Online, away and what each friend plays; requests, blocking and removing.",
            ],
            [
              "Arkadaşlar ve durum",
              "Çevrimiçi, uzakta ve her arkadaşın ne oynadığı; istekler, engelleme ve çıkarma.",
            ],
          ),
          s(
            WEB,
            [
              "Recently played with",
              "People you were in a party, share play, game or post with; befriend, block or forget each.",
            ],
            [
              "Son oynadıkların",
              "Parti, Share play, oyun ya da ilanda birlikte olduğun kişiler; her birini ekle, engelle ya da unut.",
            ],
          ),
          s(
            EVERY,
            [
              "Messages and group chats",
              "Live, with typing shown and unread counts, the same on every device.",
            ],
            [
              "Mesajlar ve grup sohbetleri",
              "Canlı; yazıyor göstergesi ve okunmamış sayısıyla, her cihazda aynı.",
            ],
          ),
          s(
            EVERY,
            [
              "Reactions, replies, edits",
              "Seven reactions, replies that quote, edits within 15 minutes, unsend, Sent, Delivered and Read, pin and mute.",
            ],
            [
              "Tepkiler, yanıtlar, düzenlemeler",
              "Yedi tepki, alıntılayan yanıtlar, 15 dakika içinde düzenleme, geri alma, Gönderildi, Teslim edildi ve Okundu, sabitleme ve sessize alma.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Photos, clips and voice notes",
              "In messages, and a game's clips and screenshots straight into a chat or your profile's gallery.",
            ],
            [
              "Fotoğraflar, klipler ve sesli notlar",
              "Mesajlarda; oyunun klipleri ve görüntüleri doğrudan bir sohbete ya da profil galerine.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Notifications",
              "Requests, invites, messages and missed calls, with web push and a mail digest you control.",
            ],
            [
              "Bildirimler",
              "İstekler, davetler, mesajlar ve cevapsız aramalar; web push ve kontrolü sende bir e-posta özetiyle.",
            ],
          ),
        ],
      },
      {
        id: "party",
        en: "Parties and voice",
        tr: "Partiler ve ses",
        items: [
          s(
            EVERY,
            [
              "Parties",
              "Up to eight, with a leader who invites, removes and hands over the lead; open to friends or to anyone.",
            ],
            [
              "Partiler",
              "Sekize kadar; davet eden, çıkaran ve liderliği devreden bir liderle; arkadaşlara ya da herkese açık.",
            ],
          ),
          s(
            EVERY,
            [
              "Voice",
              "Straight from player to player, through a relay only when needed; mute, deafen and see who is speaking.",
            ],
            [
              "Ses",
              "Oyuncudan oyuncuya doğrudan, yalnızca gerekince aktarıcıyla; sessize al, sağırlaştır, kimin konuştuğunu gör.",
            ],
          ),
          s(
            DESK,
            [
              "Push-to-talk over the game",
              "⌥V on the Mac, a talk key on Windows and Linux, read while the game is in front.",
            ],
            [
              "Oyunun üstünde bas-konuş",
              "Mac'te ⌥V, Windows ve Linux'ta bir konuşma tuşu; oyun öndeyken de okunur.",
            ],
          ),
          s(
            EVERY,
            [
              "1:1 calls",
              "Call a friend; an incoming call shows over the game, with ⌥A to answer and ⌥D to decline on the Mac.",
            ],
            [
              "Bire bir aramalar",
              "Bir arkadaşını ara; gelen arama oyunun üstünde görünür, Mac'te ⌥A yanıtlar, ⌥D reddeder.",
            ],
          ),
          s(
            EVERY,
            [
              "Join codes",
              "An XXXX-XXXX code or link for people who are not friends yet; you still say yes to each one.",
            ],
            [
              "Katılma kodları",
              "Henüz arkadaş olmayanlar için XXXX-XXXX kod ya da bağlantı; her birine yine sen evet dersin.",
            ],
          ),
          s(
            M,
            [
              "Join button on Discord",
              "In a party or sharing, your Discord status says In a party, with a Join on AnyTogether button.",
            ],
            [
              "Discord'da Katıl düğmesi",
              "Partideyken ya da paylaşırken Discord durumun Partide der ve AnyTogether'da Katıl düğmesi gösterir.",
            ],
          ),
          s(
            EVERY,
            ["The party's Discord link", "The leader sets one; everyone in the party gets Open in Discord."],
            ["Partinin Discord bağlantısı", "Lider bir tane koyar; partideki herkes Discord'da Aç alır."],
          ),
        ],
      },
      {
        id: "together",
        en: "Playing together",
        tr: "Birlikte oynamak",
        items: [
          s(
            DESK,
            [
              "Join a friend's game",
              "Friends see your game as joinable and start the same one, checked against your game version and engine.",
            ],
            [
              "Arkadaşının oyununa katıl",
              "Arkadaşların oyununu katılabilir görür ve aynısını başlatır; oyun sürümüne ve motora göre denetlenir.",
            ],
          ),
          s(
            DESK,
            [
              "Online play",
              "Games see you signed in and play over WebRTC with STUN and TURN; Mac, Windows and Linux play together. Human Fall Flat hosts and joins.",
            ],
            [
              "Çevrimiçi oyun",
              "Oyunlar seni oturum açmış görür, STUN ve TURN destekli WebRTC üzerinden oynar; Mac, Windows ve Linux birlikte oynar. Human Fall Flat kurar ve katılır.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Play Together",
              "The host starts a game for the whole party; Join checks game, version and engine, offers to unlock or update, then joins the virtual LAN.",
            ],
            [
              "Birlikte Oyna",
              "Kurucu oyunu tüm parti için başlatır; Katıl oyunu, sürümü ve motoru denetler, açmayı ya da güncellemeyi önerir, sonra sanal LAN'a girer.",
            ],
            EXP,
          ),
          s(
            DESK,
            [
              "Try Anyway",
              "When only the game version keeps you out, never the engine, Join offers Try Anyway, and the party sees it.",
            ],
            [
              "Yine de Dene",
              "Seni yalnızca oyun sürümü dışarıda tutuyorsa, motor asla, Katıl Yine de Dene sunar ve parti bunu görür.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Share play",
              "Friends watch your game in a browser, on the phone or in their launcher, and one can play as player 2, 3 or 4; your pad stays player 1.",
            ],
            [
              "Share play",
              "Arkadaşların oyununu tarayıcıda, telefonda ya da launcher'da izler; biri 2., 3. ya da 4. oyuncu olabilir, senin kumandan 1. oyuncu kalır.",
            ],
          ),
          s(
            APPS,
            [
              "Asks before it matters",
              "Leaving a party, removing someone, ending Play Together or removing a friend ask first, with Cancel focused.",
            ],
            [
              "Önemli anda önce sorar",
              "Partiden ayrılmak, birini çıkarmak, Birlikte Oyna'yı bitirmek ya da arkadaş silmek önce sorar; İptal odaktadır.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Find players",
              "A looking-for-group board by game, language and now; post from a game, and whoever you accept joins your party or share play.",
            ],
            [
              "Oyuncu bul",
              "Oyuna, dile ve şimdiye göre ilan panosu; bir oyundan ilan ver, kabul ettiğin kişi partine ya da Share play'ine katılır.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Live now and game pages",
              "Public parties and share plays to join or watch, people you may know, and a page per game with who plays it now.",
            ],
            [
              "Şimdi canlı ve oyun sayfaları",
              "Katılacağın ya da izleyeceğin açık partiler ve Share play'ler, tanıyor olabileceğin kişiler, her oyunun şu an oynayanlarını gösteren sayfası.",
            ],
          ),
        ],
      },
      {
        id: "progress",
        en: "Trophies and progress",
        tr: "Kupalar ve ilerleme",
        items: [
          s(
            DESK_WEB,
            [
              "Play time and trophies",
              "Every session and trophy goes to your profile with its rarity; what you play offline goes up later, never twice.",
            ],
            [
              "Oynama süresi ve kupalar",
              "Her oturum ve kupa nadirliğiyle profiline gider; çevrimdışı oynadığın sonra gider, asla iki kez değil.",
            ],
          ),
          s(
            EVERY,
            [
              "Trophy level",
              "Your trophy points make a level in its tier's hexagon, beside your name and on friends' rows; level-ups come with the trophy sound.",
            ],
            [
              "Kupa seviyesi",
              "Kupa puanların derecesinin altıgeninde bir seviye olur; adının yanında ve arkadaş satırlarında; seviye atlama kupa sesiyle gelir.",
            ],
          ),
          s(
            DESK_WEB,
            ["Showcase", "Pin up to six trophies and four favourite games to your profile."],
            ["Vitrin", "Profiline altı kupaya ve dört favori oyuna kadar sabitle."],
          ),
          s(
            DESK_WEB,
            [
              "Compare trophies",
              "Yours and a friend's side by side, game by game: who earned what, and when.",
            ],
            [
              "Kupaları karşılaştır",
              "Seninkiler ve bir arkadaşınınkiler oyun oyun yan yana: kim neyi ne zaman kazandı.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            ["Activity feed", "Friends' trophies, first plays, milestones and new friends, with reactions."],
            [
              "Etkinlik akışı",
              "Arkadaşlarının kupaları, ilk oyunları, dönüm noktaları ve yeni arkadaşlıkları; tepkilerle.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "Leaderboards",
              "Points, play time and completion, among friends or everyone, per game or overall.",
            ],
            [
              "Sıralamalar",
              "Puan, oynama süresi ve tamamlama; arkadaşlar ya da herkes arasında, oyun başına ya da genel.",
            ],
          ),
          s(
            WEB,
            ["Fair play", "Impossible trophy patterns are held off the boards until a moderator looks."],
            ["Adil oyun", "İmkânsız kupa desenleri bir moderatör bakana dek sıralamalara girmez."],
          ),
        ],
      },
      {
        id: "community",
        en: "Communities, themes, compatibility",
        tr: "Topluluklar, temalar, uyumluluk",
        items: [
          s(
            WEB,
            [
              "Communities",
              "Groups around a game or a crowd, each with its own chat, invites and moderators.",
            ],
            [
              "Topluluklar",
              "Bir oyun ya da bir kalabalık etrafında gruplar; her birinin kendi sohbeti, davetleri ve moderatörleri.",
            ],
          ),
          s(
            WEB,
            ["Events", "Planned play nights in a community, shown in your own time zone."],
            ["Etkinlikler", "Bir toplulukta planlanmış oyun geceleri; kendi saat diliminde gösterilir."],
          ),
          s(
            ["mac", "web"],
            [
              "Theme Hub",
              "Themes made in the launcher's Theme Studio, liked, downloaded and installed with one press.",
            ],
            [
              "Tema Hub'ı",
              "Launcher'ın Tema Stüdyosu'nda yapılan temalar; beğenilir, indirilir, tek basışla kurulur.",
            ],
          ),
          s(
            ["mac", "web"],
            [
              "Compatibility list",
              "How far each game gets on each platform, from one-tap “How did it run?” reports on the newest launcher.",
            ],
            [
              "Uyumluluk listesi",
              "Her oyunun her platformda nereye kadar gittiği; en yeni launcher'dan tek dokunuşla “Nasıl çalıştı?” raporları.",
            ],
          ),
        ],
      },
      {
        id: "cloud",
        en: "Cloud and family",
        tr: "Bulut ve aile",
        items: [
          s(
            ["mac", "web"],
            [
              "Cloud saves",
              "Save Sync through AnyTogether: this Mac's saves or the newer ones, uploads that resume, and versions to restore or delete.",
            ],
            [
              "Bulut kayıtları",
              "AnyTogether üzerinden Kayıt Eşitleme: bu Mac'in kayıtları ya da daha yenileri, kaldığı yerden süren yüklemeler, geri yüklenecek ya da silinecek sürümler.",
            ],
          ),
          s(
            MAC_PHONE_WEB,
            [
              "100 MB of cloud storage",
              "Shared by saves and media, with what each takes shown in Settings › Storage.",
            ],
            [
              "100 MB bulut alanı",
              "Kayıtlar ve medya paylaşır; her birinin ne kadar tuttuğu Ayarlar › Depolama'da görünür.",
            ],
          ),
          s(
            DESK_WEB,
            [
              "Family controls",
              "Parents set age limits, daily play time and who a child can message, call or play with; launchers follow them offline too.",
            ],
            [
              "Aile denetimleri",
              "Ebeveynler yaş sınırını, günlük oyun süresini ve çocuğun kime yazıp kimi arayabileceğini, kiminle oynayabileceğini belirler; launcher'lar çevrimdışı da uyar.",
            ],
          ),
          s(
            DESK,
            [
              "Asking for more time",
              "Play time is warned about before it runs out, the game closes gently, and a child can ask a parent for more.",
            ],
            [
              "Ek süre istemek",
              "Süre bitmeden uyarılır, oyun nazikçe kapanır ve çocuk ebeveyninden ek süre isteyebilir.",
            ],
          ),
        ],
      },
      {
        id: "trust",
        en: "Safety and running your own",
        tr: "Güvenlik ve kendi sunucun",
        items: [
          s(
            WEB,
            [
              "Reports and moderation",
              "Report posts, media, communities, events and private names; moderators restrict with a reason, and you can appeal.",
            ],
            [
              "Şikâyet ve moderasyon",
              "İlanları, medyayı, toplulukları, etkinlikleri ve gizli adları şikâyet et; moderatörler gerekçeyle kısıtlar, sen itiraz edebilirsin.",
            ],
          ),
          s(
            APPS,
            [
              "Update Required",
              "When a version is retired, the launcher says so once and offers its own update; the phone opens the downloads page.",
            ],
            [
              "Güncelleme Gerekli",
              "Bir sürüm emekliye ayrılınca launcher bunu bir kez söyler ve kendi güncellemesini sunar; telefon indirmeler sayfasını açar.",
            ],
          ),
          s(
            WEB,
            [
              "Installable website",
              "Add the site to your home screen or dock and it opens in its own window.",
            ],
            ["Kurulabilir site", "Siteyi ana ekranına ya da Dock'a ekle; kendi penceresinde açılır."],
          ),
          s(
            EVERY,
            [
              "Open source, self-hosted",
              "MIT. docker compose runs the whole server on one machine with HTTPS and an optional TURN relay; launchers point at it in Settings.",
            ],
            [
              "Açık kaynak, kendi sunucun",
              "MIT. docker compose tüm sunucuyu HTTPS ve isteğe bağlı TURN aktarıcısıyla tek makinede çalıştırır; launcher'lar Ayarlar'dan ona bağlanır.",
            ],
          ),
          s(
            WEB,
            [
              "Encrypted backups",
              "Scheduled, encrypted backups of the database and files to a target you choose, and restores.",
            ],
            [
              "Şifreli yedekler",
              "Veritabanının ve dosyaların seçtiğin hedefe zamanlanmış, şifreli yedekleri ve geri yüklemeler.",
            ],
          ),
          s(
            EVERY,
            ["Tested together", "Every client is checked against one real server in a cross-client test."],
            ["Birlikte denenir", "Her istemci ortak bir testte tek bir gerçek sunucuya karşı denenir."],
          ),
        ],
      },
    ],
  },
  {
    id: "more",
    code: "EXT",
    groups: [
      {
        id: "browser",
        en: "Browser pad",
        tr: "Tarayıcı kumandası",
        items: [
          s(
            ["mac", "windows", "linux", "web"],
            [
              "Play from a browser",
              "Scan a QR code and a phone without the app becomes a DualSense in its browser, as player 2 to 4, with light bar, player lights and vibration on Android.",
            ],
            [
              "Tarayıcıdan oyna",
              "QR kodu tara; uygulaması olmayan telefon tarayıcısında DualSense olur, 2. ile 4. oyuncu arası; ışık çubuğu, oyuncu ışıkları ve Android'de titreşimle.",
            ],
            { next: { project: "macos", version: "0.2.23", on: ["mac"] } },
          ),
          s(
            ["mac", "windows", "linux", "web"],
            [
              "Locked down by default",
              "Local network only: a one-time link for two minutes that becomes a cookie, origin and host checks, rate limits, a server only while wanted.",
            ],
            [
              "Varsayılan olarak kilitli",
              "Yalnızca yerel ağ: çereze dönüşen iki dakikalık tek kullanımlık bağlantı, köken ve ana makine kontrolleri, hız sınırları, yalnızca gerektiğinde çalışan sunucu.",
            ],
            { next: { project: "macos", version: "0.2.23", on: ["mac"] } },
          ),
        ],
      },
      {
        id: "deck",
        en: "Steam Deck",
        tr: "Steam Deck",
        items: [
          s(
            LIN,
            [
              "Game Mode",
              "AnyPS5 Desktop added to Steam starts in the Deck's Game Mode like any other game, with Steam Input.",
            ],
            [
              "Oyun Modu",
              "Steam'e eklenen AnyPS5 Desktop, Deck'in Oyun Modu'nda her oyun gibi, Steam Input ile açılır.",
            ],
          ),
        ],
      },
      {
        id: "trust",
        en: "Signing and updates",
        tr: "İmza ve güncellemeler",
        items: [
          s(
            DESK,
            [
              "Signed releases",
              "Every release lists its files in SHA256SUMS with an Ed25519 signature (key f8fe0d55df962105), checkable with verify.sh.",
            ],
            [
              "İmzalı sürümler",
              "Her sürüm dosyalarını Ed25519 imzalı SHA256SUMS'ta listeler (anahtar f8fe0d55df962105); verify.sh ile denetlenir.",
            ],
          ),
          s(
            DESK,
            [
              "Updates that check first",
              "Launchers refuse an update or a downloaded engine whose signature does not match a key they already trust.",
            ],
            [
              "Önce denetleyen güncellemeler",
              "Launcher'lar, imzası zaten güvendikleri bir anahtarla eşleşmeyen güncellemeyi ya da indirilen motoru reddeder.",
            ],
          ),
          s(
            WEB,
            [
              "Downloads with checksums",
              "Every file of the latest releases by platform, with its version, size, date and SHA-256.",
            ],
            [
              "Sağlamalı indirmeler",
              "Son sürümlerin her dosyası platforma göre; sürümü, boyutu, tarihi ve SHA-256'sıyla.",
            ],
          ),
        ],
      },
      {
        id: "languages",
        en: "Languages",
        tr: "Diller",
        items: [
          s(
            EVERY,
            [
              "English and Turkish everywhere",
              "The launchers, the phone app, the browser pad, this website and the user guide, all in both.",
            ],
            [
              "Her yerde İngilizce ve Türkçe",
              "Launcher'lar, telefon uygulaması, tarayıcı kumandası, bu site ve kullanım kılavuzu; hepsi iki dilde.",
            ],
          ),
        ],
      },
    ],
  },
];

/** True when version a is newer than b ("0.2.23" > "0.2.22"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export type Published = Record<Project, string>;

/** The newest published versions: the release list's, or the ones known when the sheet was
 *  checked when the list cannot be reached (or is older than them). */
export function publishedVersions(latest: Partial<Record<Project, string | null | undefined>>): Published {
  const pick = (project: Project) => {
    const seen = latest[project];
    const known = publishedWhenChecked[project];
    return seen && isNewer(seen, known) ? seen : known;
  };
  return { macos: pick("macos"), desktop: pick("desktop") };
}

/** Whether a "next release" mark still applies: its version is not out yet. */
export const stillNext = (next: NextRelease | undefined, published: Published) =>
  !!next && isNewer(next.version, published[next.project]);

/** Every item with its reference code (ENG-01) and anchor (eng-01), in page order. */
export function codedItems(section: SpecSection) {
  let n = 0;
  return section.groups.map((group) => ({
    group,
    items: group.items.map((item) => {
      n += 1;
      const code = `${section.code}-${String(n).padStart(2, "0")}`;
      return { item, code, anchor: code.toLowerCase() };
    }),
  }));
}

export const countOf = (section: SpecSection) => section.groups.reduce((sum, g) => sum + g.items.length, 0);
export const totalCount = (list: SpecSection[] = sections) => list.reduce((sum, s) => sum + countOf(s), 0);

/** The platforms a section's items run on, in the badge order. */
export const platformsOf = (section: SpecSection) =>
  specPlatforms.filter((p) => section.groups.some((g) => g.items.some((item) => item.p.includes(p))));

export const textOf = (item: Spec, language: Language) => item[language];

/** The repositories, their branches (one line each) and the credits, for "Source & downloads". */
export interface Branch {
  name: string;
  en: string;
  tr: string;
}
export interface Repo {
  repo: string;
  name: string;
  license: string;
  /** Which entry of the release list (lib/site loadReleases) is this repository's; none for
   *  AnyTogether, which deploys from main without tagged releases. */
  project?: Project;
  en: string;
  tr: string;
  branches: Branch[];
  /** Branches folded into main, named on one line. */
  merged?: string[];
}

export const repositories: Repo[] = [
  {
    repo: "utkuhalis/AnyPS5-ARM",
    name: "AnyPS5-ARM",
    license: "GPL-2.0",
    project: "macos",
    en: "The engine for Apple-silicon Macs, the Mac launcher, the phone app and the Windows and Linux engine builds.",
    tr: "Apple silicon Mac'ler için motor, Mac launcher'ı, telefon uygulaması ve Windows ile Linux motor derlemeleri.",
    branches: [
      {
        name: "main",
        en: "The whole project: engine, launcher and phone app. Releases are made from it.",
        tr: "Projenin tamamı: motor, launcher ve telefon uygulaması. Sürümler buradan çıkar.",
      },
      {
        name: "launcher",
        en: "The launcher (AnyPS5.app) on its own.",
        tr: "Yalnızca launcher (AnyPS5.app).",
      },
      {
        name: "mobile-controller",
        en: "The phone app, AnyPS5 Remote, on its own.",
        tr: "Yalnızca telefon uygulaması, AnyPS5 Remote.",
      },
      {
        name: "rosetta",
        en: "The engine alone, as it runs today: x86-64 code under Rosetta 2.",
        tr: "Yalnızca motor, bugünkü haliyle: Rosetta 2 altında x86-64 kodu.",
      },
      {
        name: "native-arm64",
        en: "The engine running games as native arm64 code, without Rosetta (experimental).",
        tr: "Oyunları Rosetta olmadan yerel arm64 kodu olarak çalıştıran motor (deneysel).",
      },
      {
        name: "anytogether",
        en: "The AnyTogether plan, phase by phase, in English and Turkish.",
        tr: "AnyTogether planı, aşama aşama, İngilizce ve Türkçe.",
      },
      {
        name: "dlc-presets",
        en: "Work in progress: updates and add-ons from your own dumps, and Game Presets. Not merged yet.",
        tr: "Süren çalışma: kendi dump'larından güncellemeler ve ek içerikler, Oyun Ön Ayarları. Henüz birleşmedi.",
      },
      {
        name: "profiles",
        en: "Work in progress: several profiles on one launcher. Not merged yet.",
        tr: "Süren çalışma: tek launcher'da birden çok profil. Henüz birleşmedi.",
      },
      {
        name: "release/0.2.23",
        en: "The 0.2.23 release as it was cut.",
        tr: "0.2.23 sürümü, kesildiği haliyle.",
      },
    ],
    merged: [
      "browser-pad",
      "feedback-ux-mac",
      "online-play",
      "online-p2p-streams",
      "phone-levels",
      "power-profiles",
      "remotepad-winsock",
      "together-levels",
      "windows-engine",
      "release/0.2.22",
    ],
  },
  {
    repo: "utkuhalis/AnyPS5-Desktop",
    name: "AnyPS5 Desktop",
    license: "GPL-2.0",
    project: "desktop",
    en: "The launcher for Windows and Linux, in Flutter: the same home screen, unlocking, controls, trophies and AnyTogether.",
    tr: "Windows ve Linux launcher'ı, Flutter ile: aynı ana ekran, kilit açma, kontroller, kupalar ve AnyTogether.",
    branches: [
      {
        name: "main",
        en: "The launcher; releases (installers, AppImage, .deb) are made from it.",
        tr: "Launcher; sürümler (kurulumlar, AppImage, .deb) buradan çıkar.",
      },
      {
        name: "dlc-presets",
        en: "Work in progress: Game Presets, and a game's DLC and update on its page. Not merged yet.",
        tr: "Süren çalışma: Oyun Ön Ayarları, oyunun sayfasında DLC'leri ve güncellemesi. Henüz birleşmedi.",
      },
      {
        name: "profiles",
        en: "Work in progress: several profiles, and an offline or online first start. Not merged yet.",
        tr: "Süren çalışma: birden çok profil, çevrimdışı ya da çevrimiçi ilk açılış. Henüz birleşmedi.",
      },
      {
        name: "release/0.1.9",
        en: "The 0.1.9 release as it was cut.",
        tr: "0.1.9 sürümü, kesildiği haliyle.",
      },
    ],
    merged: ["browser-pad", "feedback-ux", "online-p2p-streams", "together-levels", "release/0.1.8"],
  },
  {
    repo: "utkuhalis/AnyTogether",
    name: "AnyTogether",
    license: "MIT",
    en: "The online home: the API, the realtime gateway, the worker, backups and this website. Runs from main, no tagged releases.",
    tr: "Çevrimiçi ev: API, gerçek zamanlı geçit, arka plan işleri, yedekler ve bu site. main'den çalışır, etiketli sürüm yok.",
    branches: [
      {
        name: "main",
        en: "What runs on anytogether.kodla.agency; every push to it goes live.",
        tr: "anytogether.kodla.agency'de çalışan; ona her gönderim yayına girer.",
      },
    ],
    merged: ["staging", "family", "gaps", "landing", "motion", "polish", "psn", "site2", "storage"],
  },
];

export interface Credit {
  name: string;
  href: string;
  en: string;
  tr: string;
}

export const credits: Credit[] = [
  {
    name: "boykopovar/AnyPS5",
    href: "https://github.com/boykopovar/AnyPS5",
    en: "The upstream project this is built on: the relinker and the system libraries (GPL-2.0).",
    tr: "Bunun üzerine kurulduğu upstream proje: relinker ve sistem kütüphaneleri (GPL-2.0).",
  },
  {
    name: "mugurc/AnyPS5 macos-port",
    href: "https://github.com/mugurc/AnyPS5/tree/macos-port",
    en: "The community macOS port the Mac engine started from.",
    tr: "Mac motorunun yola çıktığı topluluk macOS portu.",
  },
  {
    name: "anyplaynet/network",
    href: "https://github.com/anyplaynet/network/blob/main/spec/bridge-protocol.md",
    en: "AnyPlay's bridge spec, the base of online play's protocol: frame header, message numbering, virtual LAN range, game screening (MIT/Apache-2.0).",
    tr: "AnyPlay'in köprü belirtimi, çevrimiçi oyun protokolünün temeli: çerçeve başlığı, mesaj numaralandırması, sanal LAN aralığı, oyun eleme (MIT/Apache-2.0).",
  },
  {
    name: "anyplaynet/AnyPS5",
    href: "https://github.com/anyplaynet/AnyPS5",
    en: "AnyPlay's engine bridge showed the approach for stream P2P sockets over the bridge (GPL-2.0); our frames and relay are our own.",
    tr: "AnyPlay'in motor köprüsü, köprü üzerinden akış P2P soketleri yaklaşımını gösterdi (GPL-2.0); çerçevelerimiz ve aktarıcımız bizim.",
  },
  {
    name: "anyplaynet/launcher, anyplaynet/cloud",
    href: "https://github.com/anyplaynet/launcher",
    en: "Ideas AnyPlay shipped first: Try anyway, Update required, confirmations before leaving, the browser pad by QR code. Code written independently.",
    tr: "AnyPlay'in ilk çıkardığı fikirler: Yine de dene, Güncelleme gerekli, ayrılmadan önce onay, QR kodla tarayıcı kumandası. Kod bağımsız yazıldı.",
  },
  {
    name: "MoltenVK, SDL2, LibAtrac9, Noto",
    href: "https://github.com/KhronosGroup/MoltenVK",
    en: "Vulkan on Metal, controllers (zlib), ATRAC9 theme songs (MIT) and the system fonts (SIL Open Font License 1.1).",
    tr: "Metal üzerinde Vulkan, kumandalar (zlib), ATRAC9 tema şarkıları (MIT) ve sistem yazı tipleri (SIL Open Font License 1.1).",
  },
];
