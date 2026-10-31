import type { Language } from "./i18n";

/** The words inside the public pages' live pieces: the launcher, share play, the phone pad, the
 *  party, the chat and the board of people looking for players, all rebuilt in HTML on the front
 *  page and the product pages. The people in them are made up, as in the pictures. English and
 *  Turkish; the launcher's own words follow the launcher's translation. */

const en = {
  looks: {
    label: "Launcher background",
    cosmic: "Cosmic",
    aurora: "Aurora",
    sunset: "Sunset",
  },
  toasts: [
    { who: "Sol", what: "started watching", seat: 3 },
    { who: "Mira", what: "took controller 2", seat: 2 },
    { who: "Seat 4", what: "is free for a friend", seat: 4 },
  ],
  launcher: {
    games: "Games",
    user: "Robin",
    ready: "Ready to play",
    converting: "Converting for Mac",
    playing: "Playing",
    play: "Play",
    cancel: "Cancel",
    status: "Status",
    size: "Size",
    titleId: "Title ID",
    version: "Version",
    hints: ["Move", "Game", "Select", "Back"],
    notices: [
      { who: "Mira", what: "is playing Cat Quest III" },
      { who: "Sol", what: "sent you a message" },
      { who: "Bronze trophy", what: "Hollow Knight: Silksong" },
    ],
  },
  share: {
    steps: [
      ["You start a game", "Your launcher shares it. Friends see it on your profile."],
      [
        "A friend asks for a controller",
        "Mira wants controller 2. The game asks player 2 to press a button.",
      ],
      ["She is player 2", "Her keyboard, gamepad or phone drives the second cat, from her browser."],
      ["Two on one couch", "Direct between you, 38 ms. Sol watches through a relay."],
    ],
    live: "Sharing",
    watching: "2 watching",
    joined: "joined as player 2",
  },
  party: {
    title: "Friday co-op",
    talking: "Talking",
    muted: "Muted",
    inGame: "In Cat Quest III",
    members: ["Mira", "Sol", "Kenji", "Ada"],
    leave: "Leave",
    mute: "Mute",
  },
  chat: {
    with: "Mira",
    lines: [
      ["them", "Friday night co-op?"],
      ["me", "Cat Quest III, I'll share. You're P2"],
      ["them", "In. Grabbing my pad"],
    ],
    typing: "Mira is typing",
  },
  friends: {
    title: "Friends",
    people: [
      ["Mira", "Playing Cat Quest III", "playing"],
      ["Sol", "Watching Robin's share play", "watching"],
      ["Kenji", "Online", "online"],
      ["Ada", "Last played 2 h ago", "away"],
    ],
    join: "Join",
  },
  call: {
    who: "Kenji",
    what: "is calling",
    answer: "Answer",
    decline: "Decline",
  },
  board: [
    ["Cat Quest III", "Co-op tonight, one seat left", "EN · voice"],
    ["Hollow Knight: Silksong", "Trophy help: the hard ones", "TR · text"],
    ["Plants vs. Zombies: Replanted", "Casual, any level", "EN · voice"],
    ["DOOM", "Co-op through the whole thing", "DE · voice"],
    ["Cat Quest III", "Watching welcome, P3 and P4 open", "TR · voice"],
    ["Dreaming Sarah", "First run, no spoilers", "EN · text"],
  ],
  boardIn: "I'm in",
  trophy: {
    label: "Trophy unlocked",
    name: "Hollow Knight: Silksong",
    rarity: "Rare",
  },
};

const tr: typeof en = {
  looks: {
    label: "Başlatıcı arka planı",
    cosmic: "Kozmik",
    aurora: "Aurora",
    sunset: "Gün Batımı",
  },
  toasts: [
    { who: "Sol", what: "izlemeye başladı", seat: 3 },
    { who: "Mira", what: "2. kontrolcüyü aldı", seat: 2 },
    { who: "4. koltuk", what: "bir arkadaşı bekliyor", seat: 4 },
  ],
  launcher: {
    games: "Oyunlar",
    user: "Robin",
    ready: "Oynamaya hazır",
    converting: "Mac için dönüştürülüyor",
    playing: "Oynanıyor",
    play: "Oyna",
    cancel: "İptal",
    status: "Durum",
    size: "Boyut",
    titleId: "Oyun kimliği",
    version: "Sürüm",
    hints: ["Gezin", "Oyun", "Seç", "Geri"],
    notices: [
      { who: "Mira", what: "Cat Quest III oynuyor" },
      { who: "Sol", what: "sana mesaj gönderdi" },
      { who: "Bronz kupa", what: "Hollow Knight: Silksong" },
    ],
  },
  share: {
    steps: [
      ["Bir oyun başlatırsın", "Launcher'ın onu paylaşır. Arkadaşların profilinde görür."],
      [
        "Bir arkadaşın kontrolcü ister",
        "Mira 2. kontrolcüyü istiyor. Oyun 2. oyuncudan bir tuşa basmasını bekler.",
      ],
      ["Artık o 2. oyuncu", "Klavyesi, kontrolcüsü ya da telefonu ikinci kediyi tarayıcısından yönetir."],
      ["Aynı kanepede iki kişi", "Aranızda doğrudan, 38 ms. Sol relay üzerinden izliyor."],
    ],
    live: "Paylaşılıyor",
    watching: "2 izleyici",
    joined: "2. oyuncu olarak katıldı",
  },
  party: {
    title: "Cuma co-op",
    talking: "Konuşuyor",
    muted: "Sessizde",
    inGame: "Cat Quest III'te",
    members: ["Mira", "Sol", "Kenji", "Ada"],
    leave: "Ayrıl",
    mute: "Sessize al",
  },
  chat: {
    with: "Mira",
    lines: [
      ["them", "Cuma akşamı co-op?"],
      ["me", "Cat Quest III, ben paylaşırım. Sen P2"],
      ["them", "Varım. Kolumu alıyorum"],
    ],
    typing: "Mira yazıyor",
  },
  friends: {
    title: "Arkadaşlar",
    people: [
      ["Mira", "Cat Quest III oynuyor", "playing"],
      ["Sol", "Robin'in paylaşımını izliyor", "watching"],
      ["Kenji", "Çevrimiçi", "online"],
      ["Ada", "2 saat önce oynadı", "away"],
    ],
    join: "Katıl",
  },
  call: {
    who: "Kenji",
    what: "arıyor",
    answer: "Aç",
    decline: "Reddet",
  },
  board: [
    ["Cat Quest III", "Bu akşam co-op, bir koltuk kaldı", "EN · sesli"],
    ["Hollow Knight: Silksong", "Kupa yardımı: zor olanlar", "TR · yazılı"],
    ["Plants vs. Zombies: Replanted", "Rahat oyun, her seviye", "EN · sesli"],
    ["DOOM", "Baştan sona co-op", "DE · sesli"],
    ["Cat Quest III", "İzleyenler gelsin, P3 ve P4 boş", "TR · sesli"],
    ["Dreaming Sarah", "İlk oynayış, spoiler yok", "EN · yazılı"],
  ],
  boardIn: "Varım",
  trophy: {
    label: "Kupa kazanıldı",
    name: "Hollow Knight: Silksong",
    rarity: "Nadir",
  },
};

export type MotionStrings = typeof en;

export const motionStrings = (language: Language | string): MotionStrings => (language === "tr" ? tr : en);
