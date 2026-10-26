/** The status board on /specs#status: what shipped lately, what is being built and what is
 *  planned. To update it, edit this file only: move a card to another column, add or remove one,
 *  and change `updated`.
 *
 *  - `release` names the release a done card came in (shown as it is written).
 *  - `ships` marks an in-progress card that is finished on main and waits for a release. Until
 *    that version is published the card says "Next release"; once it is out, the card moves to
 *    Done by itself, with that release as its tag.
 *  - Platforms: mac, windows, linux, iphone (iOS), android, web. */

import type { SpecPlatform } from "@/lib/specs";

export type StatusColumn = "done" | "progress" | "planned";
export const statusColumns: StatusColumn[] = ["done", "progress", "planned"];

export interface StatusCard {
  id: string;
  column: StatusColumn;
  platforms: SpecPlatform[];
  release?: string;
  ships?: { project: "macos" | "desktop"; version: string };
  en: { t: string; d: string };
  tr: { t: string; d: string };
}

/** When the board was last checked. */
export const updated = "2026-10-26";

const desk: SpecPlatform[] = ["mac", "windows", "linux"];
const pc: SpecPlatform[] = ["windows", "linux"];
const phone: SpecPlatform[] = ["iphone", "android"];
const all: SpecPlatform[] = ["mac", "windows", "linux", "iphone", "android", "web"];

