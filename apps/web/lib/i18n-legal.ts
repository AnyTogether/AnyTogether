import type { Language } from "./i18n";

/** The privacy notice and the terms of use, in English and Turkish, written from what the code
 *  does (packages/db/src/schema.ts, apps/api, apps/web). Change the texts here and the date below
 *  together; the page shows the date at its top and the repository keeps the history. */

/** The day these texts last changed (YYYY-MM-DD). */
export const legalUpdated = "2026-10-26";

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
      "We keep what the features need: your account and profile, your friends, what you write and send, your play time and trophies, the communities you join, and the files you upload.",
      "You choose who sees your games, trophies, friends, online status and gallery, and you can appear offline. Out of the box they are for friends only.",
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
        "The AnyPS5 apps (the Mac launcher, the Windows and Linux launcher, and AnyPS5 Remote on your phone) use this same server when you sign in to AnyTogether in them, so this notice covers what they send here too. What the apps keep on your own computer or phone stays there, such as the log of a game's online calls that the Mac launcher writes on your Mac when you turn on Online play: it is never sent here.",
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
              "Your handle (an old one is held for you for 30 days after a change), display name, avatar, bio, country, the languages you play in, a cover and an accent colour, the trophies and games you pin to your showcase, your trophy level (worked out from your trophy points), your privacy, notification and Appear offline settings, and, if you set them, a private name and a private picture for your friends. An uploaded avatar or private picture is turned into a small JPEG without its metadata.",
            ],
            [
              "Friends",
              "Your friends and friend requests, the people you block, and your reactions to friends' activity. And, so you can find them again, who you were with in a party, a share play, an online game or a looking-for-group game, with the game and when (Recently played with). This is on until you turn it off on the [Recently played with](/players) page, which also deletes the list, and each person is forgotten 90 days after you last played together.",
            ],
            [
              "Online status",
              "While an app or the site is open: which of your devices are online and what you are playing, kept in memory and gone about two minutes after a device's last sign of life, and when each device was last used. With Appear offline everyone sees you as offline, but the server still knows you are connected, so messages and calls reach you.",
            ],
            [
              "Messages",
              'Direct and group messages with their edits (at most 20 per message) and replies, the reactions you add and who added them, how far you have read, how far your devices have received (delivered), whether you send read receipts, the conversations you pin or mute, and the photos, clips and voice notes you send. Reactions and these marks stay as long as the message and your place in the conversation do. A message you unsend (your own, at any time) is emptied at once: its text, media and reactions go, and only its place in the thread stays as "message removed".',
            ],
            [
              "Parties, calls and share play",
              "Which party you are in, invites and requests to join, a party's Discord link if its members add one, join codes (who made one, for what, and when it stops working: after 24 hours unless chosen otherwise, 72 at most), and calls: who called whom, and when the call started, was answered and ended. The sound of a call and the picture of a share play go straight between the people in it (or through this server's relay when a direct connection is impossible) and are never recorded.",
            ],
            [
              "Games",
              "What the AnyPS5 launchers report: your play sessions (the game, when it started and ended, whether it closed normally), your library and play time, the trophies you earn and when, and your computers (a random ID, the platform, a name and a model). When you play online, play together with your party or join a friend's game: the game session (the game and its version, the AnyPS5 version, the party it belongs to, who is in it, each player's game version and whether they chose to try anyway with a version that did not fit, and what the game shares with the other players). Your activity feed and the leaderboards are made from these.",
            ],
            [
              "Cloud saves and media",
              "The save archives your launcher uploads (the newest three versions of each slot) and the photos, clips and voice notes you post, up to 100 MB per account on this server. Photos are re-encoded without their metadata; clips and voice notes are kept as sent.",
            ],
            [
              "Captures",
              "The screenshots and clips you post as captures, with their caption (and when you last edited it), the game, where you posted from and who may see them (your friends, or everyone signed in), the likes you give and get, and the comments and replies you write. Pictures are re-encoded without their metadata, like every photo.",
            ],
            [
              "What you share",
              "Themes you share in the Theme Hub, compatibility reports (the game, platform, versions, your machine and operating system, the frame rate and your note) and looking-for-group posts.",
            ],
            [
              "Communities and events",
              "The communities you make or join and your role in them, invites, the members a community's moderators remove or ban (with the reason they give), the community's chat (kept like other messages), and the events you plan or say you are going to.",
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
              "Reports you send and reports about you (a reported message, or a reported private name and picture, is copied for the moderators as it was), warnings, mutes and bans with their reasons, appeals and their answers, and a log of what moderators and the system did.",
            ],
            [
              "Your IP address",
              "Used to count requests against abuse limits, for example sign-in attempts. These counters are kept in memory under the address and run out with their limit, within a day. When a call or a share play goes through this server's relay, the relay sees your IP address and writes the connection, with your account's ID, to its own log, which is deleted after 7 days. The mail server's log of who a mail went to is deleted after 30 days. There is no web access log, and AnyTogether's own code does not write IP addresses, or anything you write, to its logs.",
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
            "Anyone, signed in or not: your profile card (handle, display name, avatar, bio, country, cover and accent colour, and the Steam or Discord badges you have not hidden), the themes you share and your looking-for-group posts. Compatibility reports are shown without your name. Profile pages ask search engines not to list them. Whoever has a join code you made sees your profile card, the game and how many are in the party.",
            "Your friends, everyone, or nobody, as you choose in [Settings → Privacy](/settings#privacy): your games and play time, trophies (with your trophy level, and comparing trophies with you), friends list, online status and the game you are playing, and your gallery. Out of the box these are for friends only, and others can find you by search. Your showcase, leaderboards and player suggestions follow the same settings.",
            "Only you and your accepted friends: your private name and private picture, set in [Settings → Friends only](/settings#private). Your handle is your public ID; these are not. They are never shown in search (nor searched by), on your public profile or link previews, to people you only share a party, a conversation, a game or a community with, to anyone you blocked or who blocked you, or in moderators' lists. When a friendship ends they stop being shown; a link to the private picture a former friend already had stops working within 12 hours. A friend can report them: the moderators then see them as they were, and can clear them.",
            "The members of a conversation see its messages and their reactions, with who reacted; in a direct conversation the other person sees when a message reached one of your devices. With read receipts on (the default, in [Settings → Privacy](/settings#privacy)) the members also see how far you have read; turn them off and they do not, and you do not see theirs. The people in a party or a call see who else is there, and only a party's members see its Discord link. Only you see your Recently played with list; the people on it see you on theirs.",
            "Anyone signed in sees a public community, its members (with their role and when they joined) and who is going to its events; an invite-only community is seen only by its members.",
            "In a call, a share play or an online game the others' devices connect to yours, so they can learn your IP address, as in any peer-to-peer connection.",
            "Your captures: a Friends post is seen only by you and your friends; a Public one by anyone signed in, on your profile, the game's page and in the Captures feed of people who played with you. They are never on your signed-out profile or in link previews. Whoever can see a post sees its comments and the number of likes; the list of who liked it shows its author everyone, and others only their friends and people whose search setting is everyone. No one you blocked, or who blocked you, sees your posts, likes or comments, and you do not see theirs. A child's posts are for friends only.",
            "Moderators see what is reported to them and the restrictions and appeals they handle; a community's moderators see its members and can remove or ban them from it. Whoever runs the server can technically reach everything on it, messages included: they are not end-to-end encrypted.",
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
            "An avatar taken from Discord, Google or Apple loads from that service. Some games' icons, and profile covers made from them, load from the site that keeps the icon (only sites this server allows), which then sees your IP address.",
            "To draw the picture shown when someone shares a link to a profile, this server asks Google Fonts for the letters it needs. That request contains the profile's name, handle and bio, which are public anyway, but nothing about who is looking.",
            "Downloads lead to GitHub, where AnyPS5 is released. This site reads the list of releases from GitHub itself, so visiting tells GitHub nothing until you download.",
            "There are no analytics, advertising or social media scripts on this site, and the fonts your browser loads come from this site itself.",
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
        "Your browser also keeps your voice chat choice (push to talk or open mic) in its local storage. When you are signed in, the site adds a small service worker that shows notifications and a page saying you are offline when there is no connection. It stores only that page, never your data. Installing the site as an app (Add to Home Screen) stores nothing more.",
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
            "Your account and everything in it: until you delete the account. Deleting hides your profile and signs out every device at once, and 14 days later everything is deleted for good (signing in during those days cancels it). Your messages are emptied, so the others' conversations keep their order. A community you own passes to one of its moderators or members (or ends when no one is left), and its name and description stay; events you planned stay without your name; you disappear from everyone's Recently played with.",
            "A few things outlast an account, without its name: compatibility reports, the games a launcher was first to add to the catalogue, and reports the account sent. A report about a message keeps its copy of that message. A ban on an email address keeps only a hash of the address, so it can still be enforced, and the moderation log keeps the account's ID.",
            "Sign-in codes: deleted 30 days after they expire. Notifications: read ones after 90 days, all after 180 days. Recently played with: 90 days after you last played together. A sign-in on a device ends after 90 days without use (the record of it stays with your account). An old handle is held for you for 30 days (the list of your past handles stays with your account).",
            "Cloud saves: the newest three versions of each slot, until you delete them. Photos and clips nobody sent, pinned or posted: deleted after a day, as are unfinished uploads. Captures, their likes and comments: until you delete them or the account; deleting a post takes its likes and comments with it, and its media unless something else uses it. A moderator may remove a reported post or comment.",
            "Looking-for-group posts leave the board within a day (the post stays with your account); join codes stop working when they run out; abuse counters run out within a day. Push notification addresses go when you turn notifications off, sign out of that browser, or the push service says it is gone.",
            "With no shorter limit, these stay until your account is deleted: call records, parties and their Discord links, game sessions, join codes, and community events, invites and bans (or until the community is deleted). Reports, restrictions, appeals and the moderation log have no set end.",
            "This server's database and files are backed up every night, and each backup is deleted after 14 days. What you delete, or a deleted account, can remain in a backup until that backup is deleted. If backups are also kept with an outside storage provider, they will be encrypted before they leave this server, follow the same 14 days, and the provider will be named here.",
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
            "download what this server holds about your account as one file (your account, profile, friends, messages, games, communities, captures with your comments and likes, Recently played with and more), with links to your saves and media. A few records are not in it yet: calls, parties, game sessions, and the themes and compatibility reports you shared; ask for them under [Contact](#contact);",
            "delete your account;",
            "see and sign out your devices, remove passkeys, unlink Steam or Discord, appear offline, turn Recently played with off, and turn notifications and mails off.",
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
        "Parents also choose whether a child may use communities and their events (off at first). Recently played with is on for children as for everyone, and a child can turn it off; parents do not see that list or the child's communities.",
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
        "AnyTogether is the online part of AnyPS5: accounts, friends, messages, parties and voice, share play, trophies and leaderboards, communities and events, cloud saves, the Theme Hub and the compatibility list. anytogether.kodla.agency is run by the maintainer of the open source AnyTogether project. It costs nothing and shows no ads.",
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
        "Using AnyTogether to break the law is against these terms too. If you run a community or plan an event, keep it within these rules as well.",
      ],
    },
    {
      id: "games",
      title: "Your games",
      blocks: [
        "AnyPS5 runs games you own, from dumps of your own copies. Nothing here offers game files, firmware or keys, and you may not use AnyTogether to get or spread them.",
        "Online play in the AnyPS5 launcher is experimental: it may not work with a game, or may stop working, and in an online game the other players' computers connect to yours.",
      ],
    },
    {
      id: "content",
      title: "What you share",
      blocks: [
        "What you write and upload stays yours. You let this server store it, change its format where needed (for example re-encoding photos) and show it to the people you chose, for as long as it is here. Themes you share in the Theme Hub can be downloaded by anyone and used in their launcher. Compatibility reports stay on the list, without your name, after you delete your account.",
        "Only share what you have the right to share, and remember that what others can see, they can also save. Give a join code only to people you want in: whoever has it sees your profile card and can ask to join, until it runs out or you make a new one.",
      ],
    },
    {
      id: "moderation",
      title: "Moderation and appeals",
      blocks: [
        "Anyone can report a person, a message, a photo or clip, a theme, a post, a community or an event. Moderators look at reports and can dismiss them, warn, hide content, mute an account (it can sign in but not write to others), or ban an account or an email address, for a while or until lifted. You are told what a restriction is, why, and until when, on the site and in the apps.",
        "If you think a decision is wrong, appeal it from the page that explains it ([/restricted](/restricted)). One appeal can be open at a time, and a moderator answers it.",
        "A community's owner and moderators can remove or ban members from that community. That is their decision about their community, not a restriction on your account, and the site's moderators can remove a community or an event that breaks these terms.",
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
      "Yalnızca özelliklerin gerektirdiğini saklarız: hesabın ve profilin, arkadaşların, yazıp gönderdiklerin, oyun süren ve kupaların, katıldığın topluluklar, yüklediğin dosyalar.",
      "Oyunlarını, kupalarını, arkadaşlarını, çevrimiçi durumunu ve galerini kimin göreceğini sen seçersin; istersen çevrimdışı görünebilirsin. Başta hepsi yalnızca arkadaşlarına açıktır.",
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
        "AnyPS5 uygulamaları (Mac başlatıcısı, Windows ve Linux başlatıcısı, telefondaki AnyPS5 Remote) içlerinde AnyTogether'a giriş yaptığında bu sunucuyu kullanır; bu yüzden bu bildirim onların buraya gönderdiklerini de kapsar. Uygulamaların kendi bilgisayarında ya da telefonunda tuttukları orada kalır; örneğin Online oyunu açtığında Mac başlatıcısının Mac'inde tuttuğu, bir oyunun online çağrılarının kaydı: buraya asla gönderilmez.",
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
              "Kullanıcı adın (değiştirdiğinde eskisi 30 gün senin için ayrılır), görünen adın, avatarın, biyografin, ülken, oynadığın diller, kapak görselin ve vurgu rengin, vitrinine iliştirdiğin kupalar ve oyunlar, kupa puanlarından hesaplanan kupa seviyen, gizlilik, bildirim ve Çevrimdışı görün ayarların ve belirlediysen arkadaşların için gizli bir isim ve gizli bir resim. Yüklediğin avatar ya da gizli resim, üst verisi atılmış küçük bir JPEG'e dönüştürülür.",
            ],
            [
              "Arkadaşlar",
              "Arkadaşların ve arkadaşlık istekleri, engellediğin kişiler, arkadaşlarının etkinliklerine verdiğin tepkiler. Bir de, onları yeniden bulabilmen için, bir partide, birlikte oynamada, online bir oyunda ya da oyuncu arama ilanıyla girilen bir oyunda kimlerle olduğun, hangi oyunda ve ne zaman (Son oynadıkların). Bu, [Son oynadıkların](/players) sayfasından kapatana kadar açıktır; kapatmak listeyi de siler. Her kişi, onunla son oynadığından 90 gün sonra unutulur.",
            ],
            [
              "Çevrimiçi durum",
              "Bir uygulama ya da site açıkken: hangi cihazlarının çevrimiçi olduğu ve ne oynadığın; bellekte tutulur ve bir cihazdan son haber alındıktan yaklaşık iki dakika sonra silinir. Bir de her cihazın en son ne zaman kullanıldığı. Çevrimdışı görün açıkken herkes seni çevrimdışı görür, ama mesajlar ve aramalar sana ulaşsın diye sunucu bağlı olduğunu bilmeye devam eder.",
            ],
            [
              "Mesajlar",
              'Birebir ve grup mesajları, düzenlemeleri (bir mesaj en fazla 20 kez) ve yanıtlarıyla; eklediğin tepkiler ve onları kimin eklediği; nereye kadar okuduğun; cihazlarının nereye kadar aldığı (iletildi); okundu bilgisi gönderip göndermediğin; sabitlediğin ya da sessize aldığın konuşmalar; gönderdiğin fotoğraflar, klipler ve sesli notlar. Tepkiler ve bu işaretler, mesaj ve konuşmadaki yerin durdukça kalır. Geri aldığın mesaj (kendi mesajın, istediğin zaman) anında boşaltılır: metni, medyası ve tepkileri gider; konuşmada yalnızca yeri "mesaj kaldırıldı" olarak kalır.',
            ],
            [
              "Partiler, aramalar ve birlikte oynama",
              "Hangi partide olduğun, davetler ve katılma istekleri, üyeleri eklerse partinin Discord bağlantısı, katılma kodları (kimin açtığı, ne için ve ne zaman geçersiz olacağı: başka seçilmezse 24 saat sonra, en fazla 72 saat) ve aramalar: kimin kimi aradığı, aramanın ne zaman başladığı, yanıtlandığı ve bittiği. Aramanın sesi ve birlikte oynamanın görüntüsü içindeki kişiler arasında doğrudan gider (doğrudan bağlantı kurulamazsa bu sunucunun aktarıcısından geçer) ve asla kaydedilmez.",
            ],
            [
              "Oyunlar",
              "AnyPS5 başlatıcılarının bildirdikleri: oyun oturumların (oyun, ne zaman başlayıp bittiği, düzgün kapanıp kapanmadığı), kitaplığın ve oyun süren, kazandığın kupalar ve ne zaman kazandığın, bilgisayarların (rastgele bir kimlik, platform, ad ve model). Online oynadığında, partinle birlikte oynadığında ya da bir arkadaşının oyununa katıldığında: oyun oturumu (oyun ve sürümü, AnyPS5 sürümü, ait olduğu parti, içinde kimlerin olduğu, her oyuncunun oyun sürümü ve uymayan bir sürümle yine de denemeyi seçip seçmediği ve oyunun diğer oyuncularla paylaştıkları). Etkinlik akışın ve liderlik tabloları bunlardan oluşur.",
            ],
            [
              "Bulut kayıtları ve medya",
              "Başlatıcının yüklediği kayıt arşivleri (her yuvanın en yeni üç sürümü) ve paylaştığın fotoğraflar, klipler ve sesli notlar; bu sunucuda hesap başına 100 MB'a kadar. Fotoğraflar üst verisi atılarak yeniden kodlanır; klipler ve sesli notlar gönderildiği gibi tutulur.",
            ],
            [
              "Çekimler",
              "Çekim olarak paylaştığın ekran görüntüleri ve klipler; açıklamaları (ve en son ne zaman düzenlediğin), oyun, nereden paylaştığın ve kimlerin görebileceği (arkadaşların ya da giriş yapan herkes); verdiğin ve aldığın beğeniler, yazdığın yorumlar ve yanıtlar. Fotoğraflar, her fotoğraf gibi, meta verileri olmadan yeniden kodlanır.",
            ],
            [
              "Paylaştıkların",
              "Tema Merkezi'nde paylaştığın temalar, uyumluluk raporları (oyun, platform, sürümler, makinen ve işletim sistemin, kare hızı ve notun) ve oyuncu arama ilanların.",
            ],
            [
              "Topluluklar ve etkinlikler",
              "Kurduğun ya da katıldığın topluluklar ve içlerindeki rolün, davetler, bir topluluğun moderatörlerinin çıkardığı ya da yasakladığı üyeler (verdikleri gerekçeyle), topluluğun sohbeti (diğer mesajlar gibi tutulur), planladığın ya da katılacağını söylediğin etkinlikler.",
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
              "Gönderdiğin ve senin hakkında gönderilen raporlar (raporlanan mesaj ya da raporlanan gizli isim ve resim, moderatörler için olduğu gibi kopyalanır), uyarılar, susturmalar ve yasaklar gerekçeleriyle, itirazlar ve yanıtları, moderatörlerin ve sistemin yaptıklarının kaydı.",
            ],
            [
              "IP adresin",
              "Kötüye kullanım sınırlarına karşı istekleri saymak için kullanılır, örneğin giriş denemeleri. Bu sayaçlar adresle birlikte bellekte tutulur ve sınırlarıyla birlikte, en geç bir gün içinde silinir. Bir arama ya da birlikte oynama bu sunucunun aktarıcısından geçtiğinde aktarıcı IP adresini görür ve bağlantıyı hesabının kimliğiyle birlikte kendi kaydına yazar; bu kayıt 7 gün sonra silinir. Posta sunucusunun bir e-postanın kime gittiğini gösteren kaydı 30 gün sonra silinir. Web erişim kaydı tutulmaz ve AnyTogether'ın kendi kodu IP adreslerini ya da yazdıklarını kayıtlarına yazmaz.",
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
            "Giriş yapmış olsun olmasın herkes: profil kartın (kullanıcı adı, görünen ad, avatar, biyografi, ülke, kapak ve vurgu rengi, gizlemediğin Steam ya da Discord rozetleri), paylaştığın temalar ve oyuncu arama ilanların. Uyumluluk raporları adın olmadan gösterilir. Profil sayfaları arama motorlarından kendilerini listelememelerini ister. Açtığın bir katılma kodu kimdeyse profil kartını, oyunu ve partide kaç kişi olduğunu görür.",
            "[Ayarlar → Gizlilik](/settings#privacy)'te seçtiğine göre arkadaşların, herkes ya da hiç kimse: oyunların ve oyun süren, kupaların (kupa seviyen ve seninle kupa karşılaştırma dahil), arkadaş listen, çevrimiçi durumun ve oynadığın oyun, galerin. Başta bunlar yalnızca arkadaşlarına açıktır ve başkaları seni aramada bulabilir. Vitrinin, liderlik tabloları ve oyuncu önerileri de aynı ayarlara uyar.",
            "Yalnızca sen ve kabul ettiğin arkadaşların: [Ayarlar → Yalnız arkadaşlar](/settings#private)'da belirlediğin gizli ismin ve gizli resmin. Kullanıcı adın herkese açık kimliğindir; bunlar değildir. Aramada asla görünmez (aramada kullanılmaz), herkese açık profilinde ya da bağlantı önizlemelerinde, yalnızca aynı partide, konuşmada, oyunda ya da toplulukta olduğun kişilerde, engellediğin ya da seni engelleyen kişilerde ve moderatörlerin listelerinde gösterilmez. Arkadaşlık bitince gösterilmez olur; eski bir arkadaşın elindeki gizli resim bağlantısı en geç 12 saat içinde çalışmaz olur. Bir arkadaşın bunları bildirebilir: moderatörler o zaman onları bildirildikleri haliyle görür ve temizleyebilir.",
            "Bir konuşmanın üyeleri onun mesajlarını ve tepkilerini, kimin tepki verdiğiyle birlikte görür; birebir konuşmada karşındaki kişi bir mesajın cihazlarından birine ulaştığını görür. Okundu bilgisi açıkken (varsayılan; [Ayarlar → Gizlilik](/settings#privacy)) üyeler nereye kadar okuduğunu da görür; kapatırsan görmezler, sen de onlarınkini görmezsin. Bir partideki ya da aramadaki kişiler orada başka kimlerin olduğunu görür ve partinin Discord bağlantısını yalnızca üyeleri görür. Son oynadıkların listeni yalnızca sen görürsün; listendeki kişiler de seni kendi listelerinde görür.",
            "Herkese açık bir topluluğu, üyelerini (rolleri ve ne zaman katıldıklarıyla) ve etkinliklerine kimlerin geleceğini giriş yapmış herkes görür; yalnızca davetle girilen bir topluluğu yalnızca üyeleri görür.",
            "Bir aramada, birlikte oynamada ya da online bir oyunda diğerlerinin cihazları seninkine bağlanır; bu yüzden her eşler arası bağlantıda olduğu gibi IP adresini öğrenebilirler.",
            "Çekimlerin: Arkadaşlar paylaşımını yalnızca sen ve arkadaşların görür; Herkese açık olanı giriş yapan herkes profilinde, oyunun sayfasında ve seninle oynamış kişilerin Çekimler akışında görür. Giriş yapılmadan açılan profilinde ve bağlantı önizlemelerinde asla yer almazlar. Bir paylaşımı görebilen, yorumlarını ve beğeni sayısını da görür; beğenenler listesi paylaşımın sahibine herkesi, başkalarına yalnızca kendi arkadaşlarını ve arama ayarı herkes olan kişileri gösterir. Engellediğin ya da seni engelleyen hiç kimse paylaşımlarını, beğenilerini ve yorumlarını görmez; sen de onlarınkini görmezsin. Bir çocuğun paylaşımları yalnızca arkadaşlarına açıktır.",
            "Moderatörler kendilerine raporlananları ve ele aldıkları kısıtlama ve itirazları görür; bir topluluğun moderatörleri onun üyelerini görür ve onları topluluktan çıkarabilir ya da yasaklayabilir. Sunucuyu çalıştıran kişi teknik olarak oradaki her şeye, mesajlar dahil, erişebilir: mesajlar uçtan uca şifreli değildir.",
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
            "Discord, Google ya da Apple'dan gelen bir avatar o servisten yüklenir. Bazı oyunların simgeleri ve onlardan yapılan profil kapakları, simgeyi barındıran siteden (yalnızca bu sunucunun izin verdiği sitelerden) yüklenir; o site de IP adresini görür.",
            "Bir profilin bağlantısı paylaşıldığında görünen resmi çizmek için bu sunucu gereken harfleri Google Fonts'tan ister. Bu istekte profilin adı, kullanıcı adı ve biyografisi bulunur (bunlar zaten herkese açıktır), ama kimin baktığına dair hiçbir şey yoktur.",
            "İndirme bağlantıları AnyPS5'in yayımlandığı GitHub'a gider. Bu site sürüm listesini GitHub'dan kendisi okur; yani indirene kadar ziyaretin GitHub'a bir şey söylemez.",
            "Bu sitede analiz, reklam ya da sosyal medya betiği yoktur; tarayıcının yüklediği yazı tipleri de sitenin kendisinden gelir.",
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
        "Tarayıcın ayrıca sesli sohbet seçimini (bas-konuş ya da açık mikrofon) kendi yerel deposunda tutar. Giriş yaptığında site küçük bir service worker ekler: bildirimleri gösterir ve bağlantı yokken çevrimdışı olduğunu söyleyen bir sayfa açar. Yalnızca o sayfayı saklar, asla verilerini değil. Siteyi uygulama olarak yüklemek (Ana Ekrana Ekle) başka bir şey saklamaz.",
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
            "Hesabın ve içindeki her şey: hesabı silene kadar. Silmek profilini hemen gizler ve tüm cihazlardan çıkış yapar; 14 gün sonra her şey kalıcı olarak silinir (bu sürede giriş yapmak silmeyi iptal eder). Mesajların boşaltılır; böylece diğerlerinin konuşmaları sırasını korur. Sahibi olduğun bir topluluk moderatörlerinden ya da üyelerinden birine geçer (kimse kalmadıysa sona erer), adı ve açıklaması kalır; planladığın etkinlikler adın olmadan kalır; herkesin Son oynadıkların listesinden çıkarsın.",
            "Birkaç şey hesaptan sonra da adı olmadan kalır: uyumluluk raporları, bir başlatıcının kataloğa ilk eklediği oyunlar ve hesabın gönderdiği raporlar. Bir mesaj hakkındaki rapor o mesajın kopyasını tutar. Bir e-posta adresine konan yasak, uygulanmaya devam edebilmesi için adresin yalnızca özetini tutar; moderasyon kaydı da hesabın kimliğini tutar.",
            "Giriş kodları: süreleri dolduktan 30 gün sonra silinir. Bildirimler: okunanlar 90 gün, hepsi 180 gün sonra. Son oynadıkların: birlikte son oynadığınızdan 90 gün sonra. Bir cihazdaki giriş 90 gün kullanılmazsa sona erer (kaydı hesabında kalır). Eski bir kullanıcı adı 30 gün senin için ayrılır (eski kullanıcı adlarının listesi hesabında kalır).",
            "Bulut kayıtları: her yuvanın en yeni üç sürümü, sen silene kadar. Kimseye gönderilmemiş, sabitlenmemiş ya da paylaşılmamış fotoğraf ve klipler bir gün sonra silinir; yarım kalan yüklemeler de. Çekimler, beğenileri ve yorumları: sen ya da hesabın silinene kadar; bir paylaşımı silmek beğenilerini ve yorumlarını, başka bir yerde kullanılmıyorsa medyasını da götürür. Bir moderatör raporlanan bir paylaşımı ya da yorumu kaldırabilir.",
            "Oyuncu arama ilanları bir gün içinde panodan kalkar (ilan hesabında kalır); katılma kodları süreleri dolunca çalışmaz; kötüye kullanım sayaçları bir gün içinde silinir. Anlık bildirim adresleri, bildirimleri kapattığında, o tarayıcıda çıkış yaptığında ya da bildirim servisi adresin artık olmadığını söylediğinde silinir.",
            "Daha kısa bir sınırı olmayanlar hesabın silinene kadar kalır: arama kayıtları, partiler ve Discord bağlantıları, oyun oturumları, katılma kodları, topluluk etkinlikleri, davetleri ve yasakları (ya da topluluk silinene kadar). Raporların, kısıtlamaların, itirazların ve moderasyon kaydının belirli bir bitiş süresi yoktur.",
            "Bu sunucunun veritabanı ve dosyaları her gece yedeklenir ve her yedek 14 gün sonra silinir. Sildiğin şeyler ya da silinen bir hesap, o yedek silinene kadar onda kalabilir. Yedekler bir gün dışarıdaki bir depolama sağlayıcısında da tutulursa bu sunucudan çıkmadan önce şifrelenecek, aynı 14 güne uyacak ve sağlayıcının adı burada yazılacak.",
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
            "bu sunucunun hesabın hakkında tuttuklarını (hesabın, profilin, arkadaşların, mesajların, oyunların, toplulukların, yorum ve beğenilerinle çekimlerin, Son oynadıkların ve dahası), kayıtlarına ve medyana bağlantılarla birlikte tek bir dosya olarak indirmek. Birkaç kayıt henüz bu dosyada yok: aramalar, partiler, oyun oturumları, paylaştığın temalar ve uyumluluk raporları; bunları [İletişim](#contact) yoluyla iste;",
            "hesabını silmek;",
            "cihazlarını görüp çıkış yaptırmak, geçiş anahtarlarını kaldırmak, Steam ya da Discord bağlantısını kesmek, çevrimdışı görünmek, Son oynadıkların'ı kapatmak, bildirimleri ve e-postaları kapatmak.",
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
        "Ebeveynler bir çocuğun toplulukları ve etkinliklerini kullanıp kullanamayacağını da seçer (başta kapalıdır). Son oynadıkların herkes gibi çocuklar için de açıktır ve çocuk onu kapatabilir; ebeveynler bu listeyi ve çocuğun topluluklarını görmez.",
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
        "AnyTogether, AnyPS5'in online tarafıdır: hesaplar, arkadaşlar, mesajlar, partiler ve sesli sohbet, birlikte oynama, kupalar ve liderlik tabloları, topluluklar ve etkinlikler, bulut kayıtları, Tema Merkezi ve uyumluluk listesi. anytogether.kodla.agency'yi açık kaynak AnyTogether projesinin geliştiricisi çalıştırır. Ücretsizdir ve reklam göstermez.",
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
        "AnyTogether'ı yasalara aykırı bir şey için kullanmak da bu koşullara aykırıdır. Bir topluluk yönetiyor ya da bir etkinlik planlıyorsan onu da bu kurallar içinde tut.",
      ],
    },
    {
      id: "games",
      title: "Oyunların",
      blocks: [
        "AnyPS5 sahip olduğun oyunları, kendi kopyalarının dökümlerinden çalıştırır. Burada hiçbir yerde oyun dosyası, firmware ya da anahtar sunulmaz; AnyTogether'ı bunları edinmek ya da yaymak için kullanamazsın.",
        "AnyPS5 başlatıcısındaki Online oyun deneyseldir: bir oyunla çalışmayabilir ya da çalışmayı bırakabilir; online bir oyunda diğer oyuncuların bilgisayarları seninkine bağlanır.",
      ],
    },
    {
      id: "content",
      title: "Paylaştıkların",
      blocks: [
        "Yazdıkların ve yüklediklerin senin olarak kalır. Burada durdukları sürece bu sunucunun onları saklamasına, gerektiğinde biçimini değiştirmesine (örneğin fotoğrafları yeniden kodlamak) ve seçtiğin kişilere göstermesine izin verirsin. Tema Merkezi'nde paylaştığın temaları herkes indirip kendi başlatıcısında kullanabilir. Uyumluluk raporları hesabını sildikten sonra da adın olmadan listede kalır.",
        "Yalnızca paylaşma hakkın olanı paylaş ve başkalarının görebildiğini kaydedebileceğini de unutma. Katılma kodunu yalnızca aralarında görmek istediğin kişilere ver: kod kimdeyse, süresi dolana ya da sen yenisini açana kadar profil kartını görür ve katılmak isteyebilir.",
      ],
    },
    {
      id: "moderation",
      title: "Moderasyon ve itiraz",
      blocks: [
        "Herkes bir kişiyi, mesajı, fotoğraf ya da klibi, temayı, ilanı, topluluğu ya da etkinliği raporlayabilir. Moderatörler raporlara bakar; raporu kapatabilir, uyarabilir, içeriği gizleyebilir, bir hesabı susturabilir (giriş yapabilir ama başkalarına yazamaz) ya da bir hesabı veya e-posta adresini bir süreliğine ya da kaldırılana kadar yasaklayabilir. Kısıtlamanın ne olduğu, nedeni ve ne zamana kadar sürdüğü sitede ve uygulamalarda sana söylenir.",
        "Bir kararın yanlış olduğunu düşünüyorsan onu açıklayan sayfadan ([/restricted](/restricted)) itiraz et. Aynı anda bir itiraz açık olabilir ve bir moderatör onu yanıtlar.",
        "Bir topluluğun sahibi ve moderatörleri üyeleri o topluluktan çıkarabilir ya da yasaklayabilir. Bu, onların kendi toplulukları hakkındaki kararıdır, hesabına konan bir kısıtlama değildir; sitenin moderatörleri de bu koşulları çiğneyen bir topluluğu ya da etkinliği kaldırabilir.",
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
