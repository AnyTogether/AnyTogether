import type { Language } from "./i18n";
import type { ShotName } from "./shots";

/** The product pages (/mac, /pc, /phone, /together), English and Turkish. Every line here is
 *  something the product does today; previews and experiments say so. */

export type Tag = "preview" | "experimental";
export interface Item {
  t: string;
  d: string;
  tag?: Tag;
}
export type Frame = "mac" | "pc" | "phone" | "browser" | "tall" | "plain";
export interface ShotRef {
  name: ShotName;
  alt: string;
  frame: Frame;
}
export interface GalleryShot {
  name: ShotName;
  alt: string;
  caption: string;
}
export interface Chapter {
  id: string;
  /** More pictures of the chapter, in a row under it. */
  gallery?: GalleryShot[];
  /** A line under the gallery, such as where the pictures come from. */
  galleryNote?: string;
  nav: string;
  kicker: string;
  title: string;
  lead: string;
  shots: ShotRef[];
  items: Item[];
}
export interface ProductPage {
  meta: { title: string; description: string };
  kicker: string;
  tag?: Tag;
  title: [string, string];
  lead: string;
  hero: ShotRef;
  heroSide?: ShotRef;
  facts: [string, string][];
  chapters: Chapter[];
  install: { title: string; steps: string[]; requirements: [string, string][] };
}

export interface ProductStrings {
  onThisPage: string;
  installTitle: string;
  requirements: string;
  family: string;
  mac: ProductPage;
  pc: ProductPage;
  phone: ProductPage;
  together: ProductPage;
}

