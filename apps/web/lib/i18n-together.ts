/** Strings of Play Together on the party and friends pages, English and Turkish. */
export const togetherEn = {
  togetherTitle: "Playing together",
  togetherStarted: "{name} started {game}",
  togetherPlaying: "Playing {game} together ({n}/{max})",
  togetherVersion: "Version {version}",
  togetherHost: "Host",
  togetherInGame: "In the game",
  togetherNotYet: "Not in yet",
  togetherJoinHint:
    "Join from AnyPS5 on your Mac or PC: it checks you have the same game and version, then starts it with online play on.",
  togetherHostHint: "It ends for everyone when you quit the game.",
  joinGameTitle: "Play together with {name}",
  togetherCodeAsk: "Get in",
  togetherCodeIn: "You're in. Open AnyPS5 on your Mac or PC and press Join.",
};

export const togetherTr: typeof togetherEn = {
  togetherTitle: "Birlikte oynanıyor",
  togetherStarted: "{name}, {game} başlattı",
  togetherPlaying: "{game} birlikte oynanıyor ({n}/{max})",
  togetherVersion: "Sürüm {version}",
  togetherHost: "Kurucu",
  togetherInGame: "Oyunda",
  togetherNotYet: "Henüz girmedi",
  togetherJoinHint:
    "Mac'inde ya da PC'nde AnyPS5'ten katıl: aynı oyun ve sürüm sende var mı bakar, sonra çevrim içi oyunu açıp oyunu başlatır.",
  togetherHostHint: "Oyundan çıktığında herkes için biter.",
  joinGameTitle: "{name} ile birlikte oyna",
  togetherCodeAsk: "İçeri gir",
  togetherCodeIn: "Girdin. Mac'inde ya da PC'nde AnyPS5'i aç ve Katıl'a bas.",
};

export type TogetherStrings = typeof togetherEn;
