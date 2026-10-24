import type { Language } from "./i18n";
import type { Area, Status } from "./roadmap";

/** The roadmap page's own texts; the items are in roadmap.ts. English and Turkish. */
const en = {
  meta: {
    title: "Roadmap: what's done, in progress, next and later · AnyTogether",
    description:
      "The public roadmap of AnyPS5 and AnyTogether: what shipped, what is being built, and what comes next for the Mac and PC launchers, the phone app and online play.",
  },
  kicker: "Roadmap",
  title: ["Where it's going.", "And what's already there."],
  lead: "What shipped, what is being built and what comes next, across the Mac launcher and its engine, AnyPS5 Desktop, the phone app and AnyTogether. Only things that are true.",
  statuses: {
    done: ["Done", "Shipped and in your hands."],
    progress: ["In progress", "Being built right now."],
    next: ["Next", "Up after that."],
    later: ["Later", "Planned, not started."],
  } satisfies Record<Status, [string, string]>,
  areas: {
    mac: "Mac",
    pc: "Windows · Linux",
    phone: "Phone",
    online: "Online",
    engine: "Engine",
  } satisfies Record<Area, string>,
  updated: "Checked against the plan and the releases on {date}.",
  plan: "The full plan, phase by phase",
  suggest: "Suggest something",
  changelog: "What each release brought",
};

export type RoadmapStrings = typeof en;

const tr: RoadmapStrings = {
  meta: {
    title: "Yol haritası: bitenler, yapılanlar, sıradakiler ve sonrası · AnyTogether",
    description:
      "AnyPS5 ve AnyTogether'ın açık yol haritası: çıkanlar, yapılanlar ve Mac ile PC launcher'ları, telefon uygulaması ve çevrimiçi oyun için sırada olanlar.",
  },
  kicker: "Yol haritası",
  title: ["Nereye gidiyor.", "Ve şimdiden neler var."],
  lead: "Mac launcher'ı ve motoru, AnyPS5 Desktop, telefon uygulaması ve AnyTogether genelinde çıkanlar, yapılanlar ve sırada olanlar. Yalnızca doğru olanlar.",
  statuses: {
    done: ["Bitti", "Çıktı, elinde."],
    progress: ["Yapılıyor", "Şu an üzerinde çalışılıyor."],
    next: ["Sırada", "Ondan sonra gelecek."],
    later: ["Sonra", "Planlandı, başlanmadı."],
  },
  areas: {
    mac: "Mac",
    pc: "Windows · Linux",
    phone: "Telefon",
    online: "Çevrimiçi",
    engine: "Motor",
  },
  updated: "{date} tarihinde plana ve sürümlere göre denetlendi.",
  plan: "Aşama aşama tüm plan",
  suggest: "Bir öneride bulun",
  changelog: "Her sürümün getirdikleri",
};

export const roadmapStrings = (language: Language): RoadmapStrings => (language === "tr" ? tr : en);
