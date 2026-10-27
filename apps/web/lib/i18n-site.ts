import type { Language } from "./i18n";

/** The public pages' texts: the header and footer for visitors, and the front page. English and
 *  Turkish; the product pages are in i18n-products.ts. */

const en = {
  nav: {
    label: "AnyPS5",
    mac: "Mac",
    pc: "Windows & Linux",
    pcShort: "PC",
    phone: "Phone",
    together: "Online",
    download: "Download",
    help: "Help",
    signIn: "Sign in",
    createAccount: "Create account",
  },
  footer: {
    tagline:
      "Play the PS5 games you own on your Mac, your PC and with your friends. Open source, made by players.",
    product: "Product",
    community: "Community",
    account: "Account",
    download: "Download",
    themes: "Theme Hub",
    compatibility: "Compatibility",
    findPlayers: "Find players",
    leaderboards: "Leaderboards",
    selfHosting: "Run your own server",
    project: "Project",
    changelog: "Changelog",
    roadmap: "Roadmap",
    specs: "Full specs",
    openSource: "Open source",
    help: "Help",
    guide: "User guide",
    signIn: "Sign in",
    createAccount: "Create account",
    settings: "Settings",
    privacy: "Privacy",
    terms: "Terms",
    rules:
      "AnyPS5 and AnyTogether have nothing to do with Sony Interactive Entertainment. PlayStation, PS5 and DualSense are Sony's trademarks. Game pictures belong to their owners.",
  },
  platform: {
    mac: "Mac",
    windows: "Windows",
    linux: "Linux",
    iphone: "iPhone",
    android: "Android",
  },
  downloadFor: "Download for {platform}",
  downloadAny: "Download",
  phoneFor: "AnyPS5 Remote for {platform}",
  versionShort: "v{version}",
  allPlatforms: "All platforms",
  portableZip: "Portable .zip",
  copy: "Copy",
  copied: "Copied",
  preview: "Early preview",
  experimental: "Experimental",
  soon: "Coming soon",
  demoPeople: "People in the pictures are made up.",
  landing: {
    title: "AnyPS5 and AnyTogether: your PS5 games on Mac, PC and with friends",
    description:
      "Play the PS5 games you own on Apple silicon Macs, Windows and Linux. Your phone is the DualSense, and AnyTogether brings your friends in: share play, parties, voice, trophies.",
    eyebrow: "AnyPS5 · AnyTogether",
    released: "AnyPS5 {version} is out",
    whatsNew: "What's new",
    heroA: "Your PS5 games.",
    heroB: "On your Mac, your PC,",
    heroC: "and with friends.",
    lead: "AnyPS5 runs the games you own on Apple silicon Macs, Windows and Linux. Your phone becomes the DualSense. AnyTogether brings everyone in: share play, parties, voice and trophies.",
    heroNote: {
      mac: "Apple silicon · macOS 14 or later",
      windows: "Windows 10/11 · early preview",
      linux: "x64, glibc 2.34+ · early preview",
      iphone: "The phone controller · iOS 15 or later",
      android: "The phone controller · Android",
      none: "Mac, Windows, Linux, iPhone and Android",
    },
    alsoOn: "Also for",
    heroAlt:
      "The AnyPS5 launcher on a Mac: Hollow Knight: Silksong selected on a PS5-style home screen, with 8 of 34 trophies",
    heroPhoneAlt: "AnyPS5 Remote on a phone: the same games in launcher mode",
    family: "The family",
    products: [
      {
        key: "mac",
        name: "AnyPS5-ARM",
        where: "Mac · Apple silicon",
        line: "The launcher: a PS5-style home that unlocks and plays your games.",
      },
      {
        key: "pc",
        name: "AnyPS5 Desktop",
        where: "Windows · Linux",
        line: "The same launcher for PCs, AnyTogether built in.",
      },
      {
        key: "phone",
        name: "AnyPS5 Remote",
        where: "iPhone · Android",
        line: "Your phone as a DualSense, with Remote Play.",
      },
      {
        key: "together",
        name: "AnyTogether",
        where: "Online · any browser",
        line: "Friends, parties, voice, share play and trophies.",
      },
    ],
    statsLabel: "On AnyTogether now",
    stats: {
      players: "players",
      hoursThisWeek: "hours played this week",
      trophies: "trophies earned",
      themes: "themes shared",
    },
    film: {
      title: "88 seconds of AnyPS5.",
      lead: "The launcher, the phone as a pad, parties, share play and the Hub, filmed as they are.",
      label: "AnyPS5 film: the launcher on a Mac, the phone pad, friends, parties and share play",
      play: "Play",
      pause: "Pause",
      soundOn: "Sound on",
      soundOff: "Sound off",
      watch: "Play the film",
      credit: "Music: “Calm Ambient 1 (Synthwave 4k)” by The Cynic Project (CC0)",
    },
    share: {
      kicker: "Share play",
      title: "Local co‑op, from anywhere.",
      lead: "Stream the game you are playing to your friends. They watch in a browser, on their phone or in their own launcher, and when you hand them a controller they become player 2, 3 or 4 in a game made for one couch.",
      points: [
        [
          "Hand over a pad",
          "Give a viewer controller 2, 3 or 4. Their gamepad, keyboard or phone drives that player; nobody but you is ever player 1.",
        ],
        [
          "Direct, or through a relay",
          "The stream goes straight between you when the networks allow it, and through a relay when they don't. Latency and quality are shown for every viewer.",
        ],
        ["You decide", "Choose who may walk in and how many may watch, and take anyone out at any time."],
      ],
      seats: "Players",
      host: "You · host",
      p2: "Direct · 38 ms · 720p60",
      p3: "Watching · relay · 71 ms",
      p4: "Free seat",
      worldAlt:
        "Cat Quest III streamed to a friend's browser: both cats in the world, the friend playing as player 2",
      hostAlt: "The host's Mac launcher sharing Cat Quest III, the friend playing as player 2, direct",
      coopAlt: "Cat Quest III's local co-op screen in the friend's browser: P2 press any button to join",
      proof:
        "Real frames, not a mock-up: Cat Quest III shared from a Mac and played as player 2 from a browser.",
      proofMore: "See the whole test",
    },
    phone: {
      kicker: "AnyPS5 Remote",
      title: "Your phone is the DualSense.",
      lead: "Both sticks, the touchpad, motion, rumble and the light bar, on the phone you already carry. Four phones are four players, and Remote Play puts the game on the phone's screen, sound included.",
      chips: [
        "Sticks and touchpad",
        "Gyro and accelerometer",
        "Rumble and trigger pulses",
        "Light bar colour",
        "Remote Play",
        "Up to 4 phones",
        "Wi-Fi or a cable",
        "Your layout per game",
      ],
      more: "Everything the phone does",
      padAlt: "The phone pad: both sticks, the D-pad, the face buttons, L1, L2, R1, R2 and the touchpad",
      liveAlt: "Silksong played with the phone, the pad shown in the corner",
    },
    launcher: {
      kicker: "The launcher",
      title: "Plays the way you do.",
      lead: "New in the Mac launcher and in AnyPS5 Desktop for Windows and Linux.",
      cards: [
        {
          title: "Any controller",
          detail:
            "DualSense, DualShock 4, Xbox, Switch Pro and more, over USB or Bluetooth, and the DualShock 3 over USB on the Mac. Settings → Controllers tests the buttons, sticks, vibration and light bar, and a troubleshooter says what is wrong.",
        },
        {
          title: "Play from Steam",
          detail:
            "Add to Steam puts AnyPS5 in your Steam library, and every unlocked game with its own art, starting straight into it. On the Steam Deck too.",
        },
        {
          title: "Glass",
          detail:
            "A see-through theme: your wallpaper glows through frosted panes. Liquid Glass on macOS 26, Acrylic on Windows, blurred on KDE Plasma.",
        },
        {
          title: "Ready when you are",
          detail:
            "Copy a game into the games folder: it shows up by itself and is prepared in the background, once the drive is checked for room.",
        },
        {
          title: "Online play",
          detail:
            "Each player runs their own copy and the games reach each other through AnyTogether, never Sony. Human Fall Flat already lists and joins public lobbies; no game plays a whole session yet.",
          tag: "experimental",
        },
        {
          title: "Play Together",
          detail:
            "Start a game from your party and everyone in it joins its LAN mode over the internet, once AnyPS5 has checked they have the same game and version.",
          tag: "soon",
        },
      ] as { title: string; detail: string; tag?: "experimental" | "soon" }[],
    },
    social: {
      kicker: "Friends",
      title: "Everyone you play with, one button away.",
      lead: "Friends, messages, parties and voice live in the launcher, on the phone and on this website, and stay the same on all of them.",
      cards: [
        [
          "Friends and presence",
          "See who is online and what they play. When their game is joinable, start the same one and join them.",
        ],
        [
          "Messages",
          "Replies, reactions, edits and read receipts, photos, clips and voice notes, and the chats that matter pinned on top. On every screen.",
        ],
        [
          "Parties and voice",
          "Up to eight together. Voice goes from player to player, through a relay only when it must. Push-to-talk on ⌥V works over the game.",
        ],
        ["1:1 calls", "Ring a friend. The call shows over the game; ⌥A answers, ⌥D declines."],
      ],
      partyAlt: "A party with voice in the Mac launcher, one friend speaking",
      messagesAlt: "Messages on the phone: conversations and one open, a friend typing",
    },
    find: {
      kicker: "Find players",
      title: "Nobody to play with? Not for long.",
      cards: [
        [
          "Looking for group",
          "Post what you want to play, when, and in which language: co-op, online, a party or trophy help. People tap “I'm in” and you choose who joins.",
        ],
        ["Public parties", "Open your party to anyone, or walk into one that is talking about your game."],
        ["Game hubs", "Every game has a page: who plays it, open parties and share plays to watch."],
      ],
      cta: "Find players",
    },
    progress: {
      kicker: "Trophies",
      title: "Every trophy counts. The rare ones more.",
      lead: "Play time and trophies go to your profile from every launcher, each trophy with how rare it is among all players.",
      cards: [
        ["Profiles", "Your games, hours, trophies and points, and who gets to see each of them."],
        ["Rarity", "Common to ultra rare, worked out from everyone who plays the game."],
        ["Activity", "Friends' trophies, first plays and milestones, with reactions."],
        ["Leaderboards", "Points, play time and completion, among friends or everyone, per game or overall."],
      ],
      profileAlt:
        "A friend's profile in the launcher: games, play time, recent trophies with rarity, activity",
      boardAlt: "A game's leaderboard in the launcher, your rank highlighted",
      feedAlt: "Friends' activity on the phone, with reactions",
    },
    themes: {
      kicker: "Theme Studio",
      title: "Make it yours. Share it.",
      lead: "Design a theme in the launcher's Theme Studio: the motion, its colours, a picture or a video behind it, menu music. Share it on the Theme Hub, where anyone installs it with one press. The phone wears it too.",
      cta: "Browse the Theme Hub",
      alt: "The Theme Hub in the launcher: themes people share, one being picked",
    },
    framegen: {
      kicker: "Frame generation",
      title: "60 in, 120 out.",
      lead: "On the Mac, a frame is made between each two of the game's, from the motion between them, so a 60 fps game shows 120 on a 120 Hz display. It turns itself off wherever it would cost the game frames.",
      from: "game",
      to: "display",
      legendGame: "the game's frames",
      legendMade: "made in between",
    },
    platforms: {
      kicker: "Download",
      title: "Every screen you own.",
      lead: "Free and open source. One AnyTogether account works on all of them.",
      cards: {
        mac: {
          product: "AnyPS5-ARM",
          req: "Apple silicon (M1 or later), macOS 14 or later. Rosetta 2 is installed if missing.",
        },
        windows: {
          product: "AnyPS5 Desktop",
          req: "Windows 10 or 11, x64. Installs for your user, no admin needed.",
        },
        linux: {
          product: "AnyPS5 Desktop",
          req: "x64, glibc 2.34 or newer (Ubuntu 22.04+). Games need glibc 2.38+.",
        },
        iphone: {
          product: "AnyPS5 Remote",
          req: "iOS 15 or later. Install with AltStore, SideStore or Sideloadly.",
        },
        android: { product: "AnyPS5 Remote", req: "Open the APK and allow installing from your browser." },
      },
      web: "Any browser",
      webProduct: "AnyTogether",
      webReq: "Profiles, friends, messages, parties, voice, and watching share plays.",
      orTerminal: "Or in Terminal",
      details: "Install steps",
    },
    open: {
      kicker: "Open source",
      title: "Yours to run.",
      lead: "Every line is on GitHub. AnyTogether is MIT licensed and the whole server runs on one machine with Docker Compose; the launchers and the phone connect to it from Settings → AnyTogether → Server.",
      repos: [
        ["AnyTogether", "AnyTogether/AnyTogether", "MIT", "The server and this website"],
        [
          "AnyPS5-ARM",
          "AnyTogether/AnyPS5-ARM",
          "GPL-2.0",
          "The Mac launcher, the engine port and the phone app",
        ],
        ["AnyPS5-Desktop", "AnyTogether/AnyPS5-Desktop", "GPL-2.0", "The Windows and Linux launcher"],
      ],
      guide: "Self-hosting guide",
      built: "Built on {link}, the open source PS5 compatibility layer.",
    },
    rules: {
      kicker: "Ground rules",
      title: "Bring the games you own.",
      points: [
        [
          "We never touch Sony's servers, code or keys.",
          "AnyPS5 is not an emulator: it relinks a game's own program to run natively, against system libraries written from scratch.",
        ],
        [
          "Only your own copies.",
          "You play decrypted dumps of games you own. No game files, firmware or keys are offered anywhere here, only AnyPS5's own software.",
        ],
        [
          "Nothing sold, nothing tracked.",
          "Free and open source. Your data is yours to export or delete from Settings.",
        ],
      ],
    },
    final: {
      title: "Pick up a controller.",
      lead: "Download AnyPS5, sign in once, and your friends are one press away.",
    },
  },
};