export const statusCards: StatusCard[] = [
  // Done, newest first.
  {
    id: "desktop-couch",
    column: "done",
    platforms: pc,
    release: "AnyPS5 Desktop 0.1.9",
    en: {
      t: "The couch release for PC",
      d: "Full screen, Settings with a pad, the PS quick menu, Create clips, Shortcuts and play from a browser.",
    },
    tr: {
      t: "PC için koltuk sürümü",
      d: "Tam ekran, kumandayla Ayarlar, PS hızlı menü, Create klipleri, Kısayollar ve tarayıcıdan oynama.",
    },
  },
  {
    id: "private-identity",
    column: "done",
    platforms: ["web"],
    release: "Website",
    en: {
      t: "Friends-only name and picture",
      d: "A real name and picture only you and your friends see, beside your public handle.",
    },
    tr: {
      t: "Yalnızca arkadaşlara ad ve resim",
      d: "Herkese açık kullanıcı adının yanında yalnızca senin ve arkadaşlarının gördüğü gerçek ad ve resim.",
    },
  },
  {
    id: "play-together",
    column: "done",
    platforms: desk,
    release: "AnyPS5-ARM 0.2.22 · Desktop 0.1.8",
    en: {
      t: "Play Together and online play",
      d: "The party's host starts a game for everyone, over a virtual LAN on WebRTC. Experimental.",
    },
    tr: {
      t: "Birlikte Oyna ve çevrimiçi oyun",
      d: "Partinin kurucusu oyunu herkes için başlatır; WebRTC üzerinde sanal LAN. Deneysel.",
    },
  },
  {
    id: "hff",
    column: "done",
    platforms: desk,
    release: "AnyPS5-ARM 0.2.22",
    en: {
      t: "Human Fall Flat online",
      d: "Host Public and Join work, and stream P2P sockets carry games that talk TCP between players.",
    },
    tr: {
      t: "Human Fall Flat çevrimiçi",
      d: "Herkese Açık Kur ve Katıl çalışıyor; akış P2P soketleri oyuncular arası TCP konuşan oyunları taşıyor.",
    },
  },
  {
    id: "windows-pad",
    column: "done",
    platforms: ["windows", "iphone", "android"],
    release: "AnyPS5-ARM 0.2.22 · Desktop 0.1.8",
    en: {
      t: "The phone in Windows games",
      d: "The remote pad works over Winsock, so the phone is a controller in games on Windows too.",
    },
    tr: {
      t: "Windows oyunlarında telefon",
      d: "Uzaktan kumanda Winsock üzerinden çalışıyor; telefon Windows oyunlarında da kumanda.",
    },
  },
  {
    id: "phone-1-17",
    column: "done",
    platforms: phone,
    release: "AnyPS5 Remote 1.17",
    en: {
      t: "A phone app for small screens",
      d: "Every tab checked on an iPhone SE, a Pro Max and an iPad; join codes, deafen and a vibration test.",
    },
    tr: {
      t: "Küçük ekranlara uyan telefon uygulaması",
      d: "Her sekme iPhone SE, Pro Max ve iPad'de denendi; katılma kodları, sağırlaştırma ve titreşim testi.",
    },
  },
  {
    id: "controllers",
    column: "done",
    platforms: desk,
    release: "AnyPS5-ARM 0.2.21 · Desktop 0.1.7",
    en: {
      t: "Controllers and a troubleshooter",
      d: "A screen for every pad with live tests, and a troubleshooter that says what keeps one away.",
    },
    tr: {
      t: "Kumandalar ve sorun giderici",
      d: "Her kumanda için canlı testli bir ekran ve birini neyin uzak tuttuğunu söyleyen sorun giderici.",
    },
  },
  {
    id: "steam",
    column: "done",
    platforms: desk,
    release: "AnyPS5-ARM 0.2.21 · Desktop 0.1.7",
    en: {
      t: "Add to Steam",
      d: "AnyPS5 and every unlocked game in your Steam library with their own art; on the Steam Deck too.",
    },
    tr: {
      t: "Steam'e Ekle",
      d: "AnyPS5 ve her açılmış oyun kendi görselleriyle Steam kütüphanende; Steam Deck'te de.",
    },
  },
  {
    id: "glass",
    column: "done",
    platforms: desk,
    release: "AnyPS5-ARM 0.2.20 · Desktop 0.1.7",
    en: { t: "Glass", d: "A see-through theme with your desktop frosted behind it and an Ice accent." },
    tr: { t: "Cam", d: "Arkasında masaüstünün buzlu göründüğü saydam tema ve Buz vurgusu." },
  },
  {
    id: "levels",
    column: "done",
    platforms: all,
    release: "AnyPS5-ARM 0.2.19 · Desktop 0.1.5",
    en: {
      t: "Trophy levels and showcases",
      d: "Your level in its tier's hexagon, pinned trophies and games, Compare trophies and Appear offline.",
    },
    tr: {
      t: "Kupa seviyeleri ve vitrinler",
      d: "Derecesinin altıgeninde seviyen, sabitlenmiş kupalar ve oyunlar, Kupaları karşılaştır ve Çevrimdışı görün.",
    },
  },

  // In progress.
  {
    id: "mac-couch",
    column: "progress",
    platforms: ["mac"],
    ships: { project: "macos", version: "0.2.23" },
    en: {
      t: "The couch release for the Mac",
      d: "Full screen, Settings with a pad, the PS quick menu, clips up to 5 minutes, Shortcuts and play from a browser.",
    },
    tr: {
      t: "Mac için koltuk sürümü",
      d: "Tam ekran, kumandayla Ayarlar, PS hızlı menü, 5 dakikaya kadar klipler, Kısayollar ve tarayıcıdan oynama.",
    },
  },
  {
    id: "pause-press",
    column: "progress",
    platforms: desk,
    ships: { project: "macos", version: "0.2.23" },
    en: {
      t: "Pause with a pad on player 1",
      d: "A press packet holds Options on player 1's pad, so the quick menu pauses a game whoever drives it.",
    },
    tr: {
      t: "1. oyuncuda kumandayla duraklatma",
      d: "Bir basış paketi 1. oyuncunun kumandasında Options'a basar; hızlı menü oyunu kim sürerse sürsün duraklatır.",
    },
  },
  {
    id: "battery-heat",
    column: "progress",
    platforms: ["mac"],
    ships: { project: "macos", version: "0.2.24" },
    en: {
      t: "Battery and heat profiles",
      d: "On battery or when a MacBook runs hot: a frame cap, lower resolution and frame generation paused, with Undo.",
    },
    tr: {
      t: "Pil ve ısı profilleri",
      d: "Pildeyken ya da MacBook ısındığında: kare sınırı, düşük çözünürlük ve duraklayan kare üretimi; Geri Al ile.",
    },
  },
  {
    id: "profiles",
    column: "progress",
    platforms: desk,
    en: {
      t: "Profiles",
      d: "An offline or online choice on the first start, several profiles on one launcher, and Who's playing?",
    },
    tr: {
      t: "Profiller",
      d: "İlk açılışta çevrimdışı ya da çevrimiçi seçimi, tek launcher'da birden çok profil ve Kim oynuyor?",
    },
  },
  {
    id: "dlc",
    column: "progress",
    platforms: desk,
    en: {
      t: "DLC and game updates",
      d: "A game's update and add-ons from your own dumps, placed beside the game and started with it.",
    },
    tr: {
      t: "DLC ve oyun güncellemeleri",
      d: "Oyunun güncellemesi ve ek içerikleri kendi dump'larından; oyunun yanına konur ve onunla başlar.",
    },
  },
  {
    id: "presets",
    column: "progress",
    platforms: desk,
    en: {
      t: "Game Presets",
      d: "Difficulty, inverted camera, subtitles, audio language and performance mode, set once for every game.",
    },
    tr: {
      t: "Oyun Ön Ayarları",
      d: "Zorluk, ters kamera, altyazılar, ses dili ve performans modu; her oyun için bir kez ayarlanır.",
    },
  },
  {
    id: "native-arm64",
    column: "progress",
    platforms: ["mac"],
    en: {
      t: "Native arm64 engine",
      d: "Games as arm64 code with no Rosetta; DOOM already plays E1M1 at its own 35 FPS.",
    },
    tr: {
      t: "Yerel arm64 motoru",
      d: "Oyunlar Rosetta olmadan arm64 kodu olarak; DOOM şimdiden E1M1'i kendi 35 FPS'iyle oynuyor.",
    },
  },

  // Planned.
  {
    id: "assist",
    column: "planned",
    platforms: desk,
    en: { t: "Assist mode", d: "A second pad, or a friend, helps player 1 in the same seat." },
    tr: {
      t: "Yardım modu",
      d: "İkinci bir kumanda ya da bir arkadaş, aynı koltukta 1. oyuncuya yardım eder.",
    },
  },
  {
    id: "gyro",
    column: "planned",
    platforms: ["mac", "windows", "linux", "iphone", "android"],
    en: {
      t: "Gyro aiming for every game",
      d: "Aim with a controller's or a phone's motion, even in games that never read it.",
    },
    tr: {
      t: "Her oyunda jiroskopla nişan",
      d: "Hareketi hiç okumayan oyunlarda bile kumandanın ya da telefonun hareketiyle nişan al.",
    },
  },
  {
    id: "phone-typing",
    column: "planned",
    platforms: phone,
    en: {
      t: "Type on your phone",
      d: "When a game asks for text, the phone's keyboard comes up to write it.",
    },
    tr: { t: "Telefonundan yaz", d: "Oyun metin istediğinde yazmak için telefonun klavyesi açılır." },
  },
  {
    id: "trophy-tracker",
    column: "planned",
    platforms: desk,
    en: {
      t: "Trophy tracker over the game",
      d: "Pin trophies and follow their progress over the game as you play.",
    },
    tr: {
      t: "Oyunun üstünde kupa takibi",
      d: "Kupaları sabitle, oynarken ilerlemelerini oyunun üstünde izle.",
    },
  },
  {
    id: "accessibility",
    column: "planned",
    platforms: desk,
    en: { t: "Accessibility pack", d: "Colour filters, mono audio and button remapping for every game." },
    tr: { t: "Erişilebilirlik paketi", d: "Her oyun için renk filtreleri, mono ses ve tuş yeniden atama." },
  },
  {
    id: "captions",
    column: "planned",
    platforms: all,
    en: { t: "Party captions and read-aloud", d: "Live captions for party voice, and messages read aloud." },
    tr: {
      t: "Parti altyazıları ve sesli okuma",
      d: "Parti sesine canlı altyazı ve mesajların sesli okunması.",
    },
  },
  {
    id: "moonlight",
    column: "planned",
    platforms: desk,
    en: { t: "Moonlight-compatible host", d: "Stream a game from the launcher to any Moonlight client." },
    tr: { t: "Moonlight uyumlu sunucu", d: "Oyunu launcher'dan herhangi bir Moonlight istemcisine aktar." },
  },
  {
    id: "storage",
    column: "planned",
    platforms: desk,
    en: {
      t: "Storage screen",
      d: "What each game, its saves and its captures take on disk, and room freed from one place.",
    },
    tr: {
      t: "Depolama ekranı",
      d: "Her oyunun, kayıtlarının ve çekimlerinin diskte kapladığı yer; tek yerden yer aç.",
    },
  },
  {
    id: "mods",
    column: "planned",
    platforms: desk,
    en: { t: "Mods folder", d: "A folder for each game's mods, picked up when the game starts." },
    tr: { t: "Mod klasörü", d: "Her oyunun modları için, oyun başlarken alınan bir klasör." },
  },
  {
    id: "remote-play-internet",
    column: "planned",
    platforms: ["mac", "iphone", "android"],
    en: {
      t: "Remote Play over the internet",
      d: "The Mac's game on your phone away from home, not only on the same Wi-Fi.",
    },
    tr: {
      t: "İnternet üzerinden Uzaktan Oynatma",
      d: "Mac'teki oyun yalnızca aynı Wi-Fi'da değil, evden uzaktayken de telefonunda.",
    },
  },
  {
    id: "notarized",
    column: "planned",
    platforms: ["mac"],
    en: {
      t: "Signed and notarized Mac builds",
      d: "Developer ID and notarization, so the zip opens without the Privacy & Security step.",
    },
    tr: {
      t: "İmzalı ve onaylı Mac sürümleri",
      d: "Developer ID ve Apple onayı; zip, Gizlilik ve Güvenlik adımı olmadan açılır.",
    },
  },
  {
    id: "phone-push",
    column: "planned",
    platforms: phone,
    en: { t: "Push notifications on the phone", d: "Messages, invites and calls on a locked phone." },
    tr: { t: "Telefonda anlık bildirimler", d: "Kilitli telefonda mesajlar, davetler ve aramalar." },
  },
  {
    id: "desktop-together",
    column: "planned",
    platforms: pc,
    en: {
      t: "Share play and the feed on PC",
      d: "Hosting and watching share play, the activity feed and leaderboards on Windows and Linux.",
    },
    tr: {
      t: "PC'de Share play ve akış",
      d: "Windows ve Linux'ta Share play yayınlama ve izleme, etkinlik akışı ve sıralamalar.",
    },
  },
  {
    id: "languages",
    column: "planned",
    platforms: all,
    en: {
      t: "More languages",
      d: "Beyond English and Turkish, for the launchers, the phone and this website.",
    },
    tr: { t: "Daha çok dil", d: "İngilizce ve Türkçenin ötesinde; launcher'lar, telefon ve bu site için." },
  },
  {
    id: "party-chat",
    column: "planned",
    platforms: all,
    en: { t: "Party chat", d: "A text chat beside a party's voice, everywhere." },
    tr: { t: "Parti sohbeti", d: "Bir partinin sesinin yanında yazılı sohbet, her yerde." },
  },
  {
    id: "headset",
    column: "planned",
    platforms: phone,
    en: {
      t: "The phone as a headset",
      d: "The party's voice through the phone while it is also the controller.",
    },
    tr: { t: "Kulaklık olarak telefon", d: "Telefon kumandayken partinin sesi de onun üzerinden." },
  },
  {
    id: "e2ee",
    column: "planned",
    platforms: all,
    en: {
      t: "End-to-end encrypted messages",
      d: "Direct messages and voice only the two of you can read and hear.",
    },
    tr: {
      t: "Uçtan uca şifreli mesajlar",
      d: "Yalnızca ikinizin okuyup duyabileceği doğrudan mesajlar ve ses.",
    },
  },
  {
    id: "stores",
    column: "planned",
    platforms: phone,
    en: {
      t: "The phone app in the stores",
      d: "AnyPS5 Remote on the App Store and Google Play, no sideloading.",
    },
    tr: {
      t: "Mağazalarda telefon uygulaması",
      d: "AnyPS5 Remote App Store ve Google Play'de; yan yükleme yok.",
    },
  },
  {
    id: "big-rooms",
    column: "planned",
    platforms: all,
    en: {
      t: "Share play for many viewers",
      d: "More than four viewers, and parties with more than eight people talking.",
    },
    tr: {
      t: "Çok izleyicili Share play",
      d: "Dörtten fazla izleyici ve sekizden fazla kişinin konuştuğu partiler.",
    },
  },
  {
    id: "public-api",
    column: "planned",
    platforms: ["web"],
    en: {
      t: "Challenges and a public API",
      d: "Tournaments and challenges on the leaderboards, and an API for community tools.",
    },
    tr: {
      t: "Meydan okumalar ve açık API",
      d: "Sıralamalarda turnuvalar ve meydan okumalar, topluluk araçları için bir API.",
    },
  },
];