const en: ProductStrings = {
  onThisPage: "On this page",
  installTitle: "Install",
  requirements: "Requirements",
  family: "The rest of the family",
  mac: {
    meta: {
      title: "AnyPS5 for Mac · AnyTogether",
      description:
        "AnyPS5-ARM: the PS5-style launcher for Apple silicon Macs. Unlock and play the games you own, with frame generation, trophies, clips, save sync and AnyTogether built in.",
    },
    kicker: "AnyPS5-ARM · Mac",
    title: ["The PS5 home screen,", "on your Mac."],
    lead: "Point AnyPS5.app at the folder with your game dumps and it does the rest: it finds the games, unlocks them for the Mac, starts them, and keeps your controls, saves and trophies per game. No Terminal, no build, no Vulkan SDK.",
    hero: {
      name: "mac-home-trophies",
      alt: "The AnyPS5 home screen with Hollow Knight: Silksong selected: Play, 8 of 34 trophies, status, size, title ID and version",
      frame: "mac",
    },
    facts: [
      ["120 fps", "Silksong on an M3 Pro, playable"],
      ["0 bytes", "extra disk for an unlocked game"],
      ["4", "players: phones and controllers"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Engine",
        kicker: "The engine",
        title: "Not an emulator.",
        lead: "AnyPS5's relinker turns a PS5 game's program into a native Mac executable, linked against system libraries written from scratch. The game's x86-64 code runs under Rosetta 2, and the PS5 graphics driver runs on Vulkan through MoltenVK, on Metal.",
        shots: [
          {
            name: "mac-unlocking",
            alt: "Plants vs. Zombies: Replanted being unlocked, 39 percent, with Cancel",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Relinked, not emulated",
            d: "The relinker writes a Mach-O executable and macOS modules; the result is a normal .app opened from Finder.",
          },
          {
            t: "Rosetta 2 and Metal",
            d: "x86-64 code translated by Rosetta 2, graphics through MoltenVK. The first start of a title takes longest; later ones use the caches.",
          },
          {
            t: "Engine versions",
            d: "Settings holds the engine the app carries, newer ones downloaded from GitHub, or a folder of your own build. Delete the ones you don't need.",
          },
          {
            t: "Games that play today",
            d: "Hollow Knight: Silksong at 120 fps and Dreaming Sarah at 60 fps are playable, DOOM (homebrew) plays, Stray plays its first chapter at a low frame rate for now, Minecraft gets into a world.",
          },
          {
            t: "The compatibility list",
            d: "How far each game gets, per platform, reported by players from the launcher and kept on AnyTogether.",
          },
          {
            t: "Auto-update",
            d: "Settings → About shows Update to … when a new AnyPS5 is out: it downloads, takes its place and opens again.",
          },
        ],
      },
      {
        id: "home",
        nav: "Home",
        kicker: "Home screen",
        title: "Laid out like the console.",
        lead: "Every game sits in a row of tiles. The selected one grows, its artwork drifts behind the screen and its theme song plays, with the facts below: status, size, title ID and version.",
        shots: [{ name: "mac-library", alt: "The game library as a grid of tiles", frame: "mac" }],
        items: [
          {
            t: "Play, Unlock, Retry",
            d: "The button under the title does what the game's state calls for; trophies and ⋯ sit beside it.",
          },
          {
            t: "Library",
            d: "Every game as a grid. Games you add to the folder later show up on their own.",
          },
          {
            t: "Console controls",
            d: "Arrow keys, Return (✕), Esc (○), Q and E for L1 and R1, or a game controller whose PS button brings the launcher in front of the game and back.",
          },
          { t: "Mouse and trackpad", d: "Click a tile, double-click to play, scroll through the row." },
          {
            t: "Three animated themes",
            d: "Cosmic, Aurora and Sunset, an accent colour, or your own picture or looping video behind it all.",
          },
          {
            t: "Türkçe or English",
            d: "The launcher, the phone and the games' language follow your choice.",
          },
        ],
      },
      {
        id: "unlock",
        nav: "Unlocking",
        kicker: "Unlocking",
        title: "From a dump to a Mac app, in minutes.",
        lead: "Unlock turns a PS5 dump into a Mac app with a progress bar like the console's. Several games can be queued.",
        shots: [
          {
            name: "mac-starting",
            alt: "The start screen with the game's icon and a timer while it opens",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Unwrap",
            d: "eboot.bin and every module are opened, SELF containers included. A dump that is still encrypted is reported, not converted.",
          },
          {
            t: "Relink and bundle",
            d: "A Mach-O executable, macOS modules, MoltenVK, per-title patches and a launch script go into the app.",
          },
          {
            t: "APFS clones",
            d: "The game's files become clones of the dump, so an unlocked game takes no extra space.",
          },
          {
            t: "Updates kept fresh",
            d: "When the toolkit is newer, the game shows Update available; Unlock Again brings it up to date and keeps its saves and trophies.",
          },
          {
            t: "A start screen",
            d: "The game's icon and a timer until its first window appears; Esc stops it before it shows.",
          },
          {
            t: "Plain-words errors",
            d: "A missing module, an unsupported system function by name, the GPU stopping, a crash: read from the log and macOS's crash report.",
          },
        ],
      },
      {
        id: "settings",
        nav: "Game settings",
        kicker: "Per game",
        title: "Each game keeps its own settings.",
        lead: "Applied at every start, from the game's ⋯ menu.",
        shots: [
          {
            name: "mac-game-settings",
            alt: "Game settings: display, window size, vertical sync, controls, trophies, advanced, performance overlay",
            frame: "mac",
          },
        ],
        items: [
          { t: "Output resolution", d: "For titles with a resolution patch, such as Stray." },
          { t: "Window or full screen", d: "And the window's size." },
          { t: "Vertical sync", d: "On or off, per game." },
          {
            t: "Frame generation",
            d: "A frame made between each two of the game's, so 60 fps shows 120 on a 120 Hz display. Needs vertical sync; turns itself off on a 60 Hz display or in Low Power Mode.",
            tag: "experimental",
          },
          {
            t: "Performance overlay",
            d: "Minimal, one line with fps, generated frames, frame time, GPU, CPU and memory; or Detailed, with the frame-time graph. In any corner.",
          },
          { t: "Game language", d: "The launcher's, or any of the console's languages." },
          {
            t: "Screenshots and clips",
            d: "The game's F12 shots and clips in a grid, and one at a time over the whole screen.",
          },
          {
            t: "Save backups",
            d: "Back Up Saves and Restore Saves: saves and trophies as a zip; a restore backs up what the game had first.",
          },
          { t: "Shader cache", d: "On or off, and Clear Shader Cache when a game needs a clean start." },
        ],
      },
      {
        id: "controls",
        nav: "Controls",
        kicker: "Controls",
        title: "Keyboard, mouse, pads and phones.",
        lead: "Every game has its own layout. Pick a button and press the key you want; a connected controller keeps its own buttons.",
        shots: [
          { name: "mac-controls", alt: "The controls panel waiting for a key for Square", frame: "mac" },
        ],
        items: [
          {
            t: "What a button does",
            d: "For Unreal Engine games, each button shows what the game itself does with it (Jump, Sprint), read from the game's own input settings.",
          },
          {
            t: "Mouse as the camera",
            d: "Sensitivity, vertical speed, the response curve, minimum tilt, maximum speed, smoothing and how soon the camera stops.",
          },
          { t: "Stick deadzones", d: "One per stick, to stop a drifting controller." },
          {
            t: "Keyboard feel",
            d: "Slow movement, how fast a key tilts a stick, how fast a key presses L2 or R2 for racing games.",
          },
          {
            t: "Four players",
            d: "Up to four phones and the Mac's game controllers are four DualSenses for local co-op.",
          },
          {
            t: "Share a setup",
            d: "Export Settings saves a game's keys and every setting as one file; Import Settings applies one a friend shared.",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Trophies",
        kicker: "Trophies",
        title: "Every trophy, as on the console.",
        lead: "The list, the texts and the icons come from the game's own trophy package, in the game's language when it has one.",
        shots: [
          {
            name: "mac-trophy-banner",
            alt: "A trophy card dropping in over Silksong while it plays",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "A card over the game",
            d: "The trophy's icon, name and grade with a sound, in full screen too, never taking the keyboard or mouse.",
          },
          {
            t: "The full list",
            d: "Percentage weighted by grade, platinum to bronze counts, and the day and time each was earned.",
          },
          {
            t: "Hidden and counted",
            d: "Hidden trophies stay hidden until earned; trophies that count something show how far you are, such as 23/51.",
          },
          { t: "Play time", d: "Each session is kept, and with AnyTogether goes to your profile." },
        ],
      },
      {
        id: "extras",
        nav: "Extras",
        kicker: "The details",
        title: "The things you'd miss.",
        lead: "Small features, each one asked for by someone who plays.",
        shots: [
          {
            name: "mac-hub",
            alt: "Themes in the launcher: your own, the built-in ones and the Theme Hub's",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Clips",
            d: "The last 15 to 120 seconds of the game, picture and sound, saved as an MP4 with Create on a DualSense, ⌥F12 or Create on the phone.",
          },
          {
            t: "Save Sync",
            d: "Saves and trophies stay the same across your Macs through iCloud Drive or any folder you choose; what is replaced is backed up first.",
          },
          {
            t: "Theme Studio",
            d: "Motion, colours, accent, a picture or video, menu music. Save it as one .anyps5theme file, or share it on the Theme Hub.",
          },
          {
            t: "Theme Hub",
            d: "Themes people share, installed with one press. The phone wears the launcher's theme too.",
          },
          { t: "Discord status", d: "The game you play shows on Discord, with or without AnyTogether." },
          {
            t: "Links",
            d: "anyps5://game/<title ID> selects a game and anyps5://play/<title ID> starts it.",
          },
          {
            t: "Crash reports",
            d: "Why a game stopped, in plain words, a report to attach, detailed logging, and a pre-filled GitHub issue.",
          },
          {
            t: "Console fonts",
            d: "A folder of system fonts for games that ask for them, and your own screenshot folder.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, built in",
        title: "Your friends, inside the launcher.",
        lead: "Optional: signed out, the launcher works as before. Signed in, the top bar gets friends, messages and a party, and everything you play counts.",
        shots: [
          {
            name: "mac-shareplay",
            alt: "Share play in the friends panel: Silksong shared, Mira playing as player 2, Sol watching through the relay",
            frame: "mac",
          },
          {
            name: "mac-profile",
            alt: "A friend's profile with games, recent trophies and rarity, and activity",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Sign in",
            d: "A code sent to your email, or one tap on your phone if it is signed in. No password.",
          },
          { t: "Friends", d: "Add by handle, see who is online and what they play." },
          { t: "Messages", d: "Chats and group chats, live, with typing indicators and an unread count." },
          {
            t: "Parties",
            d: "Start one, invite friends or open it to them; the leader hands over the lead or removes someone.",
          },
          {
            t: "Voice",
            d: "Player to player, through a relay when needed. Push-to-talk on ⌥V works over the game.",
          },
          { t: "1:1 calls", d: "An incoming call shows over the game: ⌥A answers, ⌥D declines." },
          {
            t: "Share play",
            d: "Share the game you play, or watch a friend's with your controller as their player.",
          },
          {
            t: "Join a friend's game",
            d: "Friends see “Joinable” and start the same game, checked against your game's version.",
          },
          {
            t: "Profiles, activity, leaderboards",
            d: "Games, hours, trophies with rarity; friends' activity with reactions; points among friends or everyone.",
          },
          {
            t: "Notifications",
            d: "Requests, invites, missed calls and messages that came while you played.",
          },
          {
            t: "Compatibility reports",
            d: "Say how far a game got; the launcher adds its version, the engine, the Mac and macOS.",
          },
          {
            t: "Another server",
            d: "Settings → AnyTogether → Server connects to a self-hosted AnyTogether.",
          },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 for Mac",
      steps: [
        "Paste the Terminal line: it puts AnyPS5.app in Applications and installs Rosetta 2 if it is missing, with no “cannot be opened” warning.",
        "Or download the zip, unzip it and open the app; the first time, System Settings → Privacy & Security → Open Anyway.",
        "Pick a language, a theme and your games folder. Already installed? Settings → About → Update.",
      ],
      requirements: [
        ["Mac", "Apple silicon (M1 or later)"],
        ["macOS", "14 Sonoma or later"],
        ["Also", "Rosetta 2, and decrypted dumps of games you own"],
      ],
    },
  },
  pc: {
    meta: {
      title: "AnyPS5 for Windows and Linux · AnyTogether",
      description:
        "AnyPS5 Desktop: the PS5-style launcher for Windows and Linux, with the engine downloading itself, trophies, save backups and AnyTogether built in. Early preview.",
    },
    kicker: "AnyPS5 Desktop · Windows & Linux",
    tag: "preview",
    title: ["The same launcher,", "on your PC."],
    lead: "AnyPS5 Desktop brings the Mac launcher to Windows and Linux: the PS5-style home, the library, unlocking, controls, trophies, saves and AnyTogether. It downloads the AnyPS5 engine by itself on first start.",
    hero: {
      name: "pc-home-cosmic",
      alt: "AnyPS5 Desktop's home screen with a demo game selected, Play and 2 of 5 trophies",
      frame: "pc",
    },
    facts: [
      ["Setup.exe", "no admin needed"],
      ["AppImage · .deb", "and a .tar.gz"],
      ["1 click", "to download the engine"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Engine",
        kicker: "The engine",
        title: "It downloads itself.",
        lead: "The last step of the first start offers Download the AnyPS5 engine: the launcher takes the right files for your system from AnyPS5's latest release and sets them up.",
        shots: [
          {
            name: "pc-onboarding-toolkit",
            alt: "First start: Download the AnyPS5 engine, or use your own folder",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Checked downloads",
            d: "Each file's size and GitHub's sha256 are checked; a dropped connection resumes where it stopped.",
          },
          {
            t: "Engine versions",
            d: "Settings → AnyPS5 Engine checks for updates, lists GitHub's versions, switches between them or uses your own folder.",
          },
          {
            t: "Kept tidy",
            d: "The engine in use, the two newest and the ones your games were made with stay; the rest go.",
          },
          {
            t: "Update and Play",
            d: "A newer engine offers games the usual update: it downloads the engine, then unlocks the game again.",
          },
        ],
      },
      {
        id: "library",
        nav: "Library",
        kicker: "Library",
        title: "Find, unlock, play.",
        lead: "It finds the decrypted copies of your games in one folder, with their names, icons and backgrounds, unwraps them, relinks them for your system and starts them.",
        shots: [
          {
            name: "pc-library",
            alt: "The library with four demo games, one locked and one damaged",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Names in your language",
            d: "Read from the game's own data, with its icon, background and theme song.",
          },
          {
            t: "Unlock",
            d: "SELF executables unwrapped byte for byte as upstream does, relinked into a native Windows PE or Linux ELF.",
          },
          {
            t: "Light on disk",
            d: "Game files are hard links where the drive allows, so an unlocked game takes little extra space.",
          },
          {
            t: "Saves stay with the game",
            d: "Saves and trophies move into a new install when a game is unlocked again.",
          },
          {
            t: "Three animated themes",
            d: "Cosmic, Aurora and Sunset: the Mac launcher's background shader, ported.",
          },
          { t: "Türkçe or English", d: "Chosen on the first start." },
        ],
      },
      {
        id: "settings",
        nav: "Settings",
        kicker: "Per game",
        title: "Settings and controls.",
        lead: "Each game keeps its own choices, applied at every start.",
        shots: [
          {
            name: "pc-game-settings",
            alt: "Game settings: display, window size, vertical sync, overlay, language, controls, shader cache",
            frame: "pc",
          },
          { name: "pc-controls", alt: "The controls panel, waiting for a key for Circle", frame: "pc" },
        ],
        items: [
          { t: "Resolution", d: "For titles whose patch file names a width and height." },
          { t: "Window or full screen", d: "And the window size." },
          { t: "Vertical sync and shader cache", d: "On or off, per game." },
          { t: "Game language", d: "The launcher's or any of the console's." },
          { t: "Keyboard layout", d: "Pick a button and press a key, per game." },
          {
            t: "Overlay and frame generation",
            d: "Passed to the engine; they take effect with an engine built from AnyPS5-ARM.",
            tag: "experimental",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Trophies",
        kicker: "Trophies and saves",
        title: "Nothing you earn is lost.",
        lead: "Trophies listed as on the console, and the saves of each game backed up when you want.",
        shots: [
          {
            name: "pc-trophies",
            alt: "A demo game's trophy list: 34 percent, platinum to bronze counts",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Trophies",
            d: "From the game's own trophy package: grades, hidden trophies, the date each was earned.",
          },
          { t: "Save backups", d: "A game's saves and trophies as a zip, restored whenever you like." },
          { t: "Play time", d: "Every session kept, and sent to AnyTogether when you are signed in." },
          {
            t: "Offline is fine",
            d: "Sessions and trophies wait on disk and go up later; nothing counts twice.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, built in",
        title: "Friends, messages, parties, voice.",
        lead: "Sign in from Settings → AnyTogether and the top bar gets friends, messages and a party.",
        shots: [
          {
            name: "pc-together-messages",
            alt: "Messages in AnyPS5 Desktop: conversations and a thread with quick replies",
            frame: "pc",
          },
          {
            name: "pc-together-friends",
            alt: "The friends panel: your profile, a friend's game to join, requests",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Sign in",
            d: "An email code, a passkey through the website, or one tap from your paired phone.",
          },
          { t: "Friends", d: "Requests, adding by handle, what each friend plays." },
          {
            t: "Messages",
            d: "Conversations with quick replies a controller can send, typing shown both ways.",
          },
          {
            t: "Parties and voice",
            d: "Start one, invite, walk into a friend's open party. A talk key, or push-to-talk, read over the game.",
          },
          {
            t: "Profiles",
            d: "Games with play time and trophy progress, recent trophies with rarity, as private as their owner keeps them.",
          },
          {
            t: "Join a friend's game",
            d: "Checked that the game, its version and the engine build match the host's.",
          },
          {
            t: "Sealed sign-in",
            d: "Windows keeps the session with DPAPI; Linux in the Secret Service keyring, or a file only you can read.",
          },
          { t: "Another server", d: "Point the launcher at a self-hosted AnyTogether." },
        ],
      },
      {
        id: "phone",
        nav: "Phone",
        kicker: "Phone",
        title: "Pair AnyPS5 Remote.",
        lead: "The phone app finds the launcher on your network and pairs with a four-digit code. In games, the phone as a controller needs an engine built from AnyPS5-ARM; upstream's engine doesn't support it yet.",
        shots: [
          {
            name: "pc-pairing",
            alt: "Connect this phone? The same four-digit code on the PC and the phone",
            frame: "pc",
          },
        ],
        items: [
          { t: "Finds itself", d: "Over Wi-Fi with Bonjour/mDNS; allow the firewall prompt once." },
          { t: "Or a cable", d: "An Android phone over adb." },
          {
            t: "Signs you in",
            d: "A signed-in phone approves the launcher with one tap, and the other way round.",
          },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 Desktop",
      steps: [
        "Windows: run the Setup.exe. It installs for your user with a Start menu shortcut and an uninstaller. If SmartScreen warns: More info → Run anyway. Or unzip the portable .zip.",
        "Linux: chmod +x the AppImage and run it, or sudo apt install ./anyps5-desktop_<version>_amd64.deb, or unpack the .tar.gz.",
        "Open it, press Download the AnyPS5 engine, choose your games folder, and allow the firewall prompt if you want to pair your phone.",
      ],
      requirements: [
        ["Windows", "10 or 11, x64"],
        [
          "Linux",
          "x64, glibc 2.34+ for the launcher (Ubuntu 22.04+); games need glibc 2.38+ (Ubuntu 24.04, Debian 13, Fedora 39 or newer)",
        ],
        ["Also", "A CPU and GPU that AnyPS5 supports, and decrypted copies of games you own"],
      ],
    },
  },
  phone: {
    meta: {
      title: "AnyPS5 Remote: your phone as a DualSense · AnyTogether",
      description:
        "AnyPS5 Remote for iPhone and Android: sticks, touchpad, motion, rumble and the light bar, Remote Play, up to four phones, and AnyTogether on the go.",
    },
    kicker: "AnyPS5 Remote · iPhone & Android",
    title: ["Your phone", "is the DualSense."],
    lead: "AnyPS5 Remote turns a phone on the same Wi-Fi, or on a cable, into a DualSense for the games your Mac runs. It finds the launcher by itself, and with Remote Play the game comes to the phone's screen.",
    hero: {
      name: "phone-pad",
      alt: "The phone pad: sticks, D-pad, face buttons, shoulder buttons, touchpad and PS",
      frame: "phone",
    },
    heroSide: {
      name: "phone-launcher",
      alt: "Launcher mode on the phone: the Mac's games over Silksong's artwork",
      frame: "phone",
    },
    facts: [
      ["4", "phones at once, one per player"],
      ["2", "ways to connect: Wi-Fi or a cable"],
      ["iOS 15+", "and Android"],
    ],
    chapters: [
      {
        id: "pad",
        nav: "The pad",
        kicker: "The pad",
        title: "Every button, all at once.",
        lead: "Both sticks, ✕ ○ □ △, L1 R1, L2 R2, the D-pad, Options and the touchpad, any number of them held at once, with the latency shown. It takes over when a game starts.",
        shots: [
          {
            name: "phone-live-silksong",
            alt: "Silksong played with the phone, the pad in the corner",
            frame: "plain",
          },
        ],
        items: [
          {
            t: "Touchpad",
            d: "Slide to move the touch, tap to click, hold to keep clicking; two fingers are two touches.",
          },
          { t: "L3 and R3", d: "A double tap on a stick holds it in." },
          {
            t: "Motion",
            d: "The accelerometer and gyroscope are the DualSense's motion sensors, turned to match how you hold the phone.",
          },
          {
            t: "Rumble",
            d: "The game's two motors: the large one dull, the small one crisp (Core Haptics on iPhone).",
          },
          {
            t: "Trigger effects",
            d: "While L2 or R2 is held, the phone pulses where the trigger would push back.",
          },
          { t: "Light bar", d: "The pad glows with the game's light bar colour." },
          {
            t: "PS and Create",
            d: "PS brings the launcher in front of the game; Create saves the last seconds as a clip.",
          },
          {
            t: "Your layout, per game",
            d: "Move, size, fade or hide any control, or make it a toggle or turbo button. The Mac keeps it with the game.",
          },
        ],
      },
      {
        id: "play",
        nav: "Remote Play",
        kicker: "Remote Play",
        title: "The game on the phone's screen.",
        lead: "Turn it on in the phone's About sheet and the game plays behind the pad, picture and sound. Off by default: the phone stays the controller alone.",
        shots: [
          {
            name: "phone-live-launcher",
            alt: "The Mac launcher with the phone connected, its screen in the corner",
            frame: "plain",
          },
        ],
        items: [
          { t: "Picture and sound", d: "The Mac needs the screen recording permission once." },
          {
            t: "Launcher mode",
            d: "The Mac's games over the selected one's background. Picking one on the phone picks it on the Mac.",
          },
          {
            t: "Play from the couch",
            d: "Play, Back to Game and Close Game; the arrows, ✕, ○ and ≡ move around the launcher's own screen.",
          },
          {
            t: "What the Mac is doing",
            d: "Unlocking, updating or starting: the step, a bar and the time it has taken.",
          },
          { t: "Trophies", d: "A trophy earned drops in at the top of the phone, and the phone buzzes." },
          { t: "The launcher's theme", d: "And its language, English or Turkish." },
        ],
      },
      {
        id: "connect",
        nav: "Connecting",
        kicker: "Connecting",
        title: "Finds the Mac by itself.",
        lead: "The first time, the Mac asks once and both show the same four-digit code. After that it connects with no question.",
        shots: [
          {
            name: "phone-activity",
            alt: "The phone showing the Mac updating Silksong, 34 percent",
            frame: "phone",
          },
        ],
        items: [
          { t: "Wi-Fi", d: "Found on the same network; the Mac's address can be typed in when needed." },
          {
            t: "A cable, no Wi-Fi",
            d: "An iPhone plugged into the Mac connects through it by itself (usbmuxd); Android with USB debugging and adb.",
          },
          {
            t: "Up to four phones",
            d: "One per player; a phone becomes the next player the first time a button is pressed. New phones pair while others play.",
          },
          { t: "PCs too", d: "AnyPS5 Desktop speaks the same protocol and pairs the phone." },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether on the go",
        title: "Your friends, still on the pad.",
        lead: "From the people button on the home screen. Signed out, the phone is the controller as always.",
        shots: [
          {
            name: "phone-party",
            alt: "A party on the phone: five members, one speaking, one muted, voice on",
            frame: "phone",
          },
          { name: "phone-shareplay", alt: "Watching a friend's share play on the phone", frame: "phone" },
        ],
        items: [
          {
            t: "Sign in",
            d: "An email code, or one tap with the account the Mac uses; a signed-in phone signs the Mac in too.",
          },
          { t: "Friends", d: "Who is online and what they play, requests, adding by handle." },
          { t: "Messages", d: "The same conversations as on the Mac and the website, with unread counts." },
          { t: "Parties and voice", d: "Talk with your party while the phone is still your pad." },
          { t: "1:1 calls", d: "Call a friend from their entry." },
          { t: "Profile", d: "Edit your name, bio and picture; see your games, hours and trophies." },
          {
            t: "Activity and leaderboards",
            d: "Friends' trophies and milestones with reactions; points among friends or everyone.",
          },
          { t: "Notifications", d: "Requests, invites, missed calls." },
          {
            t: "Share play, with the pad",
            d: "Watch a friend's game and play along when they hand you a controller.",
          },
          { t: "Another server", d: "When the Mac uses a self-hosted AnyTogether, the phone offers it." },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 Remote",
      steps: [
        "Android: open AnyPS5-Remote.apk on the phone and allow installing from your browser when asked.",
        "iPhone: install AnyPS5-Remote.ipa with AltStore (or SideStore, or Sideloadly from a computer); it signs the app with your own Apple ID. With a free Apple ID it is refreshed every 7 days, which AltStore does by itself.",
        "Keep the phone on the Mac's Wi-Fi, or plug it in, and accept the code once.",
      ],
      requirements: [
        ["iPhone", "iOS 15 or later"],
        ["Android", "Any recent phone; adb on the Mac for the cable"],
        ["Mac", "AnyPS5.app with phone support; older unlocked games need Update and Play once"],
      ],
    },
  },
  together: {
    meta: {
      title: "AnyTogether: friends, parties, voice and share play for AnyPS5",
      description:
        "AnyTogether is AnyPS5's online home: profiles, trophies with rarity, friends, messages, parties, voice, 1:1 calls, share play, finding players and the Theme Hub. Open source, MIT, self-hostable.",
    },
    kicker: "AnyTogether · online",
    title: ["Play together.", "Anywhere."],
    lead: "The online home of every AnyPS5 launcher, the phone app and this website: one account for your profile, trophies, friends, messages, parties, voice and share play. Open source, and yours to run.",
    hero: {
      name: "web-home",
      alt: "The AnyTogether website: friends' activity feed with trophies and reactions",
      frame: "browser",
    },
    heroSide: { name: "web-phone", alt: "Messages on the AnyTogether website on a phone", frame: "tall" },
    facts: [
      ["4", "clients, one account: Mac, PC, phone, web"],
      ["MIT", "open source, self-hostable"],
      ["0", "passwords"],
    ],
    chapters: [
      {
        id: "account",
        nav: "Account",
        kicker: "Your account",
        title: "No password, no sign‑up form.",
        lead: "The first sign-in makes your account. Everything about it is yours to change, export or delete.",
        shots: [
          {
            name: "web-profile",
            alt: "A profile on the website: games, play time, trophies and points",
            frame: "browser",
          },
        ],
        items: [
          { t: "Email code", d: "Six digits in your inbox, on any client." },
          {
            t: "Passkeys",
            d: "Touch ID, Face ID, Windows Hello or your phone, added on the website; launchers sign in through it too.",
          },
          {
            t: "One tap",
            d: "A signed-in phone signs in a launcher, and a launcher the phone; or type a launcher's code here.",
          },
          {
            t: "Profiles",
            d: "Picture, name, handle, bio and country, with games, hours, trophies and points.",
          },
          {
            t: "Privacy per part",
            d: "Choose who sees your games, trophies, friends and online status: everyone, friends or only you.",
          },
          { t: "Your data", d: "Export everything, or delete the account, from Settings." },
        ],
      },
      {
        id: "friends",
        nav: "Friends",
        kicker: "Friends",
        title: "Friends, messages, parties, calls.",
        lead: "The same on the Mac, the PC, the phone and here, live.",
        shots: [
          {
            name: "web-messages",
            alt: "Messages on the website: a group chat, typing shown",
            frame: "browser",
          },
          { name: "web-party", alt: "A party on the website: members, voice and invites", frame: "browser" },
        ],
        items: [
          {
            t: "Friends and presence",
            d: "Online, away, and what each friend plays; requests, blocking, removing.",
          },
          { t: "Messages", d: "Direct and group chats with typing indicators and unread counts." },
          {
            t: "Parties",
            d: "Up to eight, with a leader who invites, removes and hands over the lead; open them to friends or to everyone.",
          },
          {
            t: "Voice",
            d: "Straight from player to player, through a relay only when the networks need it. Mute, and see who is speaking.",
          },
          { t: "1:1 calls", d: "Ring a friend from any client; missed calls are kept." },
          { t: "Join a friend's game", d: "From the launchers, checked against the game's version." },
        ],
      },
      {
        id: "share",
        nav: "Share play",
        kicker: "Share play",
        title: "Watch, then take a pad.",
        lead: "A friend shares the game they play; you watch here, in your launcher or on your phone, and when they hand you a controller, your gamepad or keyboard plays along.",
        shots: [
          { name: "mac-shareplay", alt: "The host's side of share play in the Mac launcher", frame: "mac" },
        ],
        items: [
          { t: "In the browser", d: "Picture and sound over WebRTC, no install." },
          {
            t: "Player 2 to 4",
            d: "Your gamepad or keyboard drives the player you are handed; nobody takes the host's player 1.",
          },
          { t: "Direct or relay", d: "Latency and quality shown for every viewer." },
          { t: "Host's rules", d: "Who may walk in, how many may watch, and taking anyone out." },
        ],
      },
      {
        id: "find",
        nav: "Find players",
        kicker: "Find players",
        title: "Meet people who play what you play.",
        lead: "For when your friends are asleep.",
        shots: [],
        items: [
          {
            t: "Looking for group",
            d: "Post a game, a time, a language and what for: co-op, online, a party or trophy help. People ask to join, you choose.",
          },
          { t: "Public parties", d: "Open a party to anyone, or drop into one." },
          { t: "Game hubs", d: "Each game's page: who plays it, open parties and live share plays." },
          {
            t: "People",
            d: "Find players by the games and languages they play, if they choose to be found.",
          },
        ],
      },
      {
        id: "progress",
        nav: "Trophies",
        kicker: "Trophies and play time",
        title: "Everything you play, counted.",
        lead: "Each session and trophy goes to your account from the launchers, so friends see it and the boards stay honest.",
        shots: [
          {
            name: "web-leaderboards",
            alt: "Leaderboards on the website: points among friends",
            frame: "browser",
          },
        ],
        items: [
          { t: "Trophies with rarity", d: "Common to ultra rare, from everyone who plays the game." },
          {
            t: "Activity feed",
            d: "Friends' trophies, first plays, milestones and new friends, with reactions.",
          },
          {
            t: "Leaderboards",
            d: "Points, play time and completion, among friends or everyone, per game or overall.",
          },
          {
            t: "Fair play",
            d: "Impossible trophy patterns are held off the boards until a moderator looks.",
          },
        ],
      },
      {
        id: "more",
        nav: "More",
        kicker: "And",
        title: "Themes, compatibility, notifications.",
        lead: "The rest of what lives here.",
        shots: [
          { name: "web-themes", alt: "The Theme Hub on the website", frame: "browser" },
          { name: "web-compat", alt: "The compatibility list on the website", frame: "browser" },
        ],
        items: [
          {
            t: "Theme Hub",
            d: "Themes made in the launcher's Theme Studio, liked, downloaded and installed with one press.",
          },
          {
            t: "Compatibility list",
            d: "How far each game gets on each platform, from players' reports on the newest launcher version.",
          },
          {
            t: "Notifications",
            d: "Requests, invites, messages and missed calls, with web push and a mail digest you control.",
          },
          { t: "Downloads", d: "Every AnyPS5 build from each project's latest release, with checksums." },
          { t: "Moderation", d: "Report a person, a message or a theme; moderators review it." },
          {
            t: "Open source",
            d: "MIT. docker compose up runs the whole server on one machine, HTTPS and an optional TURN relay included.",
          },
        ],
      },
    ],
    install: {
      title: "Run your own AnyTogether",
      steps: [
        "git clone https://github.com/AnyTogether/AnyTogether.git, then cd AnyTogether/deploy and cp .env.example .env.",
        "Set your domain, a database password and a signing key in .env.",
        "docker compose up -d --build. Then point the launchers and the phone at it in Settings → AnyTogether → Server.",
      ],
      requirements: [
        ["Machine", "Linux with a public IPv4 address, 2 GB of memory, 10 GB of disk"],
        ["Software", "Docker Engine 24+ with the Compose plugin"],
        ["Network", "A host name pointing at it; ports 80 and 443"],
      ],
    },
  },
};

const tr: ProductStrings = {
  onThisPage: "Bu sayfada",
  installTitle: "Kurulum",
  requirements: "Gereksinimler",
  family: "Ailenin geri kalanı",
  mac: {
    meta: {
      title: "Mac için AnyPS5 · AnyTogether",
      description:
        "AnyPS5-ARM: Apple silicon Mac'ler için PS5 tarzı launcher. Sahip olduğun oyunları aç ve oyna; kare üretimi, kupalar, klipler, kayıt senkronu ve AnyTogether içinde.",
    },
    kicker: "AnyPS5-ARM · Mac",
    title: ["PS5 ana ekranı,", "Mac'inde."],
    lead: "AnyPS5.app'e oyun dump'larının olduğu klasörü göster, gerisini o halleder: oyunları bulur, Mac için açar, başlatır; kontrollerini, kayıtlarını ve kupalarını oyun oyun tutar. Terminal yok, derleme yok, Vulkan SDK yok.",
    hero: {
      name: "mac-home-trophies",
      alt: "AnyPS5 ana ekranında Hollow Knight: Silksong seçili: Oyna, 34 kupanın 8'i, durum, boyut, oyun kimliği ve sürüm",
      frame: "mac",
    },
    facts: [
      ["120 fps", "M3 Pro'da Silksong, oynanabilir"],
      ["0 bayt", "açılan oyun için ek disk"],
      ["4", "oyuncu: telefonlar ve kollar"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Motor",
        kicker: "Motor",
        title: "Emülatör değil.",
        lead: "AnyPS5'in relinker'ı bir PS5 oyununun programını yerel bir Mac programına çevirir ve sıfırdan yazılmış sistem kütüphanelerine bağlar. Oyunun x86-64 kodu Rosetta 2 altında çalışır, PS5 grafik sürücüsü de Metal üstünde MoltenVK aracılığıyla Vulkan'da.",
        shots: [
          {
            name: "mac-unlocking",
            alt: "Plants vs. Zombies: Replanted açılıyor, yüzde 39, İptal düğmesiyle",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Emüle değil, yeniden bağlanmış",
            d: "Relinker bir Mach-O programı ve macOS modülleri yazar; sonuç Finder'dan açılan normal bir .app'tir.",
          },
          {
            t: "Rosetta 2 ve Metal",
            d: "x86-64 kod Rosetta 2 ile çevrilir, grafikler MoltenVK ile çizilir. Bir oyunun ilk açılışı en uzunudur; sonrakiler önbelleği kullanır.",
          },
          {
            t: "Motor sürümleri",
            d: "Ayarlar'da uygulamanın taşıdığı motor, GitHub'dan indirilen yenileri ya da kendi derlemenin klasörü. Gerekmeyenleri sil.",
          },
          {
            t: "Bugün oynanan oyunlar",
            d: "Hollow Knight: Silksong 120 fps'te, Dreaming Sarah 60 fps'te oynanabilir; DOOM (homebrew) oynanır, Stray ilk bölümünü şimdilik düşük kare hızıyla oynatır, Minecraft bir dünyaya girer.",
          },
          {
            t: "Uyumluluk listesi",
            d: "Her oyunun her platformda ne kadar ilerlediği; oyuncular launcher'dan bildirir, AnyTogether'da tutulur.",
          },
          {
            t: "Otomatik güncelleme",
            d: "Yeni AnyPS5 çıktığında Ayarlar → Hakkında'da … sürümüne güncelle görünür: indirir, yerine geçer ve yeniden açılır.",
          },
        ],
      },
      {
        id: "home",
        nav: "Ana ekran",
        kicker: "Ana ekran",
        title: "Konsol gibi dizilmiş.",
        lead: "Her oyun bir sıra kutucukta durur. Seçilen büyür, görseli ekranın arkasında süzülür, tema müziği çalar; altında bilgiler: durum, boyut, oyun kimliği ve sürüm.",
        shots: [
          { name: "mac-library", alt: "Oyun kütüphanesi kutucuklardan bir ızgara olarak", frame: "mac" },
        ],
        items: [
          {
            t: "Oyna, Aç, Yeniden dene",
            d: "Başlığın altındaki düğme oyunun durumunun gerektirdiğini yapar; kupalar ve ⋯ yanında.",
          },
          {
            t: "Kütüphane",
            d: "Tüm oyunlar ızgara olarak. Klasöre sonradan eklediklerin kendiliğinden görünür.",
          },
          {
            t: "Konsol kontrolleri",
            d: "Ok tuşları, Return (✕), Esc (○), L1 ve R1 için Q ve E; ya da PS tuşu launcher'ı oyunun önüne getiren bir kol.",
          },
          { t: "Fare ve trackpad", d: "Bir kutucuğa tıkla, oynamak için çift tıkla, sırada kaydır." },
          {
            t: "Üç hareketli tema",
            d: "Cosmic, Aurora ve Sunset; bir vurgu rengi ya da arkada kendi resmin veya döngüdeki videon.",
          },
          { t: "Türkçe ya da English", d: "Launcher, telefon ve oyunların dili seçimini izler." },
        ],
      },
      {
        id: "unlock",
        nav: "Açma",
        kicker: "Açma",
        title: "Dump'tan Mac uygulamasına, dakikalar içinde.",
        lead: "Aç, bir PS5 dump'ını konsoldakine benzer bir ilerleme çubuğuyla Mac uygulamasına çevirir. Birkaç oyun sıraya konabilir.",
        shots: [
          { name: "mac-starting", alt: "Oyun açılırken simgesi ve sayaçla başlangıç ekranı", frame: "mac" },
        ],
        items: [
          {
            t: "Paketten çıkarma",
            d: "eboot.bin ve tüm modüller açılır, SELF kapları dahil. Hâlâ şifreli bir dump bildirilir, dönüştürülmez.",
          },
          {
            t: "Bağlama ve paketleme",
            d: "Mach-O programı, macOS modülleri, MoltenVK, oyuna özel yamalar ve bir başlatma betiği uygulamaya girer.",
          },
          { t: "APFS klonları", d: "Oyunun dosyaları dump'ın klonu olur; açılan oyun ek yer kaplamaz." },
          {
            t: "Hep güncel",
            d: "Araç takımı daha yeniyse oyun Güncelleme var der; Yeniden Aç, kayıtları ve kupaları koruyarak günceller.",
          },
          {
            t: "Başlangıç ekranı",
            d: "Oyunun ilk penceresi gelene kadar simgesi ve bir sayaç; Esc görünmeden durdurur.",
          },
          {
            t: "Anlaşılır hatalar",
            d: "Eksik modül, adıyla desteklenmeyen sistem işlevi, GPU'nun durması, çökme: günlükten ve macOS'un çökme raporundan okunur.",
          },
        ],
      },
      {
        id: "settings",
        nav: "Oyun ayarları",
        kicker: "Oyuna özel",
        title: "Her oyunun kendi ayarları.",
        lead: "Oyunun ⋯ menüsünden, her açılışta uygulanır.",
        shots: [
          {
            name: "mac-game-settings",
            alt: "Oyun ayarları: ekran, pencere boyutu, dikey senkron, kontroller, kupalar, gelişmiş, performans katmanı",
            frame: "mac",
          },
        ],
        items: [
          { t: "Çıkış çözünürlüğü", d: "Stray gibi çözünürlük yaması olan oyunlarda." },
          { t: "Pencere ya da tam ekran", d: "Ve pencerenin boyutu." },
          { t: "Dikey senkron", d: "Oyun oyun açık ya da kapalı." },
          {
            t: "Kare üretimi",
            d: "Oyunun her iki karesi arasına bir kare; 60 fps, 120 Hz ekranda 120 gösterir. Dikey senkron ister; 60 Hz ekranda ya da Düşük Güç Modu'nda kendini kapatır.",
            tag: "experimental",
          },
          {
            t: "Performans katmanı",
            d: "Minimal: fps, üretilen kareler, kare süresi, GPU, CPU ve bellekle tek satır; ya da kare süresi grafiğiyle Ayrıntılı. Herhangi bir köşede.",
          },
          { t: "Oyun dili", d: "Launcher'ınki ya da konsolun dillerinden biri." },
          {
            t: "Ekran görüntüleri ve klipler",
            d: "Oyunun F12 görüntüleri ve klipleri ızgarada, tek tek de tam ekranda.",
          },
          {
            t: "Kayıt yedekleri",
            d: "Kayıtları Yedekle ve Geri Yükle: kayıtlar ve kupalar zip olarak; geri yükleme önce oyunun elindekini yedekler.",
          },
          {
            t: "Shader önbelleği",
            d: "Açık ya da kapalı; temiz bir başlangıç için Shader Önbelleğini Temizle.",
          },
        ],
      },
      {
        id: "controls",
        nav: "Kontroller",
        kicker: "Kontroller",
        title: "Klavye, fare, kollar ve telefonlar.",
        lead: "Her oyunun kendi düzeni var. Bir tuş seç ve istediğin tuşa bas; bağlı bir kol kendi tuşlarını korur.",
        shots: [{ name: "mac-controls", alt: "Kontroller paneli Kare için bir tuş bekliyor", frame: "mac" }],
        items: [
          {
            t: "Tuş ne yapar",
            d: "Unreal Engine oyunlarında her tuş, oyunun onunla ne yaptığını (Zıpla, Koş) oyunun kendi giriş ayarlarından okuyup gösterir.",
          },
          {
            t: "Kamera olarak fare",
            d: "Hassasiyet, dikey hız, tepki eğrisi, en az eğim, en yüksek hız, yumuşatma ve kameranın ne kadar çabuk durduğu.",
          },
          { t: "Analog ölü bölgesi", d: "Her analog için ayrı; kayan bir kolu durdurur." },
          {
            t: "Klavye hissi",
            d: "Yavaş yürüme, bir tuşun analogu ne hızla eğdiği, yarış oyunları için L2 ve R2'ye ne hızla bastığı.",
          },
          {
            t: "Dört oyuncu",
            d: "Dört telefona kadar ve Mac'in kolları, yerel co-op için dört DualSense olur.",
          },
          {
            t: "Ayarını paylaş",
            d: "Ayarları Dışa Aktar oyunun tuşlarını ve tüm ayarlarını tek dosyaya yazar; İçe Aktar bir arkadaşının paylaştığını uygular.",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Kupalar",
        kicker: "Kupalar",
        title: "Her kupa, konsoldaki gibi.",
        lead: "Liste, metinler ve simgeler oyunun kendi kupa paketinden gelir; varsa oyunun dilinde.",
        shots: [
          { name: "mac-trophy-banner", alt: "Silksong oynarken üstüne düşen bir kupa kartı", frame: "mac" },
        ],
        items: [
          {
            t: "Oyunun üstünde bir kart",
            d: "Kupanın simgesi, adı ve derecesi bir sesle; tam ekranda da, klavyeyi ya da fareyi hiç almadan.",
          },
          {
            t: "Tam liste",
            d: "Dereceye göre ağırlıklı yüzde, platinden bronza sayılar, her birinin kazanıldığı gün ve saat.",
          },
          {
            t: "Gizli ve sayaçlı",
            d: "Gizli kupalar kazanılana kadar gizli kalır; bir şey sayan kupalar ne kadar ilerlediğini gösterir, 23/51 gibi.",
          },
          { t: "Oynama süresi", d: "Her oturum tutulur, AnyTogether ile profiline gider." },
        ],
      },
      {
        id: "extras",
        nav: "Ayrıntılar",
        kicker: "Ayrıntılar",
        title: "Olmasa arayacakların.",
        lead: "Küçük özellikler; her biri oynayan birinin isteği.",
        shots: [
          {
            name: "mac-hub",
            alt: "Launcher'da temalar: seninkiler, yerleşikler ve Tema Merkezi'ndekiler",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Klipler",
            d: "Oyunun son 15 ila 120 saniyesi, görüntü ve sesiyle; DualSense'te Create, ⌥F12 ya da telefonda Create ile MP4 olarak.",
          },
          {
            t: "Kayıt Senkronu",
            d: "Kayıtlar ve kupalar iCloud Drive ya da seçtiğin herhangi bir klasörle Mac'lerinde aynı kalır; değişen önce yedeklenir.",
          },
          {
            t: "Tema Stüdyosu",
            d: "Hareket, renkler, vurgu, resim ya da video, menü müziği. Tek bir .anyps5theme dosyası olarak kaydet ya da Tema Merkezi'nde paylaş.",
          },
          {
            t: "Tema Merkezi",
            d: "İnsanların paylaştığı temalar, tek tuşla kurulur. Telefon da launcher'ın temasını giyer.",
          },
          { t: "Discord durumu", d: "Oynadığın oyun Discord'da görünür, AnyTogether olsa da olmasa da." },
          {
            t: "Bağlantılar",
            d: "anyps5://game/<oyun kimliği> bir oyunu seçer, anyps5://play/<oyun kimliği> başlatır.",
          },
          {
            t: "Çökme raporları",
            d: "Oyunun neden durduğu anlaşılır sözlerle, eklenecek bir rapor, ayrıntılı günlük ve önceden doldurulmuş bir GitHub issue.",
          },
          {
            t: "Konsol yazı tipleri",
            d: "İsteyen oyunlar için bir sistem yazı tipi klasörü, ve kendi ekran görüntüsü klasörün.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, içinde",
        title: "Arkadaşların, launcher'ın içinde.",
        lead: "İsteğe bağlı: çıkış yapmışken launcher eskisi gibi çalışır. Giriş yaptığında üst çubuğa arkadaşlar, mesajlar ve parti gelir; oynadığın her şey sayılır.",
        shots: [
          {
            name: "mac-shareplay",
            alt: "Arkadaşlar panelinde share play: Silksong paylaşılıyor, Mira 2. oyuncu, Sol relay üzerinden izliyor",
            frame: "mac",
          },
          {
            name: "mac-profile",
            alt: "Bir arkadaşın profili: oyunlar, nadirliğiyle son kupalar ve aktivite",
            frame: "mac",
          },
        ],
        items: [
          { t: "Giriş", d: "E-postana gelen bir kod ya da giriş yapmış telefonunda tek dokunuş. Şifre yok." },
          { t: "Arkadaşlar", d: "Kullanıcı adıyla ekle, kim çevrimiçi ve ne oynuyor gör." },
          {
            t: "Mesajlar",
            d: "Canlı birebir ve grup sohbetleri, yazıyor göstergesi ve okunmamış sayısıyla.",
          },
          {
            t: "Partiler",
            d: "Kur, arkadaşlarını davet et ya da onlara aç; lider liderliği devreder ya da birini çıkarır.",
          },
          {
            t: "Ses",
            d: "Oyuncudan oyuncuya, gerektiğinde relay ile. ⌥V ile bas-konuş oyunun üstünde çalışır.",
          },
          { t: "Birebir arama", d: "Gelen arama oyunun üstünde görünür: ⌥A açar, ⌥D reddeder." },
          {
            t: "Share play",
            d: "Oynadığın oyunu paylaş ya da bir arkadaşınınkini izle, kolun onun oyuncusu olsun.",
          },
          {
            t: "Arkadaşının oyununa katıl",
            d: "Arkadaşların “Katılınabilir” görür ve aynı oyunu açar; oyunun sürümü önce kontrol edilir.",
          },
          {
            t: "Profil, aktivite, liderlik",
            d: "Oyunlar, saatler, nadirliğiyle kupalar; tepkilerle arkadaş aktivitesi; arkadaşlar ya da herkes arasında puanlar.",
          },
          { t: "Bildirimler", d: "Oynarken gelen istekler, davetler, cevapsız aramalar ve mesajlar." },
          {
            t: "Uyumluluk raporları",
            d: "Bir oyunun ne kadar ilerlediğini söyle; launcher sürümünü, motoru, Mac'i ve macOS'u ekler.",
          },
          {
            t: "Başka sunucu",
            d: "Ayarlar → AnyTogether → Sunucu, kendi kurduğun bir AnyTogether'a bağlar.",
          },
        ],
      },
    ],
    install: {
      title: "Mac için AnyPS5'i kur",
      steps: [
        "Terminal satırını yapıştır: AnyPS5.app'i Uygulamalar'a koyar, eksikse Rosetta 2'yi kurar; “açılamıyor” uyarısı çıkmaz.",
        "Ya da zip'i indir, aç ve uygulamayı başlat; ilk seferde Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç.",
        "Bir dil, bir tema ve oyun klasörünü seç. Zaten kurulu mu? Ayarlar → Hakkında → Güncelle.",
      ],
      requirements: [
        ["Mac", "Apple silicon (M1 ve sonrası)"],
        ["macOS", "14 Sonoma ve sonrası"],
        ["Ayrıca", "Rosetta 2 ve sahip olduğun oyunların şifresi çözülmüş dump'ları"],
      ],
    },
  },
  pc: {
    meta: {
      title: "Windows ve Linux için AnyPS5 · AnyTogether",
      description:
        "AnyPS5 Desktop: Windows ve Linux için PS5 tarzı launcher; motor kendini indirir, kupalar, kayıt yedekleri ve AnyTogether içinde. Erken sürüm.",
    },
    kicker: "AnyPS5 Desktop · Windows ve Linux",
    tag: "preview",
    title: ["Aynı launcher,", "PC'nde."],
    lead: "AnyPS5 Desktop, Mac launcher'ını Windows ve Linux'a getirir: PS5 tarzı ana ekran, kütüphane, açma, kontroller, kupalar, kayıtlar ve AnyTogether. İlk açılışta AnyPS5 motorunu kendisi indirir.",
    hero: {
      name: "pc-home-cosmic",
      alt: "AnyPS5 Desktop ana ekranı: örnek bir oyun seçili, Oyna ve 5 kupanın 2'si",
      frame: "pc",
    },
    facts: [
      ["Setup.exe", "yönetici gerekmez"],
      ["AppImage · .deb", "ve bir .tar.gz"],
      ["1 tık", "motoru indirmek için"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Motor",
        kicker: "Motor",
        title: "Kendini indirir.",
        lead: "İlk açılışın son adımı AnyPS5 motorunu indir'i sunar: launcher sistemine uygun dosyaları AnyPS5'in son sürümünden alır ve kurar.",
        shots: [
          {
            name: "pc-onboarding-toolkit",
            alt: "İlk açılış: AnyPS5 motorunu indir ya da kendi klasörünü kullan",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Kontrollü indirme",
            d: "Her dosyanın boyutu ve GitHub'ın sha256'sı kontrol edilir; kopan bağlantı kaldığı yerden sürer.",
          },
          {
            t: "Motor sürümleri",
            d: "Ayarlar → AnyPS5 Motoru güncellemeleri denetler, GitHub'daki sürümleri listeler, aralarında geçer ya da kendi klasörünü kullanır.",
          },
          {
            t: "Düzenli",
            d: "Kullanılan motor, en yeni iki sürüm ve oyunlarının yapıldığı sürümler kalır; gerisi silinir.",
          },
          {
            t: "Güncelle ve Oyna",
            d: "Yeni bir motor oyunlara güncelleme önerir: önce motoru indirir, sonra oyunu yeniden açar.",
          },
        ],
      },
      {
        id: "library",
        nav: "Kütüphane",
        kicker: "Kütüphane",
        title: "Bul, aç, oyna.",
        lead: "Oyunlarının şifresi çözülmüş kopyalarını tek klasörde adları, simgeleri ve arka planlarıyla bulur; paketten çıkarır, sistemine göre bağlar ve başlatır.",
        shots: [
          { name: "pc-library", alt: "Dört örnek oyunlu kütüphane, biri kilitli biri hasarlı", frame: "pc" },
        ],
        items: [
          { t: "Kendi dilinde adlar", d: "Oyunun kendi verisinden; simgesi, arka planı ve tema müziğiyle." },
          {
            t: "Açma",
            d: "SELF programları upstream'deki gibi bayt bayt çıkarılır, yerel bir Windows PE ya da Linux ELF'e bağlanır.",
          },
          {
            t: "Diskte hafif",
            d: "Sürücü izin verdiğinde oyun dosyaları sabit bağlantıdır; açılan oyun az yer kaplar.",
          },
          {
            t: "Kayıtlar oyunla kalır",
            d: "Oyun yeniden açıldığında kayıtlar ve kupalar yeni kuruluma taşınır.",
          },
          {
            t: "Üç hareketli tema",
            d: "Cosmic, Aurora ve Sunset: Mac launcher'ının arka plan shader'ı, taşınmış.",
          },
          { t: "Türkçe ya da English", d: "İlk açılışta seçilir." },
        ],
      },
      {
        id: "settings",
        nav: "Ayarlar",
        kicker: "Oyuna özel",
        title: "Ayarlar ve kontroller.",
        lead: "Her oyun kendi seçimlerini tutar, her açılışta uygulanır.",
        shots: [
          {
            name: "pc-game-settings",
            alt: "Oyun ayarları: ekran, pencere boyutu, dikey senkron, katman, dil, kontroller, shader önbelleği",
            frame: "pc",
          },
          { name: "pc-controls", alt: "Kontroller paneli Daire için bir tuş bekliyor", frame: "pc" },
        ],
        items: [
          { t: "Çözünürlük", d: "Yama dosyası genişlik ve yükseklik belirten oyunlarda." },
          { t: "Pencere ya da tam ekran", d: "Ve pencere boyutu." },
          { t: "Dikey senkron ve shader önbelleği", d: "Oyun oyun açık ya da kapalı." },
          { t: "Oyun dili", d: "Launcher'ınki ya da konsolun dillerinden biri." },
          { t: "Klavye düzeni", d: "Bir tuş seç ve bir tuşa bas, oyun oyun." },
          {
            t: "Katman ve kare üretimi",
            d: "Motora iletilir; AnyPS5-ARM'dan derlenmiş bir motorla etkili olur.",
            tag: "experimental",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Kupalar",
        kicker: "Kupalar ve kayıtlar",
        title: "Kazandığın hiçbir şey kaybolmaz.",
        lead: "Kupalar konsoldaki gibi listelenir, her oyunun kayıtları istediğinde yedeklenir.",
        shots: [
          {
            name: "pc-trophies",
            alt: "Örnek bir oyunun kupa listesi: yüzde 34, platinden bronza sayılar",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Kupalar",
            d: "Oyunun kendi kupa paketinden: dereceler, gizli kupalar, her birinin kazanıldığı tarih.",
          },
          {
            t: "Kayıt yedekleri",
            d: "Bir oyunun kayıtları ve kupaları zip olarak, istediğinde geri yüklenir.",
          },
          { t: "Oynama süresi", d: "Her oturum tutulur, giriş yaptıysan AnyTogether'a gönderilir." },
          {
            t: "Çevrimdışı sorun değil",
            d: "Oturumlar ve kupalar diskte bekler, sonra gider; hiçbir şey iki kez sayılmaz.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, içinde",
        title: "Arkadaşlar, mesajlar, parti, ses.",
        lead: "Ayarlar → AnyTogether'dan giriş yap; üst çubuğa arkadaşlar, mesajlar ve parti gelir.",
        shots: [
          {
            name: "pc-together-messages",
            alt: "AnyPS5 Desktop'ta mesajlar: sohbetler ve hızlı yanıtlı bir konuşma",
            frame: "pc",
          },
          {
            name: "pc-together-friends",
            alt: "Arkadaşlar paneli: profilin, katılınacak bir oyun, istekler",
            frame: "pc",
          },
        ],
        items: [
          { t: "Giriş", d: "E-posta kodu, site üzerinden passkey ya da eşleşmiş telefonundan tek dokunuş." },
          { t: "Arkadaşlar", d: "İstekler, kullanıcı adıyla ekleme, her arkadaşın ne oynadığı." },
          {
            t: "Mesajlar",
            d: "Kolla gönderilebilen hızlı yanıtlarla sohbetler, iki yönde yazıyor göstergesi.",
          },
          {
            t: "Parti ve ses",
            d: "Kur, davet et, bir arkadaşının açık partisine gir. Konuşma tuşu ya da bas-konuş, oyunun üstünde de okunur.",
          },
          {
            t: "Profiller",
            d: "Oynama süresi ve kupa ilerlemesiyle oyunlar, nadirliğiyle son kupalar; sahibi ne kadar gizli tutuyorsa o kadar.",
          },
          {
            t: "Arkadaşının oyununa katıl",
            d: "Oyunun, sürümünün ve motor derlemesinin yayıncınınkiyle aynı olduğu kontrol edilir.",
          },
          {
            t: "Mühürlü oturum",
            d: "Windows oturumu DPAPI ile, Linux Secret Service anahtarlığında ya da yalnızca senin okuyabildiğin bir dosyada tutar.",
          },
          { t: "Başka sunucu", d: "Launcher'ı kendi kurduğun bir AnyTogether'a yönlendir." },
        ],
      },
      {
        id: "phone",
        nav: "Telefon",
        kicker: "Telefon",
        title: "AnyPS5 Remote'u eşleştir.",
        lead: "Telefon uygulaması launcher'ı ağında bulur ve dört haneli bir kodla eşleşir. Oyunlarda telefonun kumanda olması AnyPS5-ARM'dan derlenmiş bir motor ister; upstream motoru henüz desteklemiyor.",
        shots: [
          {
            name: "pc-pairing",
            alt: "Bu telefon bağlansın mı? PC'de ve telefonda aynı dört haneli kod",
            frame: "pc",
          },
        ],
        items: [
          { t: "Kendini bulur", d: "Wi-Fi'da Bonjour/mDNS ile; güvenlik duvarı sorusuna bir kez izin ver." },
          { t: "Ya da kablo", d: "Android telefon adb üzerinden." },
          {
            t: "Seni giriş yaptırır",
            d: "Giriş yapmış telefon launcher'ı tek dokunuşla onaylar, tersi de olur.",
          },
        ],
      },
    ],
    install: {
      title: "AnyPS5 Desktop'ı kur",
      steps: [
        "Windows: Setup.exe'yi çalıştır. Kullanıcın için Başlat menüsü kısayolu ve kaldırıcıyla kurulur. SmartScreen uyarırsa: Ek bilgi → Yine de çalıştır. Ya da taşınabilir .zip'i aç.",
        "Linux: AppImage'a chmod +x verip çalıştır, ya da sudo apt install ./anyps5-desktop_<sürüm>_amd64.deb, ya da .tar.gz'yi aç.",
        "Aç, AnyPS5 motorunu indir'e bas, oyun klasörünü seç; telefonunu eşleştireceksen güvenlik duvarı sorusuna izin ver.",
      ],
      requirements: [
        ["Windows", "10 ya da 11, x64"],
        [
          "Linux",
          "x64; launcher için glibc 2.34+ (Ubuntu 22.04+), oyunlar için glibc 2.38+ (Ubuntu 24.04, Debian 13, Fedora 39 ve sonrası)",
        ],
        [
          "Ayrıca",
          "AnyPS5'in desteklediği bir işlemci ve ekran kartı, sahip olduğun oyunların şifresi çözülmüş kopyaları",
        ],
      ],
    },
  },
  phone: {
    meta: {
      title: "AnyPS5 Remote: telefonun DualSense olur · AnyTogether",
      description:
        "iPhone ve Android için AnyPS5 Remote: analoglar, touchpad, hareket, titreşim ve ışık çubuğu, Remote Play, dört telefona kadar, ve yanında AnyTogether.",
    },
    kicker: "AnyPS5 Remote · iPhone ve Android",
    title: ["Telefonun", "DualSense olur."],
    lead: "AnyPS5 Remote, aynı Wi-Fi'daki ya da kabloyla bağlı bir telefonu Mac'inin çalıştırdığı oyunlar için DualSense yapar. Launcher'ı kendisi bulur; Remote Play ile oyun telefonun ekranına gelir.",
    hero: {
      name: "phone-pad",
      alt: "Telefon kumandası: analoglar, yön tuşları, ana tuşlar, omuz tuşları, touchpad ve PS",
      frame: "phone",
    },
    heroSide: {
      name: "phone-launcher",
      alt: "Telefonda launcher modu: Mac'in oyunları Silksong görselinin üstünde",
      frame: "phone",
    },
    facts: [
      ["4", "telefon aynı anda, her oyuncuya bir"],
      ["2", "bağlanma yolu: Wi-Fi ya da kablo"],
      ["iOS 15+", "ve Android"],
    ],
    chapters: [
      {
        id: "pad",
        nav: "Kumanda",
        kicker: "Kumanda",
        title: "Her tuş, hepsi aynı anda.",
        lead: "İki analog, ✕ ○ □ △, L1 R1, L2 R2, yön tuşları, Options ve touchpad; istediğin kadarı aynı anda, gecikmesi görünür. Oyun başlayınca devreye girer.",
        shots: [
          {
            name: "phone-live-silksong",
            alt: "Silksong telefonla oynanıyor, kumanda köşede",
            frame: "plain",
          },
        ],
        items: [
          {
            t: "Touchpad",
            d: "Kaydır dokunuşu taşır, dokun tıklar, basılı tut tıklamayı sürdürür; iki parmak iki dokunuştur.",
          },
          { t: "L3 ve R3", d: "Analoga çift dokunuş onu basılı tutar." },
          {
            t: "Hareket",
            d: "İvmeölçer ve jiroskop DualSense'in hareket sensörleridir; telefonu nasıl tuttuğuna göre döner.",
          },
          { t: "Titreşim", d: "Oyunun iki motoru: büyüğü tok, küçüğü keskin (iPhone'da Core Haptics)." },
          { t: "Tetik efektleri", d: "L2 ya da R2 basılıyken telefon, tetiğin geri iteceği yerde titrer." },
          { t: "Işık çubuğu", d: "Kumanda oyunun ışık çubuğu rengiyle parlar." },
          {
            t: "PS ve Create",
            d: "PS launcher'ı oyunun önüne getirir; Create son saniyeleri klip olarak kaydeder.",
          },
          {
            t: "Oyuna özel düzen",
            d: "Her kontrolü taşı, boyutlandır, soldur, gizle ya da aç-kapa veya turbo tuş yap. Mac onu oyunla tutar.",
          },
        ],
      },
      {
        id: "play",
        nav: "Remote Play",
        kicker: "Remote Play",
        title: "Oyun telefonun ekranında.",
        lead: "Telefonun Hakkında sayfasından aç; oyun, görüntü ve sesiyle kumandanın arkasında oynar. Varsayılan olarak kapalı: telefon yalnızca kumanda kalır.",
        shots: [
          {
            name: "phone-live-launcher",
            alt: "Telefon bağlıyken Mac launcher'ı, telefonun ekranı köşede",
            frame: "plain",
          },
        ],
        items: [
          { t: "Görüntü ve ses", d: "Mac bir kez ekran kaydı izni ister." },
          {
            t: "Launcher modu",
            d: "Mac'in oyunları seçilenin arka planı üstünde. Telefonda birini seçmek Mac'te de seçer.",
          },
          {
            t: "Koltuktan oyna",
            d: "Oyna, Oyuna Dön ve Oyunu Kapat; oklar, ✕, ○ ve ≡ launcher'ın kendi ekranında gezinir.",
          },
          { t: "Mac ne yapıyor", d: "Açma, güncelleme ya da başlatma: adım, bir çubuk ve geçen süre." },
          { t: "Kupalar", d: "Kazanılan kupa telefonun üstüne düşer, telefon titrer." },
          { t: "Launcher'ın teması", d: "Ve dili, İngilizce ya da Türkçe." },
        ],
      },
      {
        id: "connect",
        nav: "Bağlanma",
        kicker: "Bağlanma",
        title: "Mac'i kendisi bulur.",
        lead: "İlk seferde Mac bir kez sorar, ikisi de aynı dört haneli kodu gösterir. Sonra soru sormadan bağlanır.",
        shots: [
          {
            name: "phone-activity",
            alt: "Telefon, Mac'in Silksong'u güncellediğini gösteriyor, yüzde 34",
            frame: "phone",
          },
        ],
        items: [
          { t: "Wi-Fi", d: "Aynı ağda bulunur; gerekirse Mac'in adresi yazılabilir." },
          {
            t: "Kablo, Wi-Fi'sız",
            d: "Mac'e takılan iPhone kendiliğinden kablodan bağlanır (usbmuxd); Android USB hata ayıklama ve adb ile.",
          },
          {
            t: "Dört telefona kadar",
            d: "Her oyuncuya bir; telefon, oyunda ilk tuşa basıldığında sıradaki oyuncu olur. Diğerleri oynarken yenileri eşleşir.",
          },
          { t: "PC'ler de", d: "AnyPS5 Desktop aynı protokolü konuşur ve telefonu eşleştirir." },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "Yanında AnyTogether",
        title: "Arkadaşların, kumanda elindeyken.",
        lead: "Ana ekrandaki kişiler düğmesinden. Çıkış yapmışken telefon her zamanki gibi kumandadır.",
        shots: [
          {
            name: "phone-party",
            alt: "Telefonda parti: beş üye, biri konuşuyor, biri sessizde, ses açık",
            frame: "phone",
          },
          { name: "phone-shareplay", alt: "Telefonda bir arkadaşın share play'ini izlemek", frame: "phone" },
        ],
        items: [
          {
            t: "Giriş",
            d: "E-posta kodu ya da Mac'in kullandığı hesapla tek dokunuş; giriş yapmış telefon Mac'i de giriş yaptırır.",
          },
          { t: "Arkadaşlar", d: "Kim çevrimiçi ve ne oynuyor, istekler, kullanıcı adıyla ekleme." },
          { t: "Mesajlar", d: "Mac'teki ve sitedeki sohbetlerin aynısı, okunmamış sayılarıyla." },
          { t: "Parti ve ses", d: "Telefon hâlâ kumandanken partinle konuş." },
          { t: "Birebir arama", d: "Bir arkadaşını kendi satırından ara." },
          { t: "Profil", d: "Adını, bionu ve resmini düzenle; oyunlarını, saatlerini ve kupalarını gör." },
          {
            t: "Aktivite ve liderlik",
            d: "Tepkilerle arkadaşların kupaları ve dönüm noktaları; arkadaşlar ya da herkes arasında puanlar.",
          },
          { t: "Bildirimler", d: "İstekler, davetler, cevapsız aramalar." },
          { t: "Kumandayla share play", d: "Bir arkadaşının oyununu izle, sana bir kol verdiğinde katıl." },
          { t: "Başka sunucu", d: "Mac kendi kurulmuş bir AnyTogether kullanıyorsa telefon da onu önerir." },
        ],
      },
    ],
    install: {
      title: "AnyPS5 Remote'u kur",
      steps: [
        "Android: AnyPS5-Remote.apk'yı telefonda aç, sorulursa tarayıcından kurmaya izin ver.",
        "iPhone: AnyPS5-Remote.ipa'yı AltStore (ya da SideStore, veya bilgisayardan Sideloadly) ile kur; uygulamayı kendi Apple kimliğinle imzalar. Ücretsiz Apple kimliğiyle 7 günde bir yenilenir, AltStore bunu kendisi yapar.",
        "Telefonu Mac'in Wi-Fi'ında tut ya da kabloyla bağla, kodu bir kez onayla.",
      ],
      requirements: [
        ["iPhone", "iOS 15 ve sonrası"],
        ["Android", "Güncel herhangi bir telefon; kablo için Mac'te adb"],
        ["Mac", "Telefon destekli AnyPS5.app; önceden açılmış oyunlar bir kez Güncelle ve Oyna ister"],
      ],
    },
  },
  together: {
    meta: {
      title: "AnyTogether: AnyPS5 için arkadaşlar, parti, ses ve share play",
      description:
        "AnyTogether, AnyPS5'in online evi: profiller, nadirliğiyle kupalar, arkadaşlar, mesajlar, partiler, ses, birebir arama, share play, oyuncu bulma ve Tema Merkezi. Açık kaynak, MIT, kendi sunucunda çalışır.",
    },
    kicker: "AnyTogether · online",
    title: ["Birlikte oyna.", "Her yerden."],
    lead: "Tüm AnyPS5 launcher'larının, telefon uygulamasının ve bu sitenin online evi: profilin, kupaların, arkadaşların, mesajların, partilerin, sesli sohbet ve share play için tek hesap. Açık kaynak, istersen kendin çalıştır.",
    hero: {
      name: "web-home",
      alt: "AnyTogether sitesi: arkadaşların kupalar ve tepkilerle aktivite akışı",
      frame: "browser",
    },
    heroSide: { name: "web-phone", alt: "Telefonda AnyTogether sitesinde mesajlar", frame: "tall" },
    facts: [
      ["4", "istemci, tek hesap: Mac, PC, telefon, web"],
      ["MIT", "açık kaynak, kendi sunucunda"],
      ["0", "şifre"],
    ],
    chapters: [
      {
        id: "account",
        nav: "Hesap",
        kicker: "Hesabın",
        title: "Şifre yok, kayıt formu yok.",
        lead: "İlk giriş hesabını oluşturur. Hesabınla ilgili her şeyi değiştirebilir, dışa aktarabilir ya da silebilirsin.",
        shots: [
          {
            name: "web-profile",
            alt: "Sitede bir profil: oyunlar, oynama süresi, kupalar ve puanlar",
            frame: "browser",
          },
        ],
        items: [
          { t: "E-posta kodu", d: "Gelen kutuna altı hane, her istemcide." },
          {
            t: "Passkey",
            d: "Touch ID, Face ID, Windows Hello ya da telefonun; sitede eklenir, launcher'lar da onunla giriş yapar.",
          },
          {
            t: "Tek dokunuş",
            d: "Giriş yapmış telefon bir launcher'ı giriş yaptırır, launcher da telefonu; ya da launcher'ın kodunu burada yaz.",
          },
          {
            t: "Profiller",
            d: "Resim, ad, kullanıcı adı, bio ve ülke; oyunlar, saatler, kupalar ve puanlarla.",
          },
          {
            t: "Parça parça gizlilik",
            d: "Oyunlarını, kupalarını, arkadaşlarını ve çevrimiçi durumunu kimin göreceğini seç: herkes, arkadaşlar ya da yalnızca sen.",
          },
          { t: "Verilerin", d: "Ayarlar'dan her şeyi dışa aktar ya da hesabı sil." },
        ],
      },
      {
        id: "friends",
        nav: "Arkadaşlar",
        kicker: "Arkadaşlar",
        title: "Arkadaşlar, mesajlar, parti, arama.",
        lead: "Mac'te, PC'de, telefonda ve burada aynı, canlı.",
        shots: [
          {
            name: "web-messages",
            alt: "Sitede mesajlar: bir grup sohbeti, yazıyor göstergesi",
            frame: "browser",
          },
          { name: "web-party", alt: "Sitede parti: üyeler, ses ve davetler", frame: "browser" },
        ],
        items: [
          {
            t: "Arkadaşlar ve durum",
            d: "Çevrimiçi, uzakta ve her arkadaşın ne oynadığı; istekler, engelleme, çıkarma.",
          },
          { t: "Mesajlar", d: "Yazıyor göstergesi ve okunmamış sayısıyla birebir ve grup sohbetleri." },
          {
            t: "Partiler",
            d: "Sekiz kişiye kadar; davet eden, çıkaran ve liderliği devreden bir lider; arkadaşlara ya da herkese açılabilir.",
          },
          {
            t: "Ses",
            d: "Doğrudan oyuncudan oyuncuya, yalnızca ağlar gerektirdiğinde relay ile. Sessize al, kimin konuştuğunu gör.",
          },
          { t: "Birebir arama", d: "Herhangi bir istemciden bir arkadaşını ara; cevapsız aramalar tutulur." },
          { t: "Arkadaşının oyununa katıl", d: "Launcher'lardan, oyunun sürümü kontrol edilerek." },
        ],
      },
      {
        id: "share",
        nav: "Share play",
        kicker: "Share play",
        title: "İzle, sonra kolu al.",
        lead: "Bir arkadaşın oynadığı oyunu paylaşır; sen burada, launcher'ında ya da telefonunda izlersin, sana bir kol verdiğinde kendi kolun ya da klavyenle katılırsın.",
        shots: [
          { name: "mac-shareplay", alt: "Mac launcher'ında share play'in yayıncı tarafı", frame: "mac" },
        ],
        items: [
          { t: "Tarayıcıda", d: "WebRTC ile görüntü ve ses, kurulum yok." },
          {
            t: "2. ila 4. oyuncu",
            d: "Kolun ya da klavyen sana verilen oyuncuyu oynatır; yayıncının 1. oyuncusunu kimse almaz.",
          },
          { t: "Doğrudan ya da relay", d: "Her izleyicinin gecikmesi ve kalitesi görünür." },
          {
            t: "Yayıncının kuralları",
            d: "Kimin girebileceği, kaç kişinin izleyebileceği ve birini çıkarmak.",
          },
        ],
      },
      {
        id: "find",
        nav: "Oyuncu bul",
        kicker: "Oyuncu bul",
        title: "Senin oynadıklarını oynayanlarla tanış.",
        lead: "Arkadaşların uyurken.",
        shots: [],
        items: [
          {
            t: "Grup arayanlar",
            d: "Bir oyun, saat, dil ve amaç yaz: co-op, online, parti ya da kupa yardımı. İnsanlar katılmak ister, sen seçersin.",
          },
          { t: "Herkese açık partiler", d: "Partini herkese aç ya da birine katıl." },
          {
            t: "Oyun sayfaları",
            d: "Her oyunun sayfası: kimler oynuyor, açık partiler ve canlı share play'ler.",
          },
          { t: "İnsanlar", d: "Bulunmayı seçenleri oynadıkları oyunlara ve dillere göre bul." },
        ],
      },
      {
        id: "progress",
        nav: "Kupalar",
        kicker: "Kupalar ve oynama süresi",
        title: "Oynadığın her şey sayılır.",
        lead: "Her oturum ve kupa launcher'lardan hesabına gelir; arkadaşların görür, tablolar dürüst kalır.",
        shots: [
          {
            name: "web-leaderboards",
            alt: "Sitede liderlik tabloları: arkadaşlar arasında puanlar",
            frame: "browser",
          },
        ],
        items: [
          { t: "Nadirliğiyle kupalar", d: "Yaygından ultra nadire; oyunu oynayan herkesten." },
          {
            t: "Aktivite akışı",
            d: "Arkadaşlarının kupaları, ilk oynayışları, dönüm noktaları ve yeni arkadaşlıkları, tepkilerle.",
          },
          {
            t: "Liderlik tabloları",
            d: "Puan, oynama süresi ve tamamlama; arkadaşlar ya da herkes arasında, oyun oyun ya da genel.",
          },
          {
            t: "Adil oyun",
            d: "İmkânsız kupa desenleri bir moderatör bakana kadar tablolardan uzak tutulur.",
          },
        ],
      },
      {
        id: "more",
        nav: "Dahası",
        kicker: "Ve",
        title: "Temalar, uyumluluk, bildirimler.",
        lead: "Burada yaşayan geri kalan her şey.",
        shots: [
          { name: "web-themes", alt: "Sitede Tema Merkezi", frame: "browser" },
          { name: "web-compat", alt: "Sitede uyumluluk listesi", frame: "browser" },
        ],
        items: [
          {
            t: "Tema Merkezi",
            d: "Launcher'ın Tema Stüdyosu'nda yapılan temalar; beğenilir, indirilir, tek tuşla kurulur.",
          },
          {
            t: "Uyumluluk listesi",
            d: "Her oyunun her platformda ne kadar ilerlediği; en yeni launcher sürümündeki oyuncu raporlarından.",
          },
          {
            t: "Bildirimler",
            d: "İstekler, davetler, mesajlar ve cevapsız aramalar; web push ve senin ayarladığın bir e-posta özeti.",
          },
          {
            t: "İndirmeler",
            d: "Her projenin son sürümünden tüm AnyPS5 derlemeleri, sağlama toplamlarıyla.",
          },
          { t: "Moderasyon", d: "Bir kişiyi, mesajı ya da temayı bildir; moderatörler inceler." },
          {
            t: "Açık kaynak",
            d: "MIT. docker compose up tüm sunucuyu tek makinede çalıştırır; HTTPS ve isteğe bağlı TURN relay dahil.",
          },
        ],
      },
    ],
    install: {
      title: "Kendi AnyTogether'ını kur",
      steps: [
        "git clone https://github.com/AnyTogether/AnyTogether.git, sonra cd AnyTogether/deploy ve cp .env.example .env.",
        ".env'de alan adını, bir veritabanı şifresini ve bir imza anahtarını ayarla.",
        "docker compose up -d --build. Sonra launcher'ları ve telefonu Ayarlar → AnyTogether → Sunucu'dan ona yönlendir.",
      ],
      requirements: [
        ["Makine", "Genel IPv4 adresli Linux, 2 GB bellek, 10 GB disk"],
        ["Yazılım", "Compose eklentili Docker Engine 24+"],
        ["Ağ", "Ona yönlenen bir alan adı; 80 ve 443 portları"],
      ],
    },
  },
};

type Galleries = Record<string, { note?: string; shots: GalleryShot[] }>;

/** The galleries, per page and chapter ("mac.together"). */
const galleriesEn: Galleries = {
  "mac.home": {
    shots: [
      {
        name: "mac-themes",
        alt: "First start: picking one of three animated themes, Cosmic, Aurora or Sunset",
        caption: "First start: a theme",
      },
      {
        name: "mac-settings",
        alt: "Settings: theme, accent colour, background, artwork and animations",
        caption: "Appearance settings",
      },
      {
        name: "mac-phone",
        alt: "The home screen with a phone connected, shown in the top bar",
        caption: "A phone connected",
      },
    ],
  },
  "mac.settings": {
    shots: [{ name: "mac-gallery", alt: "A game's screenshots in a grid", caption: "Screenshots and clips" }],
  },
  "mac.controls": {
    shots: [
      {
        name: "mac-advanced",
        alt: "Advanced settings: stick deadzones, mouse as the camera, keyboard, graphics and sharing",
        caption: "Advanced settings",
      },
    ],
  },
  "mac.trophies": {
    shots: [
      {
        name: "mac-trophies",
        alt: "Silksong's trophy list: 8 percent, grades, dates and progress",
        caption: "The trophy list",
      },
    ],
  },
  "mac.together": {
    note: "The people, messages and numbers in these pictures are made up.",
    shots: [
      {
        name: "mac-friends",
        alt: "The friends panel: profile, activity, leaderboard, requests and friends to call",
        caption: "Friends",
      },
      { name: "mac-messages", alt: "A conversation with a friend, with quick replies", caption: "Messages" },
      {
        name: "mac-party",
        alt: "A party in voice with push-to-talk, one friend speaking",
        caption: "Party and voice",
      },
      {
        name: "mac-activity",
        alt: "Friends' activity with reactions: trophies, first plays and milestones",
        caption: "Activity",
      },
      {
        name: "mac-leaderboard",
        alt: "Silksong's leaderboard by points, your rank 41 of 312",
        caption: "Leaderboard",
      },
      {
        name: "mac-notifications",
        alt: "The notifications list: messages, invites, requests, a missed call",
        caption: "Notifications",
      },
    ],
  },
  "pc.engine": {
    shots: [
      {
        name: "pc-settings-engine",
        alt: "Settings, AnyPS5 Engine: the version in use, updates, other versions and your own folder",
        caption: "Settings → AnyPS5 Engine",
      },
    ],
  },
  "pc.library": {
    shots: [
      {
        name: "pc-onboarding-theme",
        alt: "First start: picking one of three animated themes",
        caption: "First start: a theme",
      },
    ],
  },
  "pc.together": {
    note: "The people and games in these pictures are made up.",
    shots: [
      {
        name: "pc-together-profile",
        alt: "A friend's profile in AnyPS5 Desktop: games, play time, recent trophies with rarity",
        caption: "Profile",
      },
      {
        name: "pc-together-signin",
        alt: "Settings, AnyTogether: sign in on the website, with an email code, or choose another server",
        caption: "Sign in",
      },
    ],
  },
  "phone.together": {
    note: "The people and data in these pictures are made up.",
    shots: [
      {
        name: "phone-friends",
        alt: "Friends on the phone: requests, who plays what, a friend sharing their game",
        caption: "Friends",
      },
      {
        name: "phone-messages",
        alt: "Messages on the phone: conversations and one open, a friend typing",
        caption: "Messages",
      },
      {
        name: "phone-profile",
        alt: "Your profile on the phone: games, hours, trophies and points",
        caption: "Profile",
      },
      { name: "phone-feed", alt: "Friends' activity on the phone, with reactions", caption: "Activity" },
      { name: "phone-notifications", alt: "The notification list on the phone", caption: "Notifications" },
    ],
  },
  "together.share": {
    note: "Real frames from a share play test with Cat Quest III between two test accounts: the host on a Mac, the viewer in a browser.",
    shots: [
      {
        name: "share-world",
        alt: "Cat Quest III streamed to the viewer: both cats in the world, player 2 beside player 1",
        caption: "Two players, one couch, two homes",
      },
      {
        name: "share-coop",
        alt: "Cat Quest III's local co-op screen on the viewer's side: P2 press any button to join",
        caption: "“P2 press any button to join”",
      },
      {
        name: "share-p2",
        alt: "Player 2 moving through the world, driven by the viewer's keyboard",
        caption: "Player 2, from the browser",
      },
      {
        name: "share-host",
        alt: "The host's launcher: sharing Cat Quest III, one viewer playing as player 2, direct, 0 ms, 648p57",
        caption: "The host's side",
      },
      {
        name: "share-invite",
        alt: "The viewer's website: an invite to watch Cat Quest III, with Watch and Decline",
        caption: "The invite",
      },
      {
        name: "share-frame",
        alt: "A clean stream frame: Cat Quest III's title screen with the performance overlay",
        caption: "The stream",
      },
      {
        name: "share-stopped",
        alt: "The viewer's page after the host stopped sharing",
        caption: "When the host stops",
      },
    ],
  },
  "together.more": {
    shots: [
      {
        name: "web-download",
        alt: "The download page: AnyPS5 for Mac with checksum and the Terminal line, the phone controller",
        caption: "Downloads",
      },
    ],
  },
};

const galleriesTr: Galleries = {
  "mac.home": {
    shots: [
      {
        name: "mac-themes",
        alt: "İlk açılış: üç hareketli temadan birini seçmek, Cosmic, Aurora ya da Sunset",
        caption: "İlk açılış: tema",
      },
      {
        name: "mac-settings",
        alt: "Ayarlar: tema, vurgu rengi, arka plan, görsel ve animasyonlar",
        caption: "Görünüm ayarları",
      },
      {
        name: "mac-phone",
        alt: "Bir telefon bağlıyken ana ekran, üst çubukta görünüyor",
        caption: "Telefon bağlı",
      },
    ],
  },
  "mac.settings": {
    shots: [
      {
        name: "mac-gallery",
        alt: "Bir oyunun ekran görüntüleri ızgarada",
        caption: "Ekran görüntüleri ve klipler",
      },
    ],
  },
  "mac.controls": {
    shots: [
      {
        name: "mac-advanced",
        alt: "Gelişmiş ayarlar: analog ölü bölgeleri, kamera olarak fare, klavye, grafik ve paylaşım",
        caption: "Gelişmiş ayarlar",
      },
    ],
  },
  "mac.trophies": {
    shots: [
      {
        name: "mac-trophies",
        alt: "Silksong'un kupa listesi: yüzde 8, dereceler, tarihler ve ilerleme",
        caption: "Kupa listesi",
      },
    ],
  },
  "mac.together": {
    note: "Bu görsellerdeki kişiler, mesajlar ve sayılar hayalidir.",
    shots: [
      {
        name: "mac-friends",
        alt: "Arkadaşlar paneli: profil, aktivite, liderlik tablosu, istekler ve aranacak arkadaşlar",
        caption: "Arkadaşlar",
      },
      { name: "mac-messages", alt: "Bir arkadaşla hızlı yanıtlı bir konuşma", caption: "Mesajlar" },
      { name: "mac-party", alt: "Bas-konuşlu sesli parti, bir arkadaş konuşuyor", caption: "Parti ve ses" },
      {
        name: "mac-activity",
        alt: "Tepkilerle arkadaş aktivitesi: kupalar, ilk oynayışlar ve dönüm noktaları",
        caption: "Aktivite",
      },
      {
        name: "mac-leaderboard",
        alt: "Silksong'un puan liderlik tablosu, sıran 312'de 41",
        caption: "Liderlik tablosu",
      },
      {
        name: "mac-notifications",
        alt: "Bildirim listesi: mesajlar, davetler, istekler, cevapsız arama",
        caption: "Bildirimler",
      },
    ],
  },
  "pc.engine": {
    shots: [
      {
        name: "pc-settings-engine",
        alt: "Ayarlar, AnyPS5 Motoru: kullanılan sürüm, güncellemeler, diğer sürümler ve kendi klasörün",
        caption: "Ayarlar → AnyPS5 Motoru",
      },
    ],
  },
  "pc.library": {
    shots: [
      {
        name: "pc-onboarding-theme",
        alt: "İlk açılış: üç hareketli temadan birini seçmek",
        caption: "İlk açılış: tema",
      },
    ],
  },
  "pc.together": {
    note: "Bu görsellerdeki kişiler ve oyunlar hayalidir.",
    shots: [
      {
        name: "pc-together-profile",
        alt: "AnyPS5 Desktop'ta bir arkadaşın profili: oyunlar, oynama süresi, nadirliğiyle son kupalar",
        caption: "Profil",
      },
      {
        name: "pc-together-signin",
        alt: "Ayarlar, AnyTogether: sitede, e-posta koduyla giriş ya da başka bir sunucu seçmek",
        caption: "Giriş",
      },
    ],
  },
  "phone.together": {
    note: "Bu görsellerdeki kişiler ve veriler hayalidir.",
    shots: [
      {
        name: "phone-friends",
        alt: "Telefonda arkadaşlar: istekler, kim ne oynuyor, oyununu paylaşan bir arkadaş",
        caption: "Arkadaşlar",
      },
      {
        name: "phone-messages",
        alt: "Telefonda mesajlar: sohbetler ve açık bir konuşma, bir arkadaş yazıyor",
        caption: "Mesajlar",
      },
      {
        name: "phone-profile",
        alt: "Telefonda profilin: oyunlar, saatler, kupalar ve puanlar",
        caption: "Profil",
      },
      { name: "phone-feed", alt: "Telefonda tepkilerle arkadaş aktivitesi", caption: "Aktivite" },
      { name: "phone-notifications", alt: "Telefonda bildirim listesi", caption: "Bildirimler" },
    ],
  },
  "together.share": {
    note: "İki test hesabı arasında Cat Quest III ile yapılan bir share play testinden gerçek kareler: yayıncı Mac'te, izleyici tarayıcıda.",
    shots: [
      {
        name: "share-world",
        alt: "İzleyiciye yayınlanan Cat Quest III: iki kedi de dünyada, 2. oyuncu 1. oyuncunun yanında",
        caption: "İki oyuncu, bir koltuk, iki ev",
      },
      {
        name: "share-coop",
        alt: "İzleyici tarafında Cat Quest III'ün yerel co-op ekranı: P2 katılmak için bir tuşa bas",
        caption: "“P2 press any button to join”",
      },
      {
        name: "share-p2",
        alt: "İzleyicinin klavyesiyle dünyada ilerleyen 2. oyuncu",
        caption: "Tarayıcıdan 2. oyuncu",
      },
      {
        name: "share-host",
        alt: "Yayıncının launcher'ı: Cat Quest III paylaşılıyor, bir izleyici 2. oyuncu olarak oynuyor, doğrudan, 0 ms, 648p57",
        caption: "Yayıncı tarafı",
      },
      {
        name: "share-invite",
        alt: "İzleyicinin sitesi: Cat Quest III'ü izleme daveti, İzle ve Reddet ile",
        caption: "Davet",
      },
      {
        name: "share-frame",
        alt: "Temiz bir yayın karesi: performans katmanıyla Cat Quest III başlık ekranı",
        caption: "Yayın",
      },
      {
        name: "share-stopped",
        alt: "Yayıncı paylaşımı durdurduktan sonra izleyicinin sayfası",
        caption: "Yayıncı durdurunca",
      },
    ],
  },
  "together.more": {
    shots: [
      {
        name: "web-download",
        alt: "İndirme sayfası: sağlama toplamı ve Terminal satırıyla Mac için AnyPS5, telefon kumandası",
        caption: "İndirmeler",
      },
    ],
  },
};

function withGalleries(strings: ProductStrings, galleries: Galleries): ProductStrings {
  const page = (key: "mac" | "pc" | "phone" | "together"): ProductPage => ({
    ...strings[key],
    chapters: strings[key].chapters.map((chapter) => {
      const gallery = galleries[`${key}.${chapter.id}`];
      return gallery ? { ...chapter, gallery: gallery.shots, galleryNote: gallery.note } : chapter;
    }),
  });
  return { ...strings, mac: page("mac"), pc: page("pc"), phone: page("phone"), together: page("together") };
}

const enFull = withGalleries(en, galleriesEn);
const trFull = withGalleries(tr, galleriesTr);

export const productStrings = (language: Language): ProductStrings => (language === "tr" ? trFull : enFull);