export type SiteStrings = typeof en;

const tr: SiteStrings = {
  nav: {
    label: "AnyPS5",
    mac: "Mac",
    pc: "Windows ve Linux",
    pcShort: "PC",
    phone: "Telefon",
    together: "Online",
    download: "İndir",
    help: "Yardım",
    signIn: "Giriş yap",
    createAccount: "Hesap oluştur",
  },
  footer: {
    tagline:
      "Sahip olduğun PS5 oyunlarını Mac'inde, PC'nde ve arkadaşlarınla oyna. Açık kaynak, oyuncuların elinden.",
    product: "Ürün",
    community: "Topluluk",
    account: "Hesap",
    download: "İndir",
    themes: "Tema Merkezi",
    compatibility: "Uyumluluk",
    findPlayers: "Oyuncu bul",
    leaderboards: "Liderlik tabloları",
    selfHosting: "Kendi sunucunu kur",
    project: "Proje",
    changelog: "Sürüm notları",
    roadmap: "Yol haritası",
    specs: "Tüm özellikler",
    openSource: "Açık kaynak",
    help: "Yardım",
    guide: "Kullanım rehberi",
    signIn: "Giriş yap",
    createAccount: "Hesap oluştur",
    settings: "Ayarlar",
    privacy: "Gizlilik",
    terms: "Koşullar",
    rules:
      "AnyPS5 ve AnyTogether'ın Sony Interactive Entertainment ile bir ilgisi yoktur. PlayStation, PS5 ve DualSense Sony'nin markalarıdır. Oyun görselleri sahiplerine aittir.",
  },
  platform: {
    mac: "Mac",
    windows: "Windows",
    linux: "Linux",
    iphone: "iPhone",
    android: "Android",
  },
  downloadFor: "{platform} için indir",
  downloadAny: "İndir",
  phoneFor: "{platform} için AnyPS5 Remote",
  versionShort: "v{version}",
  allPlatforms: "Tüm platformlar",
  portableZip: "Taşınabilir .zip",
  copy: "Kopyala",
  copied: "Kopyalandı",
  preview: "Erken sürüm",
  experimental: "Deneysel",
  soon: "Yakında",
  demoPeople: "Görsellerdeki kişiler hayalidir.",
  landing: {
    title: "AnyPS5 ve AnyTogether: PS5 oyunların Mac'te, PC'de ve arkadaşlarınla",
    description:
      "Sahip olduğun PS5 oyunlarını Apple silicon Mac'lerde, Windows ve Linux'ta oyna. Telefonun DualSense olur, AnyTogether arkadaşlarını getirir: share play, parti, sesli sohbet, kupalar.",
    eyebrow: "AnyPS5 · AnyTogether",
    released: "AnyPS5 {version} çıktı",
    whatsNew: "Yenilikler",
    heroA: "PS5 oyunların.",
    heroB: "Mac'inde, PC'nde",
    heroC: "ve arkadaşlarınla.",
    lead: "AnyPS5, sahip olduğun oyunları Apple silicon Mac'lerde, Windows ve Linux'ta çalıştırır. Telefonun DualSense olur. AnyTogether herkesi bir araya getirir: share play, parti, sesli sohbet ve kupalar.",
    heroNote: {
      mac: "Apple silicon · macOS 14 ve sonrası",
      windows: "Windows 10/11 · erken sürüm",
      linux: "x64, glibc 2.34+ · erken sürüm",
      iphone: "Telefon kumandası · iOS 15 ve sonrası",
      android: "Telefon kumandası · Android",
      none: "Mac, Windows, Linux, iPhone ve Android",
    },
    alsoOn: "Ayrıca",
    heroAlt:
      "Mac'te AnyPS5 launcher'ı: PS5 tarzı ana ekranda Hollow Knight: Silksong seçili, 34 kupanın 8'i alınmış",
    heroPhoneAlt: "Telefonda AnyPS5 Remote: aynı oyunlar launcher modunda",
    family: "Aile",
    products: [
      {
        key: "mac",
        name: "AnyPS5-ARM",
        where: "Mac · Apple silicon",
        line: "Launcher: oyunlarını açan ve oynatan PS5 tarzı bir ana ekran.",
      },
      {
        key: "pc",
        name: "AnyPS5 Desktop",
        where: "Windows · Linux",
        line: "PC'ler için aynı launcher, AnyTogether içinde.",
      },
      {
        key: "phone",
        name: "AnyPS5 Remote",
        where: "iPhone · Android",
        line: "Telefonun DualSense olur, Remote Play ile.",
      },
      {
        key: "together",
        name: "AnyTogether",
        where: "Online · her tarayıcı",
        line: "Arkadaşlar, parti, ses, share play ve kupalar.",
      },
    ],
    statsLabel: "Şu an AnyTogether'da",
    stats: {
      players: "oyuncu",
      hoursThisWeek: "saat bu hafta oynandı",
      trophies: "kupa kazanıldı",
      themes: "tema paylaşıldı",
    },
    film: {
      title: "88 saniyede AnyPS5.",
      lead: "Launcher, kol olan telefon, partiler, share play ve Hub; oldukları gibi çekildi.",
      label: "AnyPS5 filmi: Mac'te launcher, telefon kolu, arkadaşlar, partiler ve share play",
      play: "Oynat",
      pause: "Duraklat",
      soundOn: "Sesi aç",
      soundOff: "Sesi kapat",
      watch: "Filmi oynat",
      credit: "Müzik: The Cynic Project, “Calm Ambient 1 (Synthwave 4k)” (CC0)",
    },
    share: {
      kicker: "Share play",
      title: "Uzaktan, aynı koltukta.",
      lead: "Oynadığın oyunu arkadaşlarına yayınla. Tarayıcıda, telefonlarında ya da kendi launcher'larında izlerler; onlara bir kol verdiğinde, tek koltuk için yapılmış bir oyunda 2., 3. ya da 4. oyuncu olurlar.",
      points: [
        [
          "Kolu uzat",
          "İzleyene 2, 3 ya da 4 numaralı kolu ver. O oyuncuyu kendi kolu, klavyesi ya da telefonu oynatır; 1. oyuncu her zaman sensin.",
        ],
        [
          "Doğrudan ya da relay ile",
          "Ağlar izin verdiğinde görüntü doğrudan aranızda akar, vermediğinde bir relay üzerinden. Her izleyicinin gecikmesi ve kalitesi görünür.",
        ],
        [
          "Karar senin",
          "Kimin girebileceğini ve kaç kişinin izleyebileceğini seç, istediğin an birini çıkar.",
        ],
      ],
      seats: "Oyuncular",
      host: "Sen · yayıncı",
      p2: "Doğrudan · 38 ms · 720p60",
      p3: "İzliyor · relay · 71 ms",
      p4: "Boş koltuk",
      worldAlt: "Bir arkadaşın tarayıcısına yayınlanan Cat Quest III: iki kedi de dünyada, arkadaş 2. oyuncu",
      hostAlt: "Cat Quest III'ü paylaşan yayıncının Mac launcher'ı, arkadaş doğrudan bağlı, 2. oyuncu",
      coopAlt: "Arkadaşın tarayıcısında Cat Quest III'ün yerel co-op ekranı: P2 katılmak için bir tuşa bas",
      proof:
        "Maket değil, gerçek kareler: Cat Quest III bir Mac'ten paylaşıldı, tarayıcıdan 2. oyuncu olarak oynandı.",
      proofMore: "Testin tamamı",
    },
    phone: {
      kicker: "AnyPS5 Remote",
      title: "Telefonun DualSense olur.",
      lead: "İki analog, touchpad, hareket sensörü, titreşim ve ışık çubuğu; zaten cebindeki telefonda. Dört telefon dört oyuncu demek, Remote Play de oyunu sesiyle birlikte telefonun ekranına getirir.",
      chips: [
        "Analoglar ve touchpad",
        "Jiroskop ve ivmeölçer",
        "Titreşim ve tetik darbeleri",
        "Işık çubuğu rengi",
        "Remote Play",
        "4 telefona kadar",
        "Wi-Fi ya da kablo",
        "Oyuna özel düzen",
      ],
      more: "Telefonun yaptığı her şey",
      padAlt: "Telefon kumandası: iki analog, yön tuşları, ana tuşlar, L1, L2, R1, R2 ve touchpad",
      liveAlt: "Silksong telefonla oynanıyor, kumanda köşede",
    },
    launcher: {
      kicker: "Launcher",
      title: "Senin gibi oynar.",
      lead: "Mac launcher'ında ve Windows ile Linux için AnyPS5 Desktop'ta yeni olanlar.",
      cards: [
        {
          title: "Her kumanda",
          detail:
            "DualSense, DualShock 4, Xbox, Switch Pro ve daha fazlası, USB ya da Bluetooth ile; Mac'te DualShock 3 de USB ile. Ayarlar → Kumandalar düğmeleri, çubukları, titreşimi ve ışık çubuğunu dener; sorun giderici neyin yanlış olduğunu söyler.",
        },
        {
          title: "Steam'den oyna",
          detail:
            "Steam'e Ekle, AnyPS5'i Steam kütüphanene koyar; kilidi açılmış her oyunu da kendi görselleriyle, doğrudan oyunu açan bir girdi olarak. Steam Deck'te de.",
        },
        {
          title: "Glass",
          detail:
            "Saydam bir tema: duvar kâğıdın buzlu camların ardından parlar. macOS 26'da Liquid Glass, Windows'ta Acrylic, KDE Plasma'da bulanık.",
        },
        {
          title: "Hazır bekler",
          detail:
            "Oyunlar klasörüne bir oyun kopyala: kendiliğinden görünür ve diskte yer olduğuna bakıldıktan sonra arka planda hazırlanır.",
        },
        {
          title: "Çevrim içi oyun",
          detail:
            "Her oyuncu kendi kopyasını çalıştırır; oyunlar birbirine Sony üzerinden değil, AnyTogether üzerinden ulaşır. Human Fall Flat herkese açık lobileri listeleyip katılabiliyor; henüz hiçbir oyun baştan sona bir oturum oynamıyor.",
          tag: "experimental",
        },
        {
          title: "Birlikte Oyna",
          detail:
            "Partinden bir oyun başlat; partideki herkes, aynı oyun ve sürüm kendisinde var mı diye bakıldıktan sonra oyunun LAN moduna internet üzerinden katılır.",
          tag: "soon",
        },
      ],
    },
    social: {
      kicker: "Arkadaşlar",
      title: "Birlikte oynadığın herkes, bir tuş uzağında.",
      lead: "Arkadaşlar, mesajlar, partiler ve sesli sohbet launcher'da, telefonda ve bu sitede; hepsinde aynı.",
      cards: [
        [
          "Arkadaşlar ve durum",
          "Kim çevrimiçi, ne oynuyor gör. Oyunu katılınabilir olduğunda aynı oyunu aç ve yanına git.",
        ],
        [
          "Mesajlar",
          "Yanıtlar, tepkiler, düzenlemeler ve okundu bilgisi; fotoğraflar, klipler ve sesli notlar; önemli sohbetler en üstte sabit. Her ekranda.",
        ],
        [
          "Parti ve ses",
          "Sekiz kişiye kadar. Ses oyuncudan oyuncuya gider, yalnızca gerektiğinde relay üzerinden. ⌥V ile bas-konuş oyunun üstünde de çalışır.",
        ],
        ["Birebir arama", "Bir arkadaşını ara. Arama oyunun üstünde görünür; ⌥A açar, ⌥D reddeder."],
      ],
      partyAlt: "Mac launcher'ında sesli parti, bir arkadaş konuşuyor",
      messagesAlt: "Telefonda mesajlar: sohbetler ve açık bir konuşma, bir arkadaş yazıyor",
    },
    find: {
      kicker: "Oyuncu bul",
      title: "Oynayacak kimse yok mu? Çok sürmez.",
      cards: [
        [
          "Grup arayanlar",
          "Ne oynamak istediğini, ne zaman ve hangi dilde olduğunu yaz: co-op, online, parti ya da kupa yardımı. İsteyenler “Ben varım” der, kimin katılacağını sen seçersin.",
        ],
        ["Herkese açık partiler", "Partini herkese aç ya da oyunun hakkında konuşulan bir partiye katıl."],
        [
          "Oyun sayfaları",
          "Her oyunun bir sayfası var: kimler oynuyor, açık partiler ve izlenecek share play'ler.",
        ],
      ],
      cta: "Oyuncu bul",
    },
    progress: {
      kicker: "Kupalar",
      title: "Her kupa sayılır. Nadirleri daha çok.",
      lead: "Oynama süresi ve kupalar her launcher'dan profiline gelir; her kupa, tüm oyuncular arasında ne kadar nadir olduğuyla.",
      cards: [
        [
          "Profiller",
          "Oyunların, saatlerin, kupaların ve puanların; hangisini kimin göreceği de senin elinde.",
        ],
        ["Nadirlik", "Yaygından ultra nadire; oyunu oynayan herkesten hesaplanır."],
        ["Aktivite", "Arkadaşlarının kupaları, ilk oynayışları ve dönüm noktaları, tepkilerle."],
        [
          "Liderlik tabloları",
          "Puan, oynama süresi ve tamamlama; arkadaşlar ya da herkes arasında, oyun oyun ya da genel.",
        ],
      ],
      profileAlt:
        "Launcher'da bir arkadaşın profili: oyunlar, oynama süresi, nadirliğiyle son kupalar, aktivite",
      boardAlt: "Launcher'da bir oyunun liderlik tablosu, senin sıran vurgulu",
      feedAlt: "Telefonda arkadaşların aktivitesi, tepkilerle",
    },
    themes: {
      kicker: "Tema Stüdyosu",
      title: "Kendine göre yap. Paylaş.",
      lead: "Launcher'ın Tema Stüdyosu'nda bir tema tasarla: hareket, renkleri, arkada bir resim ya da video, menü müziği. Tema Merkezi'nde paylaş, herkes tek tuşla kursun. Telefon da aynı temayı giyer.",
      cta: "Tema Merkezi'ne göz at",
      alt: "Launcher'da Tema Merkezi: insanların paylaştığı temalar, biri seçiliyor",
    },
    framegen: {
      kicker: "Kare üretimi",
      title: "60 girer, 120 çıkar.",
      lead: "Mac'te oyunun her iki karesi arasına, aralarındaki hareketten bir kare üretilir; 60 fps bir oyun 120 Hz ekranda 120 gösterir. Oyuna kare kaybettireceği yerde kendini kapatır.",
      from: "oyun",
      to: "ekran",
      legendGame: "oyunun kareleri",
      legendMade: "araya üretilenler",
    },
    platforms: {
      kicker: "İndir",
      title: "Sahip olduğun her ekran.",
      lead: "Ücretsiz ve açık kaynak. Tek AnyTogether hesabı hepsinde çalışır.",
      cards: {
        mac: {
          product: "AnyPS5-ARM",
          req: "Apple silicon (M1 ve sonrası), macOS 14 ve sonrası. Rosetta 2 yoksa kurulur.",
        },
        windows: {
          product: "AnyPS5 Desktop",
          req: "Windows 10 ya da 11, x64. Kullanıcın için kurulur, yönetici gerekmez.",
        },
        linux: {
          product: "AnyPS5 Desktop",
          req: "x64, glibc 2.34 ve üstü (Ubuntu 22.04+). Oyunlar glibc 2.38+ ister.",
        },
        iphone: {
          product: "AnyPS5 Remote",
          req: "iOS 15 ve sonrası. AltStore, SideStore ya da Sideloadly ile kur.",
        },
        android: { product: "AnyPS5 Remote", req: "APK'yı aç ve tarayıcından kurmaya izin ver." },
      },
      web: "Her tarayıcı",
      webProduct: "AnyTogether",
      webReq: "Profiller, arkadaşlar, mesajlar, partiler, ses ve share play izlemek.",
      orTerminal: "Ya da Terminal'de",
      details: "Kurulum adımları",
    },
    open: {
      kicker: "Açık kaynak",
      title: "Kendi sunucunda çalıştır.",
      lead: "Her satırı GitHub'da. AnyTogether MIT lisanslı ve tüm sunucu Docker Compose ile tek makinede çalışır; launcher'lar ve telefon Ayarlar → AnyTogether → Sunucu'dan ona bağlanır.",
      repos: [
        ["AnyTogether", "AnyTogether/AnyTogether", "MIT", "Sunucu ve bu site"],
        [
          "AnyPS5-ARM",
          "AnyTogether/AnyPS5-ARM",
          "GPL-2.0",
          "Mac launcher'ı, motorun portu ve telefon uygulaması",
        ],
        ["AnyPS5-Desktop", "AnyTogether/AnyPS5-Desktop", "GPL-2.0", "Windows ve Linux launcher'ı"],
      ],
      guide: "Kurulum rehberi",
      built: "Açık kaynak PS5 uyumluluk katmanı {link} üzerine kurulu.",
    },
    rules: {
      kicker: "Kurallar",
      title: "Sahip olduğun oyunlarla gel.",
      points: [
        [
          "Sony'nin sunucularına, koduna ya da anahtarlarına asla dokunmayız.",
          "AnyPS5 bir emülatör değil: oyunun kendi programını, sıfırdan yazılmış sistem kütüphanelerine bağlayıp yerel olarak çalıştırır.",
        ],
        [
          "Yalnızca kendi kopyaların.",
          "Sahip olduğun oyunların şifresi çözülmüş dump'larını oynarsın. Burada hiçbir yerde oyun dosyası, firmware ya da anahtar yok; yalnızca AnyPS5'in kendi yazılımı.",
        ],
        [
          "Satış yok, takip yok.",
          "Ücretsiz ve açık kaynak. Verilerin senin: Ayarlar'dan dışa aktar ya da sil.",
        ],
      ],
    },
    final: {
      title: "Kolu eline al.",
      lead: "AnyPS5'i indir, bir kez giriş yap; arkadaşların bir tuş uzağında.",
    },
  },
};

export const siteStrings = (language: Language): SiteStrings => (language === "tr" ? tr : en);
