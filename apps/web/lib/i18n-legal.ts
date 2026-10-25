import type { Language } from "./i18n";

/** The privacy notice and the terms of use, in English and Turkish, written from what the code
 *  does (packages/db/src/schema.ts, apps/api, apps/web). Change the texts here and the date below
 *  together; the page shows the date at its top and the repository keeps the history. */

/** The day these texts last changed (YYYY-MM-DD). */
export const legalUpdated = "2026-10-25";

/** The AnyTogether server these texts speak for; any other address is someone else's server. */
export const officialOrigin = "https://anytogether.kodla.agency";

const repo = "https://github.com/utkuhalis/AnyTogether";
const issues = `${repo}/issues`;
const history = `${repo}/commits/main/apps/web/lib/i18n-legal.ts`;

/** A paragraph ([text](href) links allowed), a list, labelled items, or a small table. */
export type LegalBlock =
  | string
  | { list: string[] }
  | { items: [string, string][] }
  | { table: { head: [string, string, string]; rows: [string, string, string][] } };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  meta: { title: string; description: string };
  kicker: string;
  title: [string, string];
  lead: string;
  /** "Last updated {date}". */
  updated: string;
  /** Shown on any server but the official one: {host}. */
  otherServer: string;
  summary: { title: string; points: string[] } | null;
  tocLabel: string;
  sections: LegalSection[];
  /** The way to the other document at the bottom. */
  next: { label: string; href: string };
}

// ---------------------------------------------------------------------------------------------
// English

