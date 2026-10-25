import type { Language } from "./i18n";

/** The few words the public pages' moving parts carry: the launcher-background switch on the front
 *  page and the share play notices drawn over its pictures. English and Turkish. */

const en = {
  looks: {
    label: "Launcher background",
    cosmic: "Cosmic",
    aurora: "Aurora",
    sunset: "Sunset",
  },
  /** Made-up people, as in the pictures: who sits where during a share play. */
  toasts: [
    { who: "Sol", what: "started watching", seat: 3 },
    { who: "Mira", what: "took controller 2", seat: 2 },
    { who: "Seat 4", what: "is free for a friend", seat: 4 },
  ],
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
    { who: "Mira", what: "2. kolu aldı", seat: 2 },
    { who: "4. koltuk", what: "bir arkadaşı bekliyor", seat: 4 },
  ],
};

export type MotionStrings = typeof en;

export const motionStrings = (language: Language | string): MotionStrings => (language === "tr" ? tr : en);
