/** The public roadmap: what is done, in progress, next and later, across AnyPS5-ARM (the Mac
 *  launcher, the engine and the phone app), AnyPS5 Desktop and AnyTogether. To update it, move an
 *  item to another status, add one, or change `updated`; the page reads nothing else. It follows the
 *  plan on AnyPS5-ARM's `anytogether` branch (docs/en/10-roadmap.md, 03-features.md,
 *  11-open-questions.md) and what the releases shipped. Only what is true goes here. */

export type Status = "done" | "progress" | "next" | "later";
export type Area = "mac" | "pc" | "phone" | "online" | "engine";

export interface RoadmapItem {
  id: string;
  status: Status;
  areas: Area[];
  /** The release it came in, for done items: "AnyPS5-ARM 0.2.15". */
  shipped?: string;
  en: { t: string; d: string };
  tr: { t: string; d: string };
}

export const statuses: Status[] = ["done", "progress", "next", "later"];

/** When the list was last checked against the plan and the releases. */
export const updated = "2026-10-30";

export const planDocs = {
  en: "https://github.com/AnyTogether/AnyPS5-ARM/blob/anytogether/docs/en/10-roadmap.md",
  tr: "https://github.com/AnyTogether/AnyPS5-ARM/blob/anytogether/docs/tr/10-yol-haritasi.md",
};