const privacyEn: LegalDoc = {
  meta: {
    title: "Privacy notice · AnyTogether",
    description:
      "What AnyTogether stores about you, who can see it, how long it stays, and how to download or delete it.",
  },
  kicker: "Privacy notice",
  title: ["What AnyTogether keeps,", "and why."],
  lead: "AnyTogether is the online part of AnyPS5: accounts, friends, messages, parties, trophies and cloud saves. This page says in plain words what this server stores about you, who can see it, how long it stays, and how to take it with you or delete it.",
  updated: "Last updated {date}",
  otherServer:
    "This AnyTogether server ({host}) is run by its own operator, not by the AnyTogether project. The text below is the project's notice for anytogether.kodla.agency: ask this server's operator how they handle your data.",
  summary: {
    title: "The short version",
    points: [
      "No ads, no analytics, no trackers, and nothing is sold. The website sets only the cookies it needs to keep you signed in and remember your language.",
      "We keep what the features need: your account and profile, your friends, what you write and send, your play time and trophies, and the files you upload.",
      "You choose who sees your games, trophies, friends, online status and gallery. Out of the box they are for friends only.",
      "Download everything, or delete your account, in [Settings](/settings#data). A deleted account is gone for good 14 days later.",
    ],
  },
  tocLabel: "On this page",
  sections: [
    {
      id: "who",
      title: "Who runs this server",
      blocks: [
        "anytogether.kodla.agency is run by the maintainer of the open source AnyTogether project, Utku Halis (kodla.agency). The maintainer decides what this server keeps and is responsible for it.",
        "AnyTogether is open source: anyone can run their own server, and the AnyPS5 apps can sign in to one. A server at another address is run by its own operator, who decides how it handles data. This notice does not cover it.",
        "The AnyPS5 apps (the Mac launcher, the Windows and Linux launcher, and AnyPS5 Remote on your phone) use this same server when you sign in to AnyTogether in them, so this notice covers what they send here too. What the apps keep on your own computer or phone stays there.",
      ],
    },
    {
      id: "data",
      title: "What we keep",
      blocks: [
        "Only what a feature needs, grouped by what it is for:",
        {
          items: [
            [
              "Account and sign-in",
              "Your email address; the ways you sign in (email codes, passkeys and, where this server offers them, Discord, Google or Apple); and where you are signed in: the app or browser, a device name, when it was last used. There are no passwords. Sign-in codes and session tokens are kept only as hashes.",
            ],
            [
              "Profile",
              "Your handle (an old one is held for you for 30 days after a change), display name, avatar, bio, country, the languages you play in, and your privacy and notification settings. An uploaded avatar is turned into a small JPEG without its metadata.",
            ],
            [
              "Friends",
              "Your friends and friend requests, the people you block, and your reactions to friends' activity.",
            ],
            [
              "Messages",
              "Direct and group messages with their edits and replies, how far you have read, and the photos, clips and voice notes you send. A message you delete is emptied at once; only its place in the thread stays.",
            ],
            [
              "Parties, calls and share play",
              "Which party you are in, invites and requests to join, and when calls start and end. The sound of a call and the picture of a share play go straight between the people in it (or through this server's relay when a direct connection is impossible) and are never recorded.",
            ],
            [
              "Games",
              "What the AnyPS5 launchers report: your play sessions (the game, when it started and ended, whether it closed normally), your library and play time, the trophies you earn and when, and your computers (a random ID, the platform, a name and a model). Your activity feed and the leaderboards are made from these.",
            ],
            [
              "Cloud saves and media",
              "The save archives your launcher uploads (the newest three versions of each slot) and the photos, clips and voice notes you post, up to 100 MB per account on this server. Photos are re-encoded without their metadata; clips and voice notes are kept as sent.",
            ],
            [
              "What you share",
              "Themes you share in the Theme Hub, compatibility reports (the game, platform, versions, your machine and operating system, the frame rate and your note) and looking-for-group posts.",
            ],
            [
              "Families",
              "If you are in a family: your role in it, a child's limits as the parents set them, the child's requests to the parents, and a log of changes for the parents. See [Children and families](#children).",
            ],
            [
              "Linked accounts",
              "If you link Steam or Discord: that account's ID and name (and Discord username), and whether you hide the badge. Never a password or a token.",
            ],
            [
              "Notifications",
              "Your notifications on the site and, for each browser you turn notifications on in, the address of its push service, the keys to encrypt notifications for it, and its language.",
            ],
            [
              "Moderation",
              "Reports you send and reports about you (a reported message is copied for the moderators as it was), warnings, mutes and bans with their reasons, appeals and their answers, and a log of what moderators and the system did.",
            ],
            [
              "Your IP address",
              "Used to count requests against abuse limits, for example sign-in attempts. These counters are kept in memory under the address and run out with their limit, within a day. AnyTogether's own code does not write IP addresses, or anything you write, to its logs.",
            ],
          ],
        },
      ],
    },
    {
      id: "see",
      title: "Who can see what",
      blocks: [
        {
          list: [
            "Anyone, signed in or not: your profile card (handle, display name, avatar, bio, country), the themes you share and your looking-for-group posts. Compatibility reports are shown without your name.",
            "Your friends, everyone, or nobody, as you choose in [Settings → Privacy](/settings#privacy): your games and play time, trophies, friends list, online status and the game you are playing, and your gallery. Out of the box these are for friends only, and others can find you by search. Leaderboards and player suggestions follow the same settings.",
            "The members of a conversation see its messages; the people in a party or a call see who else is there.",
            "In a call or a share play the others' devices connect to yours, so they can learn your IP address, as in any peer-to-peer call.",
            "Moderators see what is reported to them and the restrictions and appeals they handle. Whoever runs the server can technically reach everything on it, messages included: they are not end-to-end encrypted.",
            "Parents and a family's manager see what [Children and families](#children) describes.",
          ],
        },
      ],
    },
    {
      id: "services",
      title: "Other services involved",
      blocks: [
        "Everything is stored on the server that runs this AnyTogether instance. A few features need an outside service:",
        {
          list: [
            "Mail: sign-in codes and the other mails below go out through a mail delivery service, which handles your address and the mail.",
            "Browser notifications, when you turn them on: your browser maker's push service (for example Google, Apple or Mozilla) delivers them. What they say is encrypted for your browser.",
            "Steam and Discord, only when you link them or sign in with them: you sign in on their site and they tell this server who you are. The same for Google and Apple, where this server offers them.",
            "An avatar taken from Discord, Google or Apple loads from that service.",
            "Downloads lead to GitHub, where AnyPS5 is released. This site reads the list of releases from GitHub itself, so visiting tells GitHub nothing until you download.",
            "There are no analytics, advertising or social media scripts on this site, and its fonts are served by this site itself.",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and storage",
      blocks: [
        "The website sets only these cookies, all of them needed for it to work, which is why it asks for no consent:",
        {
          table: {
            head: ["Cookie", "What for", "How long"],
            rows: [
              ["at_access", "Keeps you signed in (not readable by scripts)", "15 minutes, renewed"],
              [
                "at_refresh",
                "Renews your sign-in (not readable by scripts)",
                "90 days, or until you sign out",
              ],
              ["lang", "The language you chose", "1 year"],
              ["at_discord", "A Discord sign-in on its way", "10 minutes"],
              ["at_appeal", "Lets a restricted account see why and appeal", "1 hour"],
            ],
          },
        },
        "Your browser also keeps your voice chat choice (push to talk or open mic) in its local storage. When you are signed in, the site adds a small service worker that shows notifications and a page saying you are offline when there is no connection. It stores only that page, never your data.",
      ],
    },
    {
      id: "mail",
      title: "Mail we send",
      blocks: [
        {
          list: [
            "Sign-in codes and links, when you ask for them.",
            "A code to confirm deleting your account.",
            "A digest of the messages and friend requests you missed, only if you turn it on: at most every 6 hours, without the messages' text.",
            "When a family manager makes a child account for an address: one mail to that address saying who made it.",
            "A weekly family summary for parents who turn it on: play time, the games played most and new friends. No messages.",
          ],
        },
        "No newsletters, no marketing. Turn the optional mails off in [Settings](/settings#notifications).",
      ],
    },
    {
      id: "grounds",
      title: "Why we may use it",
      blocks: [
        {
          list: [
            "To provide the service you signed up for: your account, profile, friends, messages, games and files, which is most of the above.",
            "Our legitimate interest in keeping the service safe and fair: abuse limits, reports, moderation and the record of restrictions.",
            "Your consent, which you can take back at any time: browser notifications, mail digests, family summaries, linked accounts, and compatibility reports sent from the launcher.",
          ],
        },
        "Your data is not used for advertising or profiling, and it is not sold.",
      ],
    },
    {
      id: "retention",
      title: "How long it stays",
      blocks: [
        {
          list: [
            "Your account and everything in it: until you delete the account. Deleting hides your profile and signs out every device at once, and 14 days later everything is deleted for good (signing in during those days cancels it). Your messages are emptied, so the others' conversations keep their order.",
            "A few things outlast an account, without its name: compatibility reports, the games a launcher was first to add to the catalogue, and reports the account sent. A report about a message keeps its copy of that message. A ban on an email address keeps only a hash of the address, so it can still be enforced, and the moderation log keeps the account's ID.",
            "Sign-in codes: deleted 30 days after they expire. Notifications: read ones after 90 days, all after 180 days. A sign-in on a device ends after 90 days without use. Old handles: 30 days.",
            "Cloud saves: the newest three versions of each slot, until you delete them. Photos and clips nobody sent or pinned: deleted after a day, as are unfinished uploads.",
            "Looking-for-group posts close within a day; abuse counters run out within a day.",
            "If the server's operator keeps backups, deleted data can remain in them until those backups are deleted too.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "Your choices and rights",
      blocks: [
        "In [Settings](/settings) you can:",
        {
          list: [
            "choose who sees what;",
            "download everything this server holds about your account as one file, with links to your saves and media;",
            "delete your account;",
            "see and sign out your devices, remove passkeys, unlink Steam or Discord, and turn notifications and mails off.",
          ],
        },
        "Depending on where you live, laws such as the EU's GDPR or Turkey's KVKK give you more rights: to access, correct, delete or move your data, to object to or restrict how it is used, and to complain to your data protection authority. For anything Settings does not cover, see [Contact](#contact).",
      ],
    },
    {
      id: "children",
      title: "Children and families",
      blocks: [
        'Families are opt-in. A manager makes a family and brings people in: parents, other adults and children. A child account that a manager makes waits for the child\'s own confirmation, and anyone added to a family they do not know can leave it with "This is not my family".',
        "Parents choose what a child may do: play time, age ratings, who may message, call or send friend requests. They answer the child's requests (more time, a new friend, a game), see the child's play time, the games they play and the friends they add, and can get a weekly summary. They do not see the child's messages.",
        "If you are under the age at which your country lets you use online services on your own, use AnyTogether only with a parent's permission, ideally in a family.",
      ],
    },
    {
      id: "security",
      title: "Security",
      blocks: [
        "Connections are encrypted (HTTPS). There are no passwords to leak: sign-in codes, session tokens and family codes are stored only as hashes, and a passkey leaves only its public key here. Messages are not end-to-end encrypted, so do not send anything you would not want the server's operator to be able to read.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this notice",
      blocks: [
        `When this notice changes, so does the date at the top. Every change is public in the [AnyTogether repository](${history}).`,
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        `Questions, requests or something wrong: open an issue at [github.com/utkuhalis/AnyTogether](${issues}). Issues are public, so keep personal details out of them; for a private matter, say so in the issue and ask for a private way to reach the maintainer.`,
      ],
    },
  ],
  next: { label: "Terms of use", href: "/terms" },
};

const termsEn: LegalDoc = {
  meta: {
    title: "Terms of use · AnyTogether",
    description:
      "The rules for using AnyTogether: your account, how to behave, what you share, moderation and appeals, cloud saves, and what the service does and does not promise.",
  },
  kicker: "Terms of use",
  title: ["Play fair,", "bring your own games."],
  lead: "AnyTogether is free and open source, run for the players who use it. These terms are the rules for using this server: by signing in you agree to them, and to the way the privacy notice says your data is handled.",
  updated: "Last updated {date}",
  otherServer:
    "This AnyTogether server ({host}) is run by its own operator, not by the AnyTogether project. The terms below are the project's terms for anytogether.kodla.agency; this server's operator may set their own.",
  summary: null,
  tocLabel: "On this page",
  sections: [
    {
      id: "service",
      title: "The service",
      blocks: [
        "AnyTogether is the online part of AnyPS5: accounts, friends, messages, parties and voice, share play, trophies and leaderboards, cloud saves, the Theme Hub and the compatibility list. anytogether.kodla.agency is run by the maintainer of the open source AnyTogether project. It costs nothing and shows no ads.",
        "AnyPS5 and AnyTogether have nothing to do with Sony Interactive Entertainment. PlayStation, PS5 and DualSense are Sony's trademarks.",
      ],
    },
    {
      id: "account",
      title: "Your account",
      blocks: [
        {
          list: [
            "You sign in with an email code or a passkey (and, where this server offers it, another provider). The first sign-in makes the account. Keep access to your email: it is how you get back in.",
            "One person per account. You are responsible for what happens with it: sign out devices you no longer use in [Settings](/settings#devices).",
            "Your handle must not pretend to be someone else, and handles that look alike or are reserved are not given out.",
            "If you are under the age at which your country lets you use online services on your own, use AnyTogether only with a parent's permission. A parent can look after a child's account with [Family](/family).",
          ],
        },
      ],
    },
    {
      id: "rules",
      title: "How to behave",
      blocks: [
        "Treat people the way you would at the same table. On AnyTogether, do not:",
        {
          list: [
            "harass, bully, threaten or stalk anyone, or post hate speech;",
            "post sexual content, or anything that sexualises children;",
            "spam, advertise, or pretend to be someone else;",
            "cheat trophies or leaderboards, or fake compatibility reports;",
            "share game files, firmware, keys or links to pirated copies, in messages, media, themes or anywhere else;",
            "upload malware, or anything you have no right to share;",
            "attack, overload or work around the limits of the service, or collect other people's data from it;",
            "post someone else's private information.",
          ],
        },
        "Using AnyTogether to break the law is against these terms too.",
      ],
    },
    {
      id: "games",
      title: "Your games",
      blocks: [
        "AnyPS5 runs games you own, from dumps of your own copies. Nothing here offers game files, firmware or keys, and you may not use AnyTogether to get or spread them.",
      ],
    },
    {
      id: "content",
      title: "What you share",
      blocks: [
        "What you write and upload stays yours. You let this server store it, change its format where needed (for example re-encoding photos) and show it to the people you chose, for as long as it is here. Themes you share in the Theme Hub can be downloaded by anyone and used in their launcher. Compatibility reports stay on the list, without your name, after you delete your account.",
        "Only share what you have the right to share, and remember that what others can see, they can also save.",
      ],
    },
    {
      id: "moderation",
      title: "Moderation and appeals",
      blocks: [
        "Anyone can report a person, a message, a photo or clip, a theme or a post. Moderators look at reports and can dismiss them, warn, hide content, mute an account (it can sign in but not write to others), or ban an account or an email address, for a while or until lifted. You are told what a restriction is, why, and until when, on the site and in the apps.",
        "If you think a decision is wrong, appeal it from the page that explains it ([/restricted](/restricted)). One appeal can be open at a time, and a moderator answers it.",
      ],
    },
    {
      id: "storage",
      title: "Cloud saves and media",
      blocks: [
        "This server keeps up to 100 MB of saves and media per account. A save slot keeps its newest three versions; older ones make room when needed. Keep your own copies of anything that matters to you: cloud saves are a convenience, not a guaranteed backup.",
      ],
    },
    {
      id: "warranty",
      title: "What we can promise",
      blocks: [
        "AnyTogether is provided free of charge and as it is. It can be down, lose data or change, and features can be added, changed or removed without notice. As far as the law allows, the people who run it are not liable for losses from using it or from not being able to use it. Nothing in these terms takes away rights that the law where you live gives you and that cannot be waived.",
        "The software itself is open source under the MIT license; the license's own terms apply to the code.",
      ],
    },
    {
      id: "ending",
      title: "Ending",
      blocks: [
        "You can delete your account at any time in [Settings](/settings#delete); 14 days later it is gone for good. Accounts that break these terms can be restricted or banned, as described above.",
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      blocks: [
        `When these terms change, so does the date at the top, and every change is public in the [AnyTogether repository](${history}). Using AnyTogether after a change means you accept the new terms.`,
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        `Questions about these terms: open an issue at [github.com/utkuhalis/AnyTogether](${issues}). To report a person or something they posted, use Report on the site or in the app instead: it reaches the moderators directly.`,
      ],
    },
  ],
  next: { label: "Privacy notice", href: "/privacy" },
};

// ---------------------------------------------------------------------------------------------
// Türkçe

const privacyTr: LegalDoc = {
  meta: {
    title: "Gizlilik bildirimi · AnyTogether",
    description:
      "AnyTogether hakkında neleri saklar, kimler görebilir, ne kadar kalır, nasıl indirir ya da silersin.",
  },
  kicker: "Gizlilik bildirimi",
  title: ["AnyTogether neyi saklar,", "neden saklar."],
  lead: "AnyTogether, AnyPS5'in online tarafı: hesaplar, arkadaşlar, mesajlar, partiler, kupalar ve bulut kayıtları. Bu sayfa bu sunucunun senin hakkında neleri sakladığını, kimlerin görebildiğini, ne kadar kaldığını ve onları nasıl yanına alıp silebileceğini sade bir dille anlatır.",
  updated: "Son güncelleme: {date}",
  otherServer:
    "Bu AnyTogether sunucusu ({host}) AnyTogether projesi tarafından değil, kendi işletmecisi tarafından çalıştırılıyor. Aşağıdaki metin projenin anytogether.kodla.agency için yazdığı bildirim: verilerini nasıl işlediğini bu sunucunun işletmecisine sor.",
  summary: {
    title: "Kısaca",
    points: [
      "Reklam, analiz aracı, takipçi yok; hiçbir şey satılmaz. Site yalnızca giriş yapmış kalman ve dilini hatırlaması için gereken çerezleri kullanır.",
      "Yalnızca özelliklerin gerektirdiğini saklarız: hesabın ve profilin, arkadaşların, yazıp gönderdiklerin, oyun süren ve kupaların, yüklediğin dosyalar.",
      "Oyunlarını, kupalarını, arkadaşlarını, çevrimiçi durumunu ve galerini kimin göreceğini sen seçersin. Başta hepsi yalnızca arkadaşlarına açıktır.",
      "Her şeyi [Ayarlar](/settings#data)'dan indirebilir ya da hesabını oradan silebilirsin. Silinen hesap 14 gün sonra tamamen gider.",
    ],
  },
  tocLabel: "Bu sayfada",
  sections: [
    {
      id: "who",
      title: "Bu sunucuyu kim çalıştırıyor",
      blocks: [
        "anytogether.kodla.agency'yi açık kaynak AnyTogether projesinin geliştiricisi Utku Halis (kodla.agency) çalıştırır. Bu sunucunun neleri sakladığına o karar verir ve bundan o sorumludur.",
        "AnyTogether açık kaynaktır: herkes kendi sunucusunu kurabilir ve AnyPS5 uygulamaları böyle bir sunucuya da bağlanabilir. Başka bir adresteki sunucuyu kendi işletmecisi çalıştırır ve verileri nasıl işleyeceğine o karar verir. Bu bildirim o sunucuları kapsamaz.",
        "AnyPS5 uygulamaları (Mac başlatıcısı, Windows ve Linux başlatıcısı, telefondaki AnyPS5 Remote) içlerinde AnyTogether'a giriş yaptığında bu sunucuyu kullanır; bu yüzden bu bildirim onların buraya gönderdiklerini de kapsar. Uygulamaların kendi bilgisayarında ya da telefonunda tuttukları orada kalır.",
      ],
    },
    {
      id: "data",
      title: "Neleri saklıyoruz",
      blocks: [
        "Yalnızca bir özelliğin gerektirdiğini; neye yaradığına göre:",
        {
          items: [
            [
              "Hesap ve giriş",
              "E-posta adresin; giriş yolların (e-posta kodları, geçiş anahtarları ve bu sunucu sunuyorsa Discord, Google ya da Apple); nerelerde giriş yaptığın: uygulama ya da tarayıcı, bir cihaz adı, en son ne zaman kullanıldığı. Şifre yoktur. Giriş kodları ve oturum anahtarları yalnızca özet (hash) olarak tutulur.",
            ],
            [
              "Profil",
              "Kullanıcı adın (değiştirdiğinde eskisi 30 gün senin için ayrılır), görünen adın, avatarın, biyografin, ülken, oynadığın diller, gizlilik ve bildirim ayarların. Yüklediğin avatar, üst verisi atılmış küçük bir JPEG'e dönüştürülür.",
            ],
            [
              "Arkadaşlar",
              "Arkadaşların ve arkadaşlık istekleri, engellediğin kişiler, arkadaşlarının etkinliklerine verdiğin tepkiler.",
            ],
            [
              "Mesajlar",
              "Birebir ve grup mesajları, düzenlemeleri ve yanıtlarıyla; nereye kadar okuduğun; gönderdiğin fotoğraflar, klipler ve sesli notlar. Sildiğin mesaj anında boşaltılır; konuşmada yalnızca yeri kalır.",
            ],
            [
              "Partiler, aramalar ve birlikte oynama",
              "Hangi partide olduğun, davetler ve katılma istekleri, aramaların ne zaman başlayıp bittiği. Aramanın sesi ve birlikte oynamanın görüntüsü içindeki kişiler arasında doğrudan gider (doğrudan bağlantı kurulamazsa bu sunucunun aktarıcısından geçer) ve asla kaydedilmez.",
            ],
            [
              "Oyunlar",
              "AnyPS5 başlatıcılarının bildirdikleri: oyun oturumların (oyun, ne zaman başlayıp bittiği, düzgün kapanıp kapanmadığı), kitaplığın ve oyun süren, kazandığın kupalar ve ne zaman kazandığın, bilgisayarların (rastgele bir kimlik, platform, ad ve model). Etkinlik akışın ve liderlik tabloları bunlardan oluşur.",
            ],
            [
              "Bulut kayıtları ve medya",
              "Başlatıcının yüklediği kayıt arşivleri (her yuvanın en yeni üç sürümü) ve paylaştığın fotoğraflar, klipler ve sesli notlar; bu sunucuda hesap başına 100 MB'a kadar. Fotoğraflar üst verisi atılarak yeniden kodlanır; klipler ve sesli notlar gönderildiği gibi tutulur.",
            ],
            [
              "Paylaştıkların",
              "Tema Merkezi'nde paylaştığın temalar, uyumluluk raporları (oyun, platform, sürümler, makinen ve işletim sistemin, kare hızı ve notun) ve oyuncu arama ilanların.",
            ],
            [
              "Aileler",
              "Bir ailedeysen: ailedeki rolün, ebeveynlerin bir çocuk için koyduğu sınırlar, çocuğun ebeveynlere istekleri ve ebeveynler için bir değişiklik kaydı. Bkz. [Çocuklar ve aileler](#children).",
            ],
            [
              "Bağlı hesaplar",
              "Steam ya da Discord bağlarsan: o hesabın kimliği ve adı (Discord'da kullanıcı adı da) ve rozeti gizleyip gizlemediğin. Asla bir şifre ya da anahtar değil.",
            ],
            [
              "Bildirimler",
              "Sitedeki bildirimlerin ve bildirimleri açtığın her tarayıcı için: anlık bildirim servisinin adresi, bildirimleri ona şifrelemek için anahtarlar ve dili.",
            ],
            [
              "Moderasyon",
              "Gönderdiğin ve senin hakkında gönderilen raporlar (raporlanan mesaj, moderatörler için olduğu gibi kopyalanır), uyarılar, susturmalar ve yasaklar gerekçeleriyle, itirazlar ve yanıtları, moderatörlerin ve sistemin yaptıklarının kaydı.",
            ],
            [
              "IP adresin",
              "Kötüye kullanım sınırlarına karşı istekleri saymak için kullanılır, örneğin giriş denemeleri. Bu sayaçlar adresle birlikte bellekte tutulur ve sınırlarıyla birlikte, en geç bir gün içinde silinir. AnyTogether'ın kendi kodu IP adreslerini ya da yazdıklarını kayıtlarına yazmaz.",
            ],
          ],
        },
      ],
    },
    {
      id: "see",
      title: "Kim neyi görebilir",
      blocks: [
        {
          list: [
            "Giriş yapmış olsun olmasın herkes: profil kartın (kullanıcı adı, görünen ad, avatar, biyografi, ülke), paylaştığın temalar ve oyuncu arama ilanların. Uyumluluk raporları adın olmadan gösterilir.",
            "[Ayarlar → Gizlilik](/settings#privacy)'te seçtiğine göre arkadaşların, herkes ya da hiç kimse: oyunların ve oyun süren, kupaların, arkadaş listen, çevrimiçi durumun ve oynadığın oyun, galerin. Başta bunlar yalnızca arkadaşlarına açıktır ve başkaları seni aramada bulabilir. Liderlik tabloları ve oyuncu önerileri de aynı ayarlara uyar.",
            "Bir konuşmanın üyeleri onun mesajlarını görür; bir partideki ya da aramadaki kişiler orada başka kimlerin olduğunu görür.",
            "Bir aramada ya da birlikte oynamada diğerlerinin cihazları seninkine bağlanır; bu yüzden her eşler arası aramada olduğu gibi IP adresini öğrenebilirler.",
            "Moderatörler kendilerine raporlananları ve ele aldıkları kısıtlama ve itirazları görür. Sunucuyu çalıştıran kişi teknik olarak oradaki her şeye, mesajlar dahil, erişebilir: mesajlar uçtan uca şifreli değildir.",
            "Ebeveynler ve ailenin yöneticisi [Çocuklar ve aileler](#children) bölümünde anlatılanları görür.",
          ],
        },
      ],
    },
    {
      id: "services",
      title: "İşin içindeki diğer servisler",
      blocks: [
        "Her şey bu AnyTogether'ı çalıştıran sunucuda saklanır. Birkaç özellik dışarıdan bir servise ihtiyaç duyar:",
        {
          list: [
            "E-posta: giriş kodları ve aşağıdaki diğer e-postalar bir e-posta gönderim servisiyle gider; bu servis adresini ve e-postayı işler.",
            "Tarayıcı bildirimleri, açarsan: tarayıcının yapımcısının anlık bildirim servisi (örneğin Google, Apple ya da Mozilla) iletir. İçerikleri tarayıcın için şifrelenir.",
            "Steam ve Discord, yalnızca bağladığında ya da onlarla giriş yaptığında: onların sitesinde giriş yaparsın ve bu sunucuya kim olduğunu söylerler. Bu sunucu sunuyorsa Google ve Apple için de aynısı geçerli.",
            "Discord, Google ya da Apple'dan gelen bir avatar o servisten yüklenir.",
            "İndirme bağlantıları AnyPS5'in yayımlandığı GitHub'a gider. Bu site sürüm listesini GitHub'dan kendisi okur; yani indirene kadar ziyaretin GitHub'a bir şey söylemez.",
            "Bu sitede analiz, reklam ya da sosyal medya betiği yoktur; yazı tipleri de sitenin kendisinden gelir.",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "Çerezler ve depolama",
      blocks: [
        "Site yalnızca şu çerezleri kullanır; hepsi çalışması için gerekli olduğundan onay istemez:",
        {
          table: {
            head: ["Çerez", "Ne için", "Ne kadar"],
            rows: [
              ["at_access", "Giriş yapmış kalmanı sağlar (betikler okuyamaz)", "15 dakika, yenilenir"],
              ["at_refresh", "Girişini yeniler (betikler okuyamaz)", "90 gün ya da çıkış yapana kadar"],
              ["lang", "Seçtiğin dil", "1 yıl"],
              ["at_discord", "Yoldaki bir Discord girişi", "10 dakika"],
              ["at_appeal", "Kısıtlanan bir hesabın nedenini görüp itiraz etmesi için", "1 saat"],
            ],
          },
        },
        "Tarayıcın ayrıca sesli sohbet seçimini (bas-konuş ya da açık mikrofon) kendi yerel deposunda tutar. Giriş yaptığında site küçük bir service worker ekler: bildirimleri gösterir ve bağlantı yokken çevrimdışı olduğunu söyleyen bir sayfa açar. Yalnızca o sayfayı saklar, asla verilerini değil.",
      ],
    },
    {
      id: "mail",
      title: "Gönderdiğimiz e-postalar",
      blocks: [
        {
          list: [
            "İstediğinde giriş kodları ve bağlantıları.",
            "Hesap silmeyi onaylamak için bir kod.",
            "Kaçırdığın mesajların ve arkadaşlık isteklerinin özeti, yalnızca açarsan: en fazla 6 saatte bir, mesajların metni olmadan.",
            "Bir aile yöneticisi bir adres için çocuk hesabı açtığında: o adrese, hesabı kimin açtığını söyleyen bir e-posta.",
            "Açan ebeveynlere haftalık aile özeti: oyun süresi, en çok oynanan oyunlar ve yeni arkadaşlar. Mesaj yok.",
          ],
        },
        "Bülten yok, pazarlama yok. İsteğe bağlı e-postaları [Ayarlar](/settings#notifications)'dan kapatabilirsin.",
      ],
    },
    {
      id: "grounds",
      title: "Hangi gerekçeyle kullanıyoruz",
      blocks: [
        {
          list: [
            "Kaydolduğun hizmeti sunmak için: hesabın, profilin, arkadaşların, mesajların, oyunların ve dosyaların; yani yukarıdakilerin çoğu.",
            "Hizmeti güvenli ve adil tutmaktaki meşru menfaatimiz: kötüye kullanım sınırları, raporlar, moderasyon ve kısıtlamaların kaydı.",
            "Her an geri alabileceğin açık rızan: tarayıcı bildirimleri, e-posta özetleri, aile özetleri, bağlı hesaplar ve başlatıcıdan gönderilen uyumluluk raporları.",
          ],
        },
        "Verilerin reklam ya da profilleme için kullanılmaz ve satılmaz.",
      ],
    },
    {
      id: "retention",
      title: "Ne kadar kalır",
      blocks: [
        {
          list: [
            "Hesabın ve içindeki her şey: hesabı silene kadar. Silmek profilini hemen gizler ve tüm cihazlardan çıkış yapar; 14 gün sonra her şey kalıcı olarak silinir (bu sürede giriş yapmak silmeyi iptal eder). Mesajların boşaltılır; böylece diğerlerinin konuşmaları sırasını korur.",
            "Birkaç şey hesaptan sonra da adı olmadan kalır: uyumluluk raporları, bir başlatıcının kataloğa ilk eklediği oyunlar ve hesabın gönderdiği raporlar. Bir mesaj hakkındaki rapor o mesajın kopyasını tutar. Bir e-posta adresine konan yasak, uygulanmaya devam edebilmesi için adresin yalnızca özetini tutar; moderasyon kaydı da hesabın kimliğini tutar.",
            "Giriş kodları: süreleri dolduktan 30 gün sonra silinir. Bildirimler: okunanlar 90 gün, hepsi 180 gün sonra. Bir cihazdaki giriş 90 gün kullanılmazsa sona erer. Eski kullanıcı adları: 30 gün.",
            "Bulut kayıtları: her yuvanın en yeni üç sürümü, sen silene kadar. Kimseye gönderilmemiş ya da sabitlenmemiş fotoğraf ve klipler bir gün sonra silinir; yarım kalan yüklemeler de.",
            "Oyuncu arama ilanları bir gün içinde kapanır; kötüye kullanım sayaçları bir gün içinde silinir.",
            "Sunucunun işletmecisi yedek alıyorsa silinen veriler o yedekler de silinene kadar onlarda kalabilir.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "Seçeneklerin ve hakların",
      blocks: [
        "[Ayarlar](/settings)'da şunları yapabilirsin:",
        {
          list: [
            "kimin neyi göreceğini seçmek;",
            "bu sunucunun hesabın hakkında tuttuğu her şeyi, kayıtlarına ve medyana bağlantılarla birlikte tek bir dosya olarak indirmek;",
            "hesabını silmek;",
            "cihazlarını görüp çıkış yaptırmak, geçiş anahtarlarını kaldırmak, Steam ya da Discord bağlantısını kesmek, bildirimleri ve e-postaları kapatmak.",
          ],
        },
        "Nerede yaşadığına göre Türkiye'de KVKK ya da AB'de GDPR gibi yasalar sana başka haklar da tanır: verilerine erişmek, düzeltmek, silmek ya da taşımak, işlenmesine itiraz etmek ya da kısıtlamak ve veri koruma kurumuna şikâyette bulunmak. Ayarların karşılamadığı her şey için [İletişim](#contact) bölümüne bak.",
      ],
    },
    {
      id: "children",
      title: "Çocuklar ve aileler",
      blocks: [
        'Aileler isteğe bağlıdır. Bir yönetici aile kurar ve içine ebeveynleri, diğer yetişkinleri ve çocukları alır. Yöneticinin açtığı çocuk hesabı çocuğun kendi onayını bekler; tanımadığı bir aileye eklenen herkes "Bu benim ailem değil" diyerek aileden çıkabilir.',
        "Ebeveynler bir çocuğun neler yapabileceğini seçer: oyun süresi, yaş sınırları, kimlerin mesaj atabileceği, arayabileceği ya da arkadaşlık isteği gönderebileceği. Çocuğun isteklerini (daha fazla süre, yeni bir arkadaş, bir oyun) yanıtlar, çocuğun oyun süresini, oynadığı oyunları ve eklediği arkadaşları görür ve haftalık özet alabilirler. Çocuğun mesajlarını görmezler.",
        "Ülkenin, çevrimiçi hizmetleri tek başına kullanmak için belirlediği yaşın altındaysan AnyTogether'ı yalnızca bir ebeveynin izniyle, tercihen bir aile içinde kullan.",
      ],
    },
    {
      id: "security",
      title: "Güvenlik",
      blocks: [
        "Bağlantılar şifrelidir (HTTPS). Sızacak şifre yoktur: giriş kodları, oturum anahtarları ve aile kodları yalnızca özet olarak saklanır; bir geçiş anahtarı burada yalnızca açık anahtarını bırakır. Mesajlar uçtan uca şifreli değildir; sunucunun işletmecisinin okuyabilmesini istemediğin bir şeyi gönderme.",
      ],
    },
    {
      id: "changes",
      title: "Bu bildirimdeki değişiklikler",
      blocks: [
        `Bu bildirim değiştiğinde en üstteki tarih de değişir. Her değişiklik [AnyTogether deposunda](${history}) herkese açıktır.`,
      ],
    },
    {
      id: "contact",
      title: "İletişim",
      blocks: [
        `Sorular, istekler ya da bir sorun için [github.com/utkuhalis/AnyTogether](${issues}) adresinde bir issue aç. Issue'lar herkese açıktır; içine kişisel bilgi yazma. Özel bir konuysa bunu issue'da belirt ve geliştiriciye ulaşmak için özel bir yol iste.`,
      ],
    },
  ],
  next: { label: "Kullanım koşulları", href: "/terms" },
};

const termsTr: LegalDoc = {
  meta: {
    title: "Kullanım koşulları · AnyTogether",
    description:
      "AnyTogether'ı kullanma kuralları: hesabın, davranış kuralları, paylaştıkların, moderasyon ve itiraz, bulut kayıtları, hizmetin neyi vaat edip neyi etmediği.",
  },
  kicker: "Kullanım koşulları",
  title: ["Adil oyna,", "kendi oyunlarını getir."],
  lead: "AnyTogether ücretsiz ve açık kaynaktır; onu kullanan oyuncular için çalıştırılır. Bu koşullar bu sunucuyu kullanmanın kurallarıdır: giriş yaparak bunları ve verilerinin gizlilik bildiriminde anlatıldığı gibi işlenmesini kabul edersin.",
  updated: "Son güncelleme: {date}",
  otherServer:
    "Bu AnyTogether sunucusu ({host}) AnyTogether projesi tarafından değil, kendi işletmecisi tarafından çalıştırılıyor. Aşağıdaki koşullar projenin anytogether.kodla.agency için koşulları; bu sunucunun işletmecisi kendi koşullarını koyabilir.",
  summary: null,
  tocLabel: "Bu sayfada",
  sections: [
    {
      id: "service",
      title: "Hizmet",
      blocks: [
        "AnyTogether, AnyPS5'in online tarafıdır: hesaplar, arkadaşlar, mesajlar, partiler ve sesli sohbet, birlikte oynama, kupalar ve liderlik tabloları, bulut kayıtları, Tema Merkezi ve uyumluluk listesi. anytogether.kodla.agency'yi açık kaynak AnyTogether projesinin geliştiricisi çalıştırır. Ücretsizdir ve reklam göstermez.",
        "AnyPS5 ve AnyTogether'ın Sony Interactive Entertainment ile bir ilgisi yoktur. PlayStation, PS5 ve DualSense Sony'nin markalarıdır.",
      ],
    },
    {
      id: "account",
      title: "Hesabın",
      blocks: [
        {
          list: [
            "E-posta koduyla ya da geçiş anahtarıyla (bu sunucu sunuyorsa başka bir sağlayıcıyla da) giriş yaparsın. İlk giriş hesabı açar. E-postana erişimini koru: hesabına dönmenin yolu odur.",
            "Her hesap tek bir kişi içindir. Hesabında olanlardan sen sorumlusun: artık kullanmadığın cihazlardan [Ayarlar](/settings#devices)'da çıkış yap.",
            "Kullanıcı adın başkası gibi görünmemeli; birbirine benzeyen ya da ayrılmış kullanıcı adları verilmez.",
            "Ülkenin, çevrimiçi hizmetleri tek başına kullanmak için belirlediği yaşın altındaysan AnyTogether'ı yalnızca bir ebeveynin izniyle kullan. Ebeveynler çocuğun hesabını [Aile](/family) ile yönetebilir.",
          ],
        },
      ],
    },
    {
      id: "rules",
      title: "Davranış kuralları",
      blocks: [
        "İnsanlara aynı masada oturuyormuş gibi davran. AnyTogether'da şunları yapma:",
        {
          list: [
            "kimseyi taciz etme, zorbalık yapma, tehdit etme ya da takip etme; nefret söylemi paylaşma;",
            "cinsel içerik ya da çocukları cinselleştiren herhangi bir şey paylaşma;",
            "spam yapma, reklam yapma, başkası gibi davranma;",
            "kupalarda ya da liderlik tablolarında hile yapma, sahte uyumluluk raporu gönderme;",
            "mesajlarda, medyada, temalarda ya da başka bir yerde oyun dosyası, firmware, anahtar ya da korsan kopya bağlantısı paylaşma;",
            "zararlı yazılım ya da paylaşma hakkın olmayan bir şey yükleme;",
            "hizmete saldırma, onu aşırı yükleme, sınırlarını aşmaya çalışma ya da ondan başkalarının verilerini toplama;",
            "başkasının özel bilgilerini paylaşma.",
          ],
        },
        "AnyTogether'ı yasalara aykırı bir şey için kullanmak da bu koşullara aykırıdır.",
      ],
    },
    {
      id: "games",
      title: "Oyunların",
      blocks: [
        "AnyPS5 sahip olduğun oyunları, kendi kopyalarının dökümlerinden çalıştırır. Burada hiçbir yerde oyun dosyası, firmware ya da anahtar sunulmaz; AnyTogether'ı bunları edinmek ya da yaymak için kullanamazsın.",
      ],
    },
    {
      id: "content",
      title: "Paylaştıkların",
      blocks: [
        "Yazdıkların ve yüklediklerin senin olarak kalır. Burada durdukları sürece bu sunucunun onları saklamasına, gerektiğinde biçimini değiştirmesine (örneğin fotoğrafları yeniden kodlamak) ve seçtiğin kişilere göstermesine izin verirsin. Tema Merkezi'nde paylaştığın temaları herkes indirip kendi başlatıcısında kullanabilir. Uyumluluk raporları hesabını sildikten sonra da adın olmadan listede kalır.",
        "Yalnızca paylaşma hakkın olanı paylaş ve başkalarının görebildiğini kaydedebileceğini de unutma.",
      ],
    },
    {
      id: "moderation",
      title: "Moderasyon ve itiraz",
      blocks: [
        "Herkes bir kişiyi, mesajı, fotoğraf ya da klibi, temayı ya da ilanı raporlayabilir. Moderatörler raporlara bakar; raporu kapatabilir, uyarabilir, içeriği gizleyebilir, bir hesabı susturabilir (giriş yapabilir ama başkalarına yazamaz) ya da bir hesabı veya e-posta adresini bir süreliğine ya da kaldırılana kadar yasaklayabilir. Kısıtlamanın ne olduğu, nedeni ve ne zamana kadar sürdüğü sitede ve uygulamalarda sana söylenir.",
        "Bir kararın yanlış olduğunu düşünüyorsan onu açıklayan sayfadan ([/restricted](/restricted)) itiraz et. Aynı anda bir itiraz açık olabilir ve bir moderatör onu yanıtlar.",
      ],
    },
    {
      id: "storage",
      title: "Bulut kayıtları ve medya",
      blocks: [
        "Bu sunucu hesap başına 100 MB'a kadar kayıt ve medya tutar. Bir kayıt yuvası en yeni üç sürümünü tutar; gerektiğinde eskiler yer açar. Senin için önemli olan her şeyin kendi kopyasını sakla: bulut kayıtları bir kolaylıktır, garantili bir yedek değildir.",
      ],
    },
    {
      id: "warranty",
      title: "Neyi vaat edebiliriz",
      blocks: [
        "AnyTogether ücretsiz ve olduğu gibi sunulur. Erişilemez olabilir, veri kaybedebilir ya da değişebilir; özellikler haber verilmeden eklenebilir, değiştirilebilir ya da kaldırılabilir. Yasaların izin verdiği ölçüde, onu çalıştıranlar kullanımından ya da kullanılamamasından doğan kayıplardan sorumlu değildir. Bu koşullardaki hiçbir şey, yaşadığın yerin yasalarının sana tanıdığı ve vazgeçilemeyen hakları ortadan kaldırmaz.",
        "Yazılımın kendisi MIT lisansıyla açık kaynaktır; kod için lisansın kendi koşulları geçerlidir.",
      ],
    },
    {
      id: "ending",
      title: "Sona erme",
      blocks: [
        "Hesabını istediğin zaman [Ayarlar](/settings#delete)'dan silebilirsin; 14 gün sonra tamamen gider. Bu koşulları çiğneyen hesaplar yukarıda anlatıldığı gibi kısıtlanabilir ya da yasaklanabilir.",
      ],
    },
    {
      id: "changes",
      title: "Bu koşullardaki değişiklikler",
      blocks: [
        `Bu koşullar değiştiğinde en üstteki tarih de değişir ve her değişiklik [AnyTogether deposunda](${history}) herkese açıktır. Bir değişiklikten sonra AnyTogether'ı kullanmaya devam etmek yeni koşulları kabul ettiğin anlamına gelir.`,
      ],
    },
    {
      id: "contact",
      title: "İletişim",
      blocks: [
        `Bu koşullarla ilgili sorular için [github.com/utkuhalis/AnyTogether](${issues}) adresinde bir issue aç. Bir kişiyi ya da paylaştığı bir şeyi bildirmek içinse sitedeki ya da uygulamadaki Raporla'yı kullan: doğrudan moderatörlere ulaşır.`,
      ],
    },
  ],
  next: { label: "Gizlilik bildirimi", href: "/privacy" },
};

export const legalStrings = (language: Language) =>
  language === "tr" ? { privacy: privacyTr, terms: termsTr } : { privacy: privacyEn, terms: termsEn };

/** The legal links and the app install hint elsewhere on the site (sign-in, Settings), merged into
 *  the main strings. */
export const legalUiEn = {
  agreeLine: "By continuing you agree to the {terms} and the {privacy}.",
  termsLink: "Terms",
  privacyLink: "Privacy notice",
  legalLinks: "How your data is handled: {privacy} · {terms}",
  termsOfUse: "Terms of use",
  sectionApp: "The app",
  appLead: "Put AnyTogether on your home screen: it opens in its own window, like an app.",
  installHeading: "Install AnyTogether",
  installReady: "Opens in its own window, with notifications.",
  installButton: "Install",
  installDone: "Installed. Open it from your home screen or dock.",
  installIos: "On iPhone and iPad: tap Share {share}, then Add to Home Screen.",
  installIosNote: "Notifications on iPhone and iPad work from the Home Screen app.",
};

export const legalUiTr: typeof legalUiEn = {
  agreeLine: "Devam ederek {terms} ve {privacy} metinlerini kabul etmiş olursun.",
  termsLink: "Kullanım koşulları",
  privacyLink: "Gizlilik bildirimi",
  legalLinks: "Verilerin nasıl işleniyor: {privacy} · {terms}",
  termsOfUse: "Kullanım koşulları",
  sectionApp: "Uygulama",
  appLead: "AnyTogether'ı ana ekranına ekle: bir uygulama gibi kendi penceresinde açılır.",
  installHeading: "AnyTogether'ı yükle",
  installReady: "Bildirimlerle birlikte kendi penceresinde açılır.",
  installButton: "Yükle",
  installDone: "Yüklendi. Ana ekranından ya da Dock'tan aç.",
  installIos: "iPhone ve iPad'de: Paylaş'a {share}, ardından Ana Ekrana Ekle'ye dokun.",
  installIosNote: "iPhone ve iPad'de bildirimler Ana Ekran'a eklenen uygulamada çalışır.",
};