export const roadmap: RoadmapItem[] = [
  // Done, newest first.
  {
    id: "opus",
    status: "done",
    areas: ["mac", "online"],
    shipped: "AnyPS5-ARM 0.2.17",
    en: {
      t: "Opus game sound in share play",
      d: "The game's sound as a stereo Opus track, about 128 kbit/s instead of 1.5 Mbit/s, for hosts on slow uploads. The Mac launcher sends it and watching in a browser plays it. Viewers without it still get the old sound.",
    },
    tr: {
      t: "Birlikte oynamada Opus oyun sesi",
      d: "Oyun sesi stereo bir Opus izi olarak, 1,5 Mbit/s yerine yaklaşık 128 kbit/s, yükleme hızı düşük olanlar için. Mac launcher'ı gönderiyor ve tarayıcıda izlerken çalıyor. Onu çalamayan izleyiciler eski sesi almaya devam ediyor.",
    },
  },
  {
    id: "controllers",
    status: "done",
    areas: ["mac", "pc"],
    shipped: "AnyPS5-ARM 0.2.21 · AnyPS5 Desktop 0.1.7",
    en: {
      t: "Controllers",
      d: "DualSense, DualShock 4, Xbox, Switch Pro and more over USB or Bluetooth (the DualShock 3 over USB on the Mac), with a screen that tests them and a troubleshooter.",
    },
    tr: {
      t: "Kontrolcüler",
      d: "DualSense, DualShock 4, Xbox, Switch Pro ve daha fazlası USB ya da Bluetooth ile (Mac'te DualShock 3 de USB ile). Onları deneyen bir ekran ve bir sorun giderici de var.",
    },
  },
  {
    id: "steam",
    status: "done",
    areas: ["mac", "pc"],
    shipped: "AnyPS5-ARM 0.2.21 · AnyPS5 Desktop 0.1.7",
    en: {
      t: "Add to Steam",
      d: "AnyPS5 and each unlocked game in your Steam library with their own art, starting straight into the game. On the Steam Deck too.",
    },
    tr: {
      t: "Steam'e ekle",
      d: "AnyPS5 ve kilidi açılmış her oyun kendi görselleriyle Steam kütüphanende, doğrudan oyunu açarak. Steam Deck'te de.",
    },
  },
  {
    id: "prepare",
    status: "done",
    areas: ["mac", "pc"],
    shipped: "AnyPS5-ARM 0.2.21 · AnyPS5 Desktop 0.1.7",
    en: {
      t: "New games ready by themselves",
      d: "A game copied into the games folder shows up by itself and is prepared in the background, after a check that the drive has room.",
    },
    tr: {
      t: "Kendiliğinden hazır yeni oyunlar",
      d: "Oyunlar klasörüne kopyalanan oyun kendiliğinden görünür ve diskte yer olduğuna bakıldıktan sonra arka planda hazırlanır.",
    },
  },
  {
    id: "messages-more",
    status: "done",
    areas: ["mac", "pc", "phone", "online"],
    shipped: "AnyPS5-ARM 0.2.21 · AnyPS5 Remote 1.16",
    en: {
      t: "Richer messages",
      d: "Photos, clips and voice notes, replies, reactions, edits, unsend, read receipts and pinned chats.",
    },
    tr: {
      t: "Daha zengin mesajlar",
      d: "Fotoğraflar, klipler, sesli notlar, yanıtlar, tepkiler, düzenleme, geri alma, okundu bilgisi ve sabitlenmiş sohbetler.",
    },
  },
  {
    id: "glass",
    status: "done",
    areas: ["mac", "pc"],
    shipped: "AnyPS5-ARM 0.2.20 · AnyPS5 Desktop 0.1.6",
    en: {
      t: "Glass theme",
      d: "A see-through launcher window: the wallpaper glows through frosted panes (Liquid Glass on macOS 26, Acrylic on Windows).",
    },
    tr: {
      t: "Glass teması",
      d: "Saydam bir launcher penceresi: duvar kâğıdı buzlu camların ardından parlar (macOS 26'da Liquid Glass, Windows'ta Acrylic).",
    },
  },
  {
    id: "find-in-apps",
    status: "done",
    areas: ["mac", "phone"],
    shipped: "AnyPS5-ARM 0.2.16 · AnyPS5 Remote 1.12",
    en: {
      t: "Finding players in the apps",
      d: "The looking-for-group board, public parties and game hubs in the Mac launcher and on the phone, as well as on the web.",
    },
    tr: {
      t: "Uygulamalarda oyuncu bulma",
      d: "Grup arayan ilanları, herkese açık partiler ve oyun sayfaları web'in yanı sıra Mac launcher'ında ve telefonda da.",
    },
  },
  {
    id: "share-play",
    status: "done",
    areas: ["mac", "phone", "online"],
    shipped: "AnyPS5-ARM 0.2.15",
    en: {
      t: "Share play",
      d: "Stream the game you play to friends in a browser, on the phone or in their launcher, and hand them controller 2, 3 or 4. Player 1 stays yours.",
    },
    tr: {
      t: "Birlikte oynama",
      d: "Oynadığın oyunu arkadaşlarına tarayıcıda, telefonda ya da launcher'larında yayınla ve onlara 2., 3. ya da 4. kontrolcüyü ver. 1. oyuncu hep sende.",
    },
  },
  {
    id: "engine-picker",
    status: "done",
    areas: ["mac", "engine"],
    shipped: "AnyPS5-ARM 0.2.15",
    en: {
      t: "Engine picker",
      d: "Settings → Engine lists the engine builds from the releases, downloads and checks the one you pick, for every game or just one, or uses your own build.",
    },
    tr: {
      t: "Motor seçici",
      d: "Ayarlar → Motor, sürümlerdeki motor derlemelerini listeler. Seçtiğini indirip doğrular ve tüm oyunlar ya da tek bir oyun için kullanır. Kendi derlemen de olur.",
    },
  },
  {
    id: "crash-reports",
    status: "done",
    areas: ["mac"],
    shipped: "AnyPS5-ARM 0.2.15",
    en: {
      t: "Crash reports",
      d: "When a game stops, the launcher says why. Export Report saves the log and macOS's crash report in one file. Open Issue fills in a GitHub issue, personal details taken out.",
    },
    tr: {
      t: "Çökme raporları",
      d: "Oyun durduğunda launcher nedenini söyler. Raporu Dışa Aktar günlüğü ve macOS'un çökme raporunu tek dosyaya kaydeder. Sorun Aç kişisel bilgiler çıkarılmış bir GitHub sorunu doldurur.",
    },
  },
  {
    id: "upstream-merge",
    status: "done",
    areas: ["engine"],
    shipped: "AnyPS5-ARM 0.2.15",
    en: {
      t: "Fresh engine, upstream merged",
      d: "Upstream AnyPS5's latest work merged in: 1,465 commits of fixes and game support, tested on Cat Quest III, Silksong, Dreaming Sarah, Plants vs. Zombies: Replanted and DOOM.",
    },
    tr: {
      t: "Yeni motor, upstream birleştirildi",
      d: "Upstream AnyPS5'in son çalışmaları birleştirildi: düzeltme ve oyun desteğiyle 1.465 commit, Cat Quest III, Silksong, Dreaming Sarah, Plants vs. Zombies: Replanted ve DOOM'da denendi.",
    },
  },
  {
    id: "phone-1-11",
    status: "done",
    areas: ["phone"],
    shipped: "AnyPS5 Remote 1.11.0",
    en: {
      t: "The phone, online",
      d: "Edit your profile and picture, the activity feed, leaderboards, 1:1 calls, notifications, and watching or joining a friend's share play.",
    },
    tr: {
      t: "Telefon, çevrimiçi",
      d: "Profilini ve resmini düzenleme, etkinlik akışı, liderlik tabloları, birebir aramalar, bildirimler ve bir arkadaşın birlikte oynamasını izlemek ya da ona katılmak.",
    },
  },
  {
    id: "desktop-installers",
    status: "done",
    areas: ["pc"],
    shipped: "AnyPS5 Desktop 0.1.1",
    en: {
      t: "Installers for Windows and Linux",
      d: "A Windows setup that needs no admin, an AppImage and a .deb, with the AnyPS5 icon.",
    },
    tr: {
      t: "Windows ve Linux için kurulum",
      d: "Yönetici gerektirmeyen bir Windows kurulumu, bir AppImage ve bir .deb, AnyPS5 simgesiyle.",
    },
  },
  {
    id: "desktop-engine",
    status: "done",
    areas: ["pc", "engine"],
    shipped: "AnyPS5 Desktop 0.1.1",
    en: {
      t: "The engine downloads itself",
      d: "One press fetches AnyPS5's engine for your system, checks it against GitHub's checksums, resumes broken downloads and keeps versions side by side.",
    },
    tr: {
      t: "Motor kendini indiriyor",
      d: "Tek tuş, sisteminin AnyPS5 motorunu getirir, GitHub'ın sağlama toplamlarıyla doğrular, yarım kalan indirmeyi sürdürür ve sürümleri yan yana tutar.",
    },
  },
  {
    id: "find-players",
    status: "done",
    areas: ["online"],
    shipped: "AnyTogether",
    en: {
      t: "Find players",
      d: "A looking-for-group board, public parties and share plays to walk into, and a hub for every game with who plays it.",
    },
    tr: {
      t: "Oyuncu bul",
      d: "Grup arayan ilanları, katılabileceğin herkese açık partiler ve birlikte oynamalar, ve her oyun için kimlerin oynadığını gösteren bir sayfa.",
    },
  },
  {
    id: "notifications",
    status: "done",
    areas: ["online", "mac", "phone"],
    shipped: "AnyTogether",
    en: {
      t: "Notifications",
      d: "The bell everywhere for requests, invites, missed calls and messages, browser push, and a mail digest of what you missed.",
    },
    tr: {
      t: "Bildirimler",
      d: "İstekler, davetler, cevapsız aramalar ve mesajlar için her yerde zil, tarayıcı bildirimleri ve kaçırdıkların için bir e-posta özeti.",
    },
  },
  {
    id: "theme-hub",
    status: "done",
    areas: ["online", "mac"],
    shipped: "AnyTogether",
    en: {
      t: "Theme Hub",
      d: "Share a theme from the launcher's Theme Studio and anyone installs it with one press. Likes, versions and reports, on the web and in the launcher.",
    },
    tr: {
      t: "Tema Merkezi",
      d: "Launcher'ın Tema Stüdyosu'ndan bir tema paylaş, herkes onu tek tuşla kurar. Beğeniler, sürümler ve şikâyetler, web'de ve launcher'da.",
    },
  },
  {
    id: "compat",
    status: "done",
    areas: ["online", "mac"],
    shipped: "AnyTogether",
    en: {
      t: "Compatibility list",
      d: "One tap after a game says how it ran. Every report, with the launcher, engine and Mac, makes the community list.",
    },
    tr: {
      t: "Uyumluluk listesi",
      d: "Oyundan sonra tek dokunuş nasıl çalıştığını söyler. Launcher, motor ve Mac bilgisiyle her rapor topluluk listesine girer.",
    },
  },
  {
    id: "social",
    status: "done",
    areas: ["online", "mac", "pc", "phone"],
    shipped: "AnyTogether",
    en: {
      t: "Friends, messages, parties and voice",
      d: "Presence, chats and group chats, parties of up to eight with voice, 1:1 calls and joining a friend's game, the same on every screen.",
    },
    tr: {
      t: "Arkadaşlar, mesajlar, partiler ve ses",
      d: "Çevrimiçi durumu, sohbetler ve grup sohbetleri, sekiz kişiye kadar sesli partiler, birebir aramalar ve arkadaşının oyununa katılmak, her ekranda aynı.",
    },
  },
  {
    id: "profiles",
    status: "done",
    areas: ["online"],
    shipped: "AnyTogether",
    en: {
      t: "Profiles, trophies and leaderboards",
      d: "Play time and trophies from every launcher, rarity among all players, an activity feed with reactions, and boards among friends or everyone.",
    },
    tr: {
      t: "Profiller, kupalar ve liderlik tabloları",
      d: "Her launcher'dan oyun süresi ve kupalar, tüm oyuncular arasında nadirlik, tepkili etkinlik akışı ve arkadaşlar ya da herkes arasında tablolar.",
    },
  },
  {
    id: "framegen",
    status: "done",
    areas: ["mac"],
    shipped: "AnyPS5-ARM",
    en: {
      t: "Frame generation",
      d: "A frame made between each two of the game's, so 60 fps shows 120 on a 120 Hz display. It turns itself off where it would cost frames.",
    },
    tr: {
      t: "Kare üretimi",
      d: "Oyunun her iki karesi arasına bir kare, böylece 60 fps 120 Hz ekranda 120 olarak görünür. Kare kaybettireceği yerde kendini kapatır.",
    },
  },
  {
    id: "self-hosting",
    status: "done",
    areas: ["online"],
    shipped: "AnyTogether",
    en: {
      t: "Run your own server",
      d: "The whole server on one machine with Docker Compose and a guide. Every launcher and the phone can point at it.",
    },
    tr: {
      t: "Kendi sunucunu çalıştır",
      d: "Tüm sunucu tek makinede, Docker Compose ve bir rehberle. Her launcher ve telefon ona bağlanabilir.",
    },
  },

  // In progress
  {
    id: "online-play",
    status: "progress",
    areas: ["engine", "mac", "pc", "online"],
    en: {
      t: "Online play through the engine bridge",
      d: "Each player runs their own copy and the games play together through AnyTogether, never through Sony. Experimental in the launchers since AnyPS5-ARM 0.2.19: Human Fall Flat lists and joins public lobbies, and no game plays a whole session yet.",
    },
    tr: {
      t: "Motor köprüsüyle çevrimiçi oyun",
      d: "Her oyuncu kendi kopyasını çalıştırır ve oyunlar AnyTogether üzerinden birlikte oynar, hiçbir zaman Sony üzerinden geçmez. AnyPS5-ARM 0.2.19'dan beri launcher'larda deneysel: Human Fall Flat herkese açık lobileri listeleyip katılabiliyor ve henüz hiçbir oyun baştan sona bir oturum oynamıyor.",
    },
  },
  {
    id: "play-together",
    status: "progress",
    areas: ["mac", "pc", "online"],
    en: {
      t: "Play together",
      d: "Start a game from the party and everyone in it joins its LAN mode over the internet, after a check that they have the same game and version. The server and the party pages are live, and the launchers' side is coming.",
    },
    tr: {
      t: "Birlikte oyna",
      d: "Partiden bir oyun başlattığında partideki herkes, aynı oyun ve sürüm kendisinde var mı diye bakıldıktan sonra oyunun LAN moduna internet üzerinden katılır. Sunucu ve parti sayfaları hazır. Launcher tarafı geliyor.",
    },
  },
  {
    id: "native-arm64",
    status: "progress",
    areas: ["engine", "mac"],
    en: {
      t: "Native arm64 engine",
      d: "Games translated to arm64 once, when they are unlocked, so they run without Rosetta. DOOM plays E1M1 natively on the native-arm64 branch.",
    },
    tr: {
      t: "Yerel arm64 motoru",
      d: "Oyunlar kilit açılırken bir kez arm64'e çevrilir, Rosetta olmadan çalışır. native-arm64 dalında DOOM, E1M1'i yerel olarak oynuyor.",
    },
  },
  // Next
  {
    id: "notarized",
    status: "next",
    areas: ["mac"],
    en: {
      t: "Signed and notarized Mac builds",
      d: "Release builds signed with Developer ID and notarized, so the zip opens without the Privacy & Security step.",
    },
    tr: {
      t: "İmzalı ve onaylı Mac sürümleri",
      d: "Developer ID ile imzalanmış ve Apple onaylı sürümler, böylece zip Gizlilik ve Güvenlik adımı olmadan açılır.",
    },
  },
  {
    id: "phone-push",
    status: "next",
    areas: ["phone", "online"],
    en: {
      t: "Push notifications on the phone",
      d: "Messages, invites and calls on a locked phone, through APNs and FCM.",
    },
    tr: {
      t: "Telefonda anlık bildirimler",
      d: "Kilitli telefonda mesajlar, davetler ve aramalar, APNs ve FCM üzerinden.",
    },
  },
  {
    id: "windows-pad",
    status: "done",
    areas: ["pc", "phone", "engine"],
    shipped: "AnyPS5-ARM 0.2.22 · AnyPS5 Desktop 0.1.8",
    en: {
      t: "The phone controller in Windows games",
      d: "AnyPS5 Remote plays Windows games with AnyPS5 Desktop, through the engine's Winsock bridge (AnyPS5-ARM 0.2.22, Desktop 0.1.8).",
    },
    tr: {
      t: "Windows oyunlarında telefon kontrolcüsü",
      d: "AnyPS5 Remote, motorun Winsock köprüsüyle AnyPS5 Desktop'ta Windows oyunlarını oynatıyor (AnyPS5-ARM 0.2.22, Desktop 0.1.8).",
    },
  },
  {
    id: "desktop-together",
    status: "next",
    areas: ["pc", "online"],
    en: {
      t: "Share play and the feed in AnyPS5 Desktop",
      d: "Hosting and watching share play, the activity feed and leaderboards on Windows and Linux, as on the Mac.",
    },
    tr: {
      t: "AnyPS5 Desktop'ta birlikte oynama ve akış",
      d: "Windows ve Linux'ta birlikte oynamayı yayınlamak ve izlemek, etkinlik akışı ve liderlik tabloları, Mac'teki gibi.",
    },
  },
  {
    id: "languages",
    status: "next",
    areas: ["mac", "pc", "phone", "online"],
    en: {
      t: "More languages",
      d: "More languages for the launchers, the phone and this website, which are in English and Turkish today.",
    },
    tr: {
      t: "Daha çok dil",
      d: "Bugün İngilizce ve Türkçe olan launcher'lar, telefon ve bu site için daha çok dil.",
    },
  },

  // Later
  {
    id: "party-chat",
    status: "later",
    areas: ["online"],
    en: {
      t: "Party chat",
      d: "A text chat beside a party's voice, in the launchers, on the phone and on the web.",
    },
    tr: {
      t: "Parti sohbeti",
      d: "Bir partinin sesinin yanında yazılı sohbet, launcher'larda, telefonda ve web'de.",
    },
  },
  {
    id: "profile-themes",
    status: "later",
    areas: ["online"],
    en: {
      t: "Profile themes and showcase",
      d: "Your profile wearing a theme you choose, and up to six games or trophies pinned to its top.",
    },
    tr: {
      t: "Profil temaları ve vitrin",
      d: "Profilin seçtiğin bir temayı giyer ve en üstüne en fazla altı oyun ya da kupa sabitlenir.",
    },
  },
  {
    id: "headset",
    status: "later",
    areas: ["phone"],
    en: {
      t: "The phone as a headset",
      d: "The party's voice through the phone while it is also the controller.",
    },
    tr: {
      t: "Kulaklık olarak telefon",
      d: "Telefon kontrolcüyken partinin sesi de onun üzerinden.",
    },
  },
  {
    id: "e2ee",
    status: "later",
    areas: ["online"],
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
    status: "later",
    areas: ["phone"],
    en: {
      t: "The phone app in the stores",
      d: "AnyPS5 Remote on the App Store and Google Play, no sideloading.",
    },
    tr: {
      t: "Mağazalarda telefon uygulaması",
      d: "AnyPS5 Remote, App Store ve Google Play'de, yan yükleme olmadan.",
    },
  },
  {
    id: "big-rooms",
    status: "later",
    areas: ["online"],
    en: {
      t: "Share play for many viewers",
      d: "More than four viewers through a media server, and parties with more than eight talking.",
    },
    tr: {
      t: "Çok izleyicili birlikte oynama",
      d: "Bir medya sunucusuyla dörtten fazla izleyici ve sekizden fazla konuşanlı partiler.",
    },
  },
  {
    id: "public-api",
    status: "later",
    areas: ["online"],
    en: {
      t: "Challenges and a public API",
      d: "Tournaments and challenges on the leaderboards, and an API for community tools.",
    },
    tr: {
      t: "Meydan okumalar ve açık API",
      d: "Liderlik tablolarında turnuvalar ve meydan okumalar, topluluk araçları için bir API.",
    },
  },
];

/** The items of one status, in the order written. */
export const itemsOf = (status: Status, items: RoadmapItem[] = roadmap) =>
  items.filter((item) => item.status === status);
