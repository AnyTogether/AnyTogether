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
        "AnyPS5-ARM is a PS5-style launcher for the Mac. Unlock and play the games you own, with trophies, clips, save sync and AnyTogether built in.",
    },
    kicker: "AnyPS5-ARM",
    title: ["The PS5 home screen,", "on your Mac."],
    lead: "Point AnyPS5 at your folder of game dumps. It turns each one into a game you play on your Mac, with no Terminal and no build.",
    hero: {
      name: "mac-home-trophies",
      alt: "The AnyPS5 home screen with Hollow Knight: Silksong selected: Play, 8 of 34 trophies, status, size, title ID and version",
      frame: "mac",
    },
    facts: [
      ["120 fps", "Silksong on an M3 Pro"],
      ["0 bytes", "extra disk per unlocked game"],
      ["4", "players with phones and controllers"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Engine",
        kicker: "The engine",
        title: "Not an emulator.",
        lead: "AnyPS5 relinks a PS5 game into a native Mac app. The game's code runs under Rosetta 2 and its graphics on Metal.",
        shots: [
          {
            name: "mac-unlocking",
            alt: "Plants vs. Zombies: Replanted being unlocked, 39 percent, with Cancel",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Relinked into a Mac app",
            d: "The result is a normal .app you open from Finder.",
          },
          {
            t: "Rosetta 2 and Metal",
            d: "The first start of a game takes longest. Later starts use the caches.",
          },
          {
            t: "Engine versions",
            d: "Use the built-in engine, download a newer one or pick your own build.",
          },
          {
            t: "Games that play today",
            d: "Silksong plays at 120 fps and Dreaming Sarah at 60. DOOM, Stray and Minecraft get in-game.",
          },
          {
            t: "The compatibility list",
            d: "Players report how far each game gets, and AnyTogether keeps the list.",
          },
          {
            t: "Auto-update",
            d: "When a new version is out, Settings offers it. It installs and reopens the app.",
          },
        ],
      },
      {
        id: "home",
        nav: "Home",
        kicker: "Home screen",
        title: "Laid out like the console.",
        lead: "Your games sit in a row of tiles. The selected one grows and its theme song plays.",
        shots: [{ name: "mac-library", alt: "The game library as a grid of tiles", frame: "mac" }],
        items: [
          {
            t: "Play, unlock, retry",
            d: "The main button does whatever the game needs next.",
          },
          {
            t: "Library",
            d: "All your games in a grid. New ones in the folder show up on their own.",
          },
          {
            t: "Console controls",
            d: "Arrow keys, Return and Esc work like a pad. A controller's PS button opens the launcher.",
          },
          { t: "Mouse and trackpad", d: "Click a tile, double-click to play and scroll through the row." },
          {
            t: "Three animated themes",
            d: "Cosmic, Aurora and Sunset, or your own picture or video behind it all.",
          },
          {
            t: "Türkçe or English",
            d: "The launcher, the phone and the games follow your choice.",
          },
        ],
      },
      {
        id: "unlock",
        nav: "Unlocking",
        kicker: "Unlocking",
        title: "From a dump to a Mac app in minutes.",
        lead: "Unlock turns a PS5 dump into a Mac app. You can queue several games.",
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
            d: "The game and its modules are opened. A dump that is still encrypted is reported.",
          },
          {
            t: "Relink and bundle",
            d: "The program, its modules and per-game patches go into one Mac app.",
          },
          {
            t: "APFS clones",
            d: "The game's files are clones of the dump, so they take no extra space.",
          },
          {
            t: "Stays up to date",
            d: "When the toolkit is newer, Unlock Again updates the game and keeps its saves and trophies.",
          },
          {
            t: "A start screen",
            d: "The game's icon and a timer show until its window appears.",
          },
          {
            t: "Clear errors",
            d: "A missing module or a crash is explained in plain words.",
          },
        ],
      },
      {
        id: "settings",
        nav: "Game settings",
        kicker: "Per game",
        title: "Each game keeps its own settings.",
        lead: "Open them from the game's ⋯ menu. They apply at every start.",
        shots: [
          {
            name: "mac-game-settings",
            alt: "Game settings: display, window size, vertical sync, controls, trophies, advanced, performance overlay",
            frame: "mac",
          },
        ],
        items: [
          { t: "Output resolution", d: "For games with a resolution patch, such as Stray." },
          { t: "Window or full screen", d: "And the size of the window." },
          { t: "Vertical sync", d: "On or off for each game." },
          {
            t: "Frame generation",
            d: "Adds a frame between each two, so 60 fps shows as 120 on a 120 Hz display.",
            tag: "experimental",
          },
          {
            t: "Performance overlay",
            d: "fps, GPU, CPU and memory in one line, or a detailed view with a graph.",
          },
          { t: "Game language", d: "The launcher's language or any of the console's." },
          {
            t: "Screenshots and clips",
            d: "Your F12 shots and clips in a grid or one at a time.",
          },
          {
            t: "Save backups",
            d: "Saves and trophies go into a zip. A restore backs up the current saves first.",
          },
          { t: "Shader cache", d: "Turn it off, or clear it when a game needs a clean start." },
        ],
      },
      {
        id: "controls",
        nav: "Controls",
        kicker: "Controls",
        title: "Keyboard, mouse, controllers and phones.",
        lead: "Every game has its own layout. Pick a button and press the key you want.",
        shots: [
          { name: "mac-controls", alt: "The controls panel waiting for a key for Square", frame: "mac" },
        ],
        items: [
          {
            t: "What a button does",
            d: "In Unreal Engine games, each button shows its action, such as Jump or Sprint.",
          },
          {
            t: "Mouse as the camera",
            d: "Tune sensitivity, speed, smoothing and the response curve.",
          },
          { t: "Stick deadzones", d: "One for each stick, to stop a drifting controller." },
          {
            t: "Keyboard feel",
            d: "Set how fast a key tilts a stick or presses L2 and R2.",
          },
          {
            t: "Four players",
            d: "Up to four phones and controllers act as DualSenses for local co-op.",
          },
          {
            t: "Share a setup",
            d: "Export a game's keys and settings as one file, or import a friend's.",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Trophies",
        kicker: "Trophies",
        title: "Every trophy, as on the console.",
        lead: "Names, texts and icons come from the game itself, in its language when it has one.",
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
            d: "The icon, name and grade drop in with a sound, without taking your keys.",
          },
          {
            t: "The full list",
            d: "Counts by grade and the date of each trophy. Hidden ones stay hidden until earned.",
          },
          { t: "Play time", d: "Each session is saved, and with AnyTogether it goes to your profile." },
        ],
      },
      {
        id: "extras",
        nav: "Extras",
        kicker: "The details",
        title: "The things you'd miss.",
        lead: "Small features, each one asked for by a player.",
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
            d: "Save the last 15 to 120 seconds as an MP4 with Create or ⌥F12.",
          },
          {
            t: "Save sync",
            d: "Saves and trophies stay the same on all your Macs through iCloud Drive or a folder.",
          },
          {
            t: "Theme Studio",
            d: "Make a theme with motion, colours, a picture and music, then share it.",
          },
          {
            t: "Theme Hub",
            d: "Install themes other people share with one press. The phone follows your theme too.",
          },
          { t: "Discord status", d: "Discord shows the game you play, with or without AnyTogether." },
          {
            t: "Crash reports",
            d: "Why a game stopped, in plain words, with a ready-made GitHub issue.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, built in",
        title: "Your friends, inside the launcher.",
        lead: "Sign in to get friends, messages and parties in the top bar. Without an account, the launcher works as before.",
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
            d: "Use a code from your email or one tap on your phone. No password.",
          },
          { t: "Friends", d: "Add friends by handle and see who is online and what they play." },
          { t: "Messages", d: "Live chats and group chats with typing indicators." },
          {
            t: "Parties and voice",
            d: "Start a party and talk. Push-to-talk on ⌥V works over the game.",
          },
          { t: "1:1 calls", d: "A call shows over the game. ⌥A answers and ⌥D declines." },
          {
            t: "Share play",
            d: "Share your game, or watch a friend's and join in with your controller.",
          },
          {
            t: "Join a friend's game",
            d: "Friends see when you can be joined and start the same game.",
          },
          {
            t: "Profiles and leaderboards",
            d: "Games, hours and trophies, and points among friends or everyone.",
          },
          {
            t: "Notifications",
            d: "Requests, invites and messages that came while you played.",
          },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 for Mac",
      steps: [
        "Paste the Terminal line. It puts AnyPS5 in Applications and adds Rosetta 2 if needed.",
        "Or download the zip and open the app. The first time, allow it under Privacy & Security in System Settings.",
        "Pick a language, a theme and your games folder.",
      ],
      requirements: [
        ["Mac", "Apple silicon (M1 or later)"],
        ["macOS", "14 Sonoma or later"],
        ["Also", "Rosetta 2 and decrypted dumps of games you own"],
      ],
    },
  },
  pc: {
    meta: {
      title: "AnyPS5 for Windows and Linux · AnyTogether",
      description:
        "AnyPS5 Desktop is the PS5-style launcher for Windows and Linux. The engine downloads itself, and trophies, save backups and AnyTogether are built in. Early preview.",
    },
    kicker: "AnyPS5 Desktop",
    tag: "preview",
    title: ["The same launcher,", "on your PC."],
    lead: "The Mac launcher, now on Windows and Linux. It downloads the AnyPS5 engine by itself on first start.",
    hero: {
      name: "pc-home-cosmic",
      alt: "AnyPS5 Desktop's home screen with a demo game selected, Play and 2 of 5 trophies",
      frame: "pc",
    },
    facts: [
      ["Setup.exe", "no admin needed"],
      ["AppImage & .deb", "and a .tar.gz"],
      ["1 click", "to download the engine"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Engine",
        kicker: "The engine",
        title: "It downloads itself.",
        lead: "On first start, the launcher fetches the right engine for your system and sets it up.",
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
            d: "Every file is checked, and a dropped download resumes where it stopped.",
          },
          {
            t: "Engine versions",
            d: "Check for updates, switch versions or use your own folder.",
          },
          {
            t: "Update and play",
            d: "When a newer engine is out, your games offer an update and unlock again.",
          },
        ],
      },
      {
        id: "library",
        nav: "Library",
        kicker: "Library",
        title: "Find, unlock, play.",
        lead: "It finds your games in one folder, unlocks them for your system and starts them.",
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
            d: "Read from the game itself, with its icon, background and theme song.",
          },
          {
            t: "Unlock",
            d: "Each game is relinked into a native Windows or Linux program.",
          },
          {
            t: "Light on disk",
            d: "Hard links keep an unlocked game small where the drive allows.",
          },
          {
            t: "Saves stay with the game",
            d: "Saves and trophies move along when a game is unlocked again.",
          },
          {
            t: "Three animated themes",
            d: "Cosmic, Aurora and Sunset, the same as on the Mac.",
          },
          { t: "Türkçe or English", d: "Chosen on first start." },
        ],
      },
      {
        id: "settings",
        nav: "Settings",
        kicker: "Per game",
        title: "Settings and controls.",
        lead: "Each game keeps its own choices. They apply at every start.",
        shots: [
          {
            name: "pc-game-settings",
            alt: "Game settings: display, window size, vertical sync, overlay, language, controls, shader cache",
            frame: "pc",
          },
          { name: "pc-controls", alt: "The controls panel, waiting for a key for Circle", frame: "pc" },
        ],
        items: [
          { t: "Resolution", d: "For games whose patch sets a width and height." },
          { t: "Window or full screen", d: "And the size of the window." },
          { t: "Vertical sync and shader cache", d: "On or off for each game." },
          { t: "Game language", d: "The launcher's language or any of the console's." },
          { t: "Keyboard layout", d: "Pick a button and press a key, for each game." },
          {
            t: "Overlay and frame generation",
            d: "These work with an engine built from AnyPS5-ARM.",
            tag: "experimental",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Trophies",
        kicker: "Trophies and saves",
        title: "Nothing you earn is lost.",
        lead: "Trophies look as they do on the console. You back up saves whenever you want.",
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
            d: "Grades, hidden trophies and the date each one was earned.",
          },
          { t: "Save backups", d: "A game's saves and trophies as a zip, restored when you like." },
          {
            t: "Play time, even offline",
            d: "Sessions and trophies wait on disk and reach AnyTogether later, counted once.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, built in",
        title: "Friends, messages, parties and voice.",
        lead: "Sign in from the launcher's AnyTogether settings. The top bar gets friends, messages and a party.",
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
            d: "Use an email code, a passkey or one tap from your paired phone.",
          },
          { t: "Friends", d: "Add friends by handle and see what each one plays." },
          {
            t: "Messages",
            d: "Chats with quick replies you can send from a controller.",
          },
          {
            t: "Parties and voice",
            d: "Start or join a party and talk with a key or push-to-talk.",
          },
          {
            t: "Profiles",
            d: "Games, play time and recent trophies, as private as their owner wants.",
          },
          {
            t: "Join a friend's game",
            d: "The game, its version and the engine are checked against the host's.",
          },
        ],
      },
      {
        id: "phone",
        nav: "Phone",
        kicker: "Phone",
        title: "Pair AnyPS5 Remote.",
        lead: "The phone app finds the launcher on your network and pairs with a four-digit code. Using it as a controller in games needs an engine built from AnyPS5-ARM.",
        shots: [
          {
            name: "pc-pairing",
            alt: "Connect this phone? The same four-digit code on the PC and the phone",
            frame: "pc",
          },
        ],
        items: [
          { t: "Over Wi-Fi", d: "The phone finds the launcher on Wi-Fi. Allow the firewall prompt once." },
          { t: "Or a cable", d: "An Android phone can connect over adb." },
          {
            t: "Signs you in",
            d: "A signed-in phone signs in the launcher with one tap, and the other way round.",
          },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 Desktop",
      steps: [
        "Windows: run Setup.exe. If SmartScreen warns, choose More info and then Run anyway. A portable zip is there too.",
        "Linux: make the AppImage executable and run it, install the .deb or unpack the .tar.gz.",
        "Open it, download the engine and choose your games folder.",
      ],
      requirements: [
        ["Windows", "10 or 11, x64"],
        ["Linux", "x64, and for games Ubuntu 24.04, Debian 13, Fedora 39 or newer"],
        ["Also", "A supported CPU and GPU, and decrypted copies of games you own"],
      ],
    },
  },
  phone: {
    meta: {
      title: "AnyPS5 Remote: your phone as a DualSense · AnyTogether",
      description:
        "AnyPS5 Remote for Android and iPhone turns your phone into a DualSense, with motion, rumble, Remote Play and AnyTogether.",
    },
    kicker: "AnyPS5 Remote",
    title: ["Your phone", "is the DualSense."],
    lead: "AnyPS5 Remote turns your phone into a DualSense for the games your Mac runs. With Remote Play, the game shows on the phone too.",
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
      ["Android & iOS", "the same app on both"],
    ],
    chapters: [
      {
        id: "pad",
        nav: "The pad",
        kicker: "The pad",
        title: "Every button, all at once.",
        lead: "Every DualSense button is there, and you can hold as many as you like. The pad takes over when a game starts.",
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
            d: "Slide to move and tap to click. Two fingers are two touches.",
          },
          { t: "L3 and R3", d: "Double-tap a stick to hold it in." },
          {
            t: "Motion",
            d: "The phone's gyroscope and accelerometer act as the DualSense's motion sensors.",
          },
          {
            t: "Rumble",
            d: "The game's two motors, one deep and one crisp.",
          },
          {
            t: "Trigger effects",
            d: "The phone pulses where the trigger would push back.",
          },
          { t: "Light bar", d: "The pad glows in the game's light bar colour." },
          {
            t: "PS and Create",
            d: "PS opens the launcher. Create saves the last seconds as a clip.",
          },
          {
            t: "Your layout for each game",
            d: "Move, resize or hide any control, or make it a toggle or turbo button.",
          },
          { t: "Latency shown", d: "The pad shows its current latency." },
        ],
      },
      {
        id: "play",
        nav: "Remote Play",
        kicker: "Remote Play",
        title: "The game on the phone's screen.",
        lead: "Turn on Remote Play and the game plays behind the pad, with sound. It is off by default.",
        shots: [
          {
            name: "phone-live-launcher",
            alt: "The Mac launcher with the phone connected, its screen in the corner",
            frame: "plain",
          },
        ],
        items: [
          { t: "Picture and sound", d: "The Mac asks for screen recording permission once." },
          {
            t: "Launcher mode",
            d: "Browse the Mac's games on the phone. Picking one picks it on the Mac.",
          },
          {
            t: "Play from the couch",
            d: "Start a game, go back to it or close it from the phone.",
          },
          {
            t: "What the Mac is doing",
            d: "Unlocking, updating or starting, with a progress bar.",
          },
          { t: "Trophies", d: "A new trophy drops in at the top and the phone buzzes." },
          { t: "The launcher's theme", d: "The phone takes the launcher's theme and language." },
        ],
      },
      {
        id: "connect",
        nav: "Connecting",
        kicker: "Connecting",
        title: "Finds the Mac by itself.",
        lead: "The first time, both screens show the same four-digit code. After that it connects on its own.",
        shots: [
          {
            name: "phone-activity",
            alt: "The phone showing the Mac updating Silksong, 34 percent",
            frame: "phone",
          },
        ],
        items: [
          { t: "Wi-Fi", d: "The phone finds the Mac on the same network. You can also type its address." },
          {
            t: "Or a cable",
            d: "Android connects with USB debugging, and an iPhone connects when plugged into the Mac.",
          },
          {
            t: "Up to four phones",
            d: "One per player. A phone becomes the next player on its first button press.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether on the go",
        title: "Your friends, still on the pad.",
        lead: "Open it from the people button on the home screen. Signed out, the phone is just a controller.",
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
            d: "Use an email code or one tap with the Mac's account. The phone can sign in the Mac too.",
          },
          { t: "Friends", d: "See who is online and what they play, and add friends by handle." },
          { t: "Messages", d: "The same chats as on the Mac and the website." },
          { t: "Parties and voice", d: "Talk with your party while the phone is still your controller." },
          { t: "1:1 calls", d: "Call a friend from your friends list." },
          { t: "Profile", d: "Edit your name, bio and picture, and see your games and trophies." },
          {
            t: "Activity and leaderboards",
            d: "Friends' trophies with reactions, and points among friends or everyone.",
          },
          { t: "Notifications", d: "Requests, invites and missed calls." },
          {
            t: "Share play with the pad",
            d: "Watch a friend's game and join in when they hand you a controller.",
          },
        ],
      },
    ],
    install: {
      title: "Install AnyPS5 Remote",
      steps: [
        "Android: open AnyPS5-Remote.apk on the phone and allow installs from your browser.",
        "iPhone: install AnyPS5-Remote.ipa with AltStore, SideStore or Sideloadly. A free Apple ID needs a refresh every 7 days, and AltStore does it for you.",
        "Keep the phone on the Mac's Wi-Fi or plug it in, then accept the code once.",
      ],
      requirements: [
        ["Android", "Any recent phone, and adb on the Mac for a cable"],
        ["iPhone", "iOS 15 or later"],
        ["Mac", "AnyPS5 with phone support, and older unlocked games updated once"],
      ],
    },
  },
  together: {
    meta: {
      title: "AnyTogether: friends, parties, voice and share play for AnyPS5",
      description:
        "AnyTogether is the online home of AnyPS5. Profiles, trophies, friends, parties, voice and share play in one account. Open source and self-hostable.",
    },
    kicker: "AnyTogether",
    title: ["Play together.", "Anywhere."],
    lead: "One account for friends, parties and trophies. It works in every AnyPS5 app and on this website.",
    hero: {
      name: "web-home",
      alt: "The AnyTogether website: friends' activity feed with trophies and reactions",
      frame: "browser",
    },
    heroSide: { name: "web-phone", alt: "Messages on the AnyTogether website on a phone", frame: "tall" },
    facts: [
      ["4", "places, one account: Mac, PC, phone and web"],
      ["MIT", "open source and self-hostable"],
      ["0", "passwords"],
    ],
    chapters: [
      {
        id: "account",
        nav: "Account",
        kicker: "Your account",
        title: "No password, no sign‑up form.",
        lead: "Your first sign-in creates the account. You can change, export or delete it at any time.",
        shots: [
          {
            name: "web-profile",
            alt: "A profile on the website: games, play time, trophies and points",
            frame: "browser",
          },
        ],
        items: [
          { t: "Email code", d: "Six digits in your inbox, in any app." },
          {
            t: "Passkeys",
            d: "Sign in with Touch ID, Face ID, Windows Hello or your phone.",
          },
          {
            t: "One tap",
            d: "A signed-in phone signs in a launcher, and the other way round.",
          },
          {
            t: "Profiles",
            d: "Picture, name, handle and bio, with your games, hours and trophies.",
          },
          {
            t: "Privacy per part",
            d: "Choose who sees your games, trophies, friends and online status.",
          },
          { t: "Your data", d: "Export everything or delete the account from Settings." },
        ],
      },
      {
        id: "friends",
        nav: "Friends",
        kicker: "Friends",
        title: "Friends, messages, parties and calls.",
        lead: "The same live on the Mac, the PC, the phone and here.",
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
            d: "See who is online and what they play. Block or remove anyone.",
          },
          { t: "Messages", d: "Direct and group chats with typing indicators." },
          {
            t: "Parties",
            d: "Up to eight people, open to friends or to everyone.",
          },
          {
            t: "Voice",
            d: "Player to player, through a relay only when needed. See who is speaking.",
          },
          { t: "1:1 calls", d: "Call a friend from any app. Missed calls are kept." },
          {
            t: "Join a friend's game",
            d: "Start the same game from your launcher, checked against its version.",
          },
        ],
      },
      {
        id: "share",
        nav: "Share play",
        kicker: "Share play",
        title: "Watch, then take a pad.",
        lead: "A friend shares their game and you watch. When they hand you a controller, you play along.",
        shots: [
          { name: "mac-shareplay", alt: "The host's side of share play in the Mac launcher", frame: "mac" },
        ],
        items: [
          { t: "In the browser", d: "Watch with picture and sound, with nothing to install." },
          {
            t: "Players 2 to 4",
            d: "Your gamepad or keyboard plays the player you are given. The host stays player 1.",
          },
          { t: "The host's rules", d: "The host decides who joins, how many watch and who leaves." },
        ],
      },
      {
        id: "find",
        nav: "Find players",
        kicker: "Find players",
        title: "Meet people who play what you play.",
        lead: "Find a group for co-op, online play or trophy help.",
        shots: [],
        items: [
          {
            t: "Looking for group",
            d: "Post a game, a time and a language. People ask to join and you choose.",
          },
          { t: "Public parties", d: "Open your party to anyone, or drop into one." },
          { t: "Game hubs", d: "Each game's page shows who plays it, open parties and live share plays." },
        ],
      },
      {
        id: "progress",
        nav: "Trophies",
        kicker: "Trophies and play time",
        title: "Everything you play, counted.",
        lead: "Every session and trophy goes to your account, so your friends can see it.",
        shots: [
          {
            name: "web-leaderboards",
            alt: "Leaderboards on the website: points among friends",
            frame: "browser",
          },
        ],
        items: [
          {
            t: "Trophies with rarity",
            d: "From common to ultra rare, based on everyone who plays the game.",
          },
          {
            t: "Activity feed",
            d: "Friends' trophies, first plays and milestones, with reactions.",
          },
          {
            t: "Fair leaderboards",
            d: "Points and play time among friends or everyone. Impossible trophy patterns wait for a moderator.",
          },
        ],
      },
      {
        id: "more",
        nav: "More",
        kicker: "And",
        title: "Themes, compatibility and notifications.",
        lead: "Everything else on the website.",
        shots: [
          { name: "web-themes", alt: "The Theme Hub on the website", frame: "browser" },
          { name: "web-compat", alt: "The compatibility list on the website", frame: "browser" },
        ],
        items: [
          {
            t: "Theme Hub",
            d: "Themes made in Theme Studio, installed with one press.",
          },
          {
            t: "Compatibility list",
            d: "How far each game gets on each platform, reported by players.",
          },
          {
            t: "Notifications",
            d: "Web push and an email digest you control.",
          },
          { t: "Downloads", d: "Every AnyPS5 build from the latest releases, with checksums." },
          { t: "Moderation", d: "Report a person, a message or a theme, and moderators review it." },
          {
            t: "Open source",
            d: "MIT licensed. The whole server runs on one machine with Docker.",
          },
        ],
      },
    ],
    install: {
      title: "Run your own server",
      steps: [
        "You need a Linux server with 2 GB of memory, Docker and a domain name. Then pick your server in the launchers' AnyTogether settings.",
      ],
      requirements: [],
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
        "AnyPS5-ARM, Mac için PS5 tarzı bir launcher. Sahip olduğun oyunları aç ve oyna. Kupalar, klipler, kayıt senkronu ve AnyTogether içinde.",
    },
    kicker: "AnyPS5-ARM",
    title: ["PS5 ana ekranı,", "Mac'inde."],
    lead: "AnyPS5'e oyun dump'larının klasörünü göster. Her birini Mac'inde oynanan bir oyuna çevirir, Terminal ve derleme gerekmez.",
    hero: {
      name: "mac-home-trophies",
      alt: "AnyPS5 ana ekranında Hollow Knight: Silksong seçili: Oyna, 34 kupanın 8'i, durum, boyut, oyun kimliği ve sürüm",
      frame: "mac",
    },
    facts: [
      ["120 fps", "M3 Pro'da Silksong"],
      ["0 bayt", "açılan oyun başına ek disk"],
      ["4", "oyuncu, telefon ve kontrolcüyle"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Motor",
        kicker: "Motor",
        title: "Emülatör değil.",
        lead: "AnyPS5 bir PS5 oyununu yerel bir Mac uygulamasına yeniden bağlar. Oyunun kodu Rosetta 2 ile, grafikleri Metal üstünde çalışır.",
        shots: [
          {
            name: "mac-unlocking",
            alt: "Plants vs. Zombies: Replanted açılıyor, yüzde 39, İptal düğmesiyle",
            frame: "mac",
          },
        ],
        items: [
          {
            t: "Mac uygulamasına bağlanır",
            d: "Sonuç, Finder'dan açtığın normal bir .app olur.",
          },
          {
            t: "Rosetta 2 ve Metal",
            d: "Bir oyunun ilk açılışı en uzun sürer. Sonrakiler önbelleği kullanır.",
          },
          {
            t: "Motor sürümleri",
            d: "Yerleşik motoru kullan, daha yenisini indir ya da kendi derlemeni seç.",
          },
          {
            t: "Bugün oynanan oyunlar",
            d: "Silksong 120 fps'te, Dreaming Sarah 60 fps'te oynanır. DOOM, Stray ve Minecraft oyuna girer.",
          },
          {
            t: "Uyumluluk listesi",
            d: "Oyuncular her oyunun ne kadar ilerlediğini bildirir, liste AnyTogether'da tutulur.",
          },
          {
            t: "Otomatik güncelleme",
            d: "Yeni sürüm çıkınca Ayarlar'da görünür. Kurulur ve uygulama yeniden açılır.",
          },
        ],
      },
      {
        id: "home",
        nav: "Ana ekran",
        kicker: "Ana ekran",
        title: "Konsol gibi dizilmiş.",
        lead: "Oyunların bir sıra kutucukta durur. Seçilen büyür ve tema müziği çalar.",
        shots: [
          { name: "mac-library", alt: "Oyun kütüphanesi kutucuklardan bir ızgara olarak", frame: "mac" },
        ],
        items: [
          {
            t: "Oyna, aç, yeniden dene",
            d: "Ana düğme, oyunun o an neye ihtiyacı varsa onu yapar.",
          },
          {
            t: "Kütüphane",
            d: "Tüm oyunların bir ızgarada. Klasöre eklediklerin kendiliğinden görünür.",
          },
          {
            t: "Konsol kontrolleri",
            d: "Ok tuşları, Return ve Esc kontrolcü gibi çalışır. Kontrolcünün PS tuşu launcher'ı açar.",
          },
          { t: "Fare ve trackpad", d: "Bir kutucuğa tıkla, oynamak için çift tıkla, sırada kaydır." },
          {
            t: "Üç hareketli tema",
            d: "Cosmic, Aurora ve Sunset ya da arkada kendi resmin veya videon.",
          },
          { t: "Türkçe ya da English", d: "Launcher, telefon ve oyunlar seçimini izler." },
        ],
      },
      {
        id: "unlock",
        nav: "Açma",
        kicker: "Açma",
        title: "Dump'tan Mac uygulamasına, dakikalar içinde.",
        lead: "Aç düğmesi bir PS5 dump'ını Mac uygulamasına çevirir. Birkaç oyunu sıraya koyabilirsin.",
        shots: [
          { name: "mac-starting", alt: "Oyun açılırken simgesi ve sayaçla başlangıç ekranı", frame: "mac" },
        ],
        items: [
          {
            t: "Paketten çıkarma",
            d: "Oyun ve modülleri açılır. Hâlâ şifreli bir dump varsa bildirilir.",
          },
          {
            t: "Bağlama ve paketleme",
            d: "Program, modülleri ve oyuna özel yamalar tek bir Mac uygulamasına girer.",
          },
          { t: "APFS klonları", d: "Oyunun dosyaları dump'ın klonudur, bu yüzden ek yer kaplamaz." },
          {
            t: "Hep güncel",
            d: "Araç takımı yenilenince Yeniden Aç oyunu günceller. Kayıtlar ve kupalar kalır.",
          },
          {
            t: "Başlangıç ekranı",
            d: "Oyunun penceresi gelene kadar simgesi ve bir sayaç görünür.",
          },
          {
            t: "Anlaşılır hatalar",
            d: "Eksik bir modül ya da çökme sade bir dille anlatılır.",
          },
        ],
      },
      {
        id: "settings",
        nav: "Oyun ayarları",
        kicker: "Oyuna özel",
        title: "Her oyunun kendi ayarları.",
        lead: "Oyunun ⋯ menüsünden açılır. Her açılışta uygulanır.",
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
          { t: "Dikey senkron", d: "Her oyun için açık ya da kapalı." },
          {
            t: "Kare üretimi",
            d: "Her iki karenin arasına bir kare ekler. 120 Hz ekranda 60 fps, 120 olarak görünür.",
            tag: "experimental",
          },
          {
            t: "Performans katmanı",
            d: "Tek satırda fps, GPU, CPU ve bellek ya da grafikli ayrıntılı görünüm.",
          },
          { t: "Oyun dili", d: "Launcher'ın dili ya da konsolun dillerinden biri." },
          {
            t: "Ekran görüntüleri ve klipler",
            d: "F12 görüntülerin ve kliplerin ızgarada ya da tek tek.",
          },
          {
            t: "Kayıt yedekleri",
            d: "Kayıtlar ve kupalar zip olur. Geri yükleme önce mevcut kayıtları yedekler.",
          },
          {
            t: "Shader önbelleği",
            d: "Kapat ya da oyun temiz bir başlangıç isterse temizle.",
          },
        ],
      },
      {
        id: "controls",
        nav: "Kontroller",
        kicker: "Kontroller",
        title: "Klavye, fare, kontrolcü ve telefon.",
        lead: "Her oyunun kendi düzeni var. Bir tuş seç ve istediğin tuşa bas.",
        shots: [{ name: "mac-controls", alt: "Kontroller paneli Kare için bir tuş bekliyor", frame: "mac" }],
        items: [
          {
            t: "Tuş ne yapar",
            d: "Unreal Engine oyunlarında her tuş, Zıpla ya da Koş gibi işini gösterir.",
          },
          {
            t: "Kamera olarak fare",
            d: "Hassasiyeti, hızı, yumuşatmayı ve tepki eğrisini ayarla.",
          },
          { t: "Analog ölü bölgesi", d: "Her analog için ayrı. Kayan bir kontrolcüyü durdurur." },
          {
            t: "Klavye hissi",
            d: "Bir tuşun analogu ve L2 ile R2'yi ne hızla bastırdığını ayarla.",
          },
          {
            t: "Dört oyuncu",
            d: "En fazla dört telefon ve kontrolcü, yerel co-op için DualSense olur.",
          },
          {
            t: "Ayarını paylaş",
            d: "Bir oyunun tuşlarını ve ayarlarını tek dosyaya aktar ya da arkadaşınınkini al.",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Kupalar",
        kicker: "Kupalar",
        title: "Her kupa, konsoldaki gibi.",
        lead: "Adlar, metinler ve simgeler oyunun kendisinden gelir, varsa oyunun dilinde.",
        shots: [
          { name: "mac-trophy-banner", alt: "Silksong oynarken üstüne düşen bir kupa kartı", frame: "mac" },
        ],
        items: [
          {
            t: "Oyunun üstünde bir kart",
            d: "Simge, ad ve derece bir sesle düşer, tuşlarını almadan.",
          },
          {
            t: "Tam liste",
            d: "Dereceye göre sayılar ve her kupanın tarihi. Gizli kupalar kazanılana kadar gizli kalır.",
          },
          { t: "Oynama süresi", d: "Her oturum kaydedilir, AnyTogether ile profiline gider." },
        ],
      },
      {
        id: "extras",
        nav: "Ayrıntılar",
        kicker: "Ayrıntılar",
        title: "Olmasa arayacakların.",
        lead: "Küçük özellikler, her biri bir oyuncunun isteği.",
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
            d: "Son 15 ila 120 saniyeyi Create ya da ⌥F12 ile MP4 olarak kaydet.",
          },
          {
            t: "Kayıt senkronu",
            d: "Kayıtlar ve kupalar iCloud Drive ya da bir klasörle tüm Mac'lerinde aynı kalır.",
          },
          {
            t: "Tema Stüdyosu",
            d: "Hareket, renk, resim ve müzikle bir tema yap, sonra paylaş.",
          },
          {
            t: "Tema Merkezi",
            d: "İnsanların paylaştığı temaları tek tuşla kur. Telefon da temanı izler.",
          },
          { t: "Discord durumu", d: "Oynadığın oyun Discord'da görünür, AnyTogether olsa da olmasa da." },
          {
            t: "Çökme raporları",
            d: "Oyunun neden durduğu sade bir dille, hazır bir GitHub issue ile.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, içinde",
        title: "Arkadaşların, launcher'ın içinde.",
        lead: "Giriş yapınca üst çubuğa arkadaşlar, mesajlar ve parti gelir. Hesapsız da launcher eskisi gibi çalışır.",
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
          { t: "Giriş", d: "E-postana gelen bir kod ya da telefonunda tek dokunuş. Şifre yok." },
          { t: "Arkadaşlar", d: "Kullanıcı adıyla ekle, kimin çevrimiçi olduğunu ve ne oynadığını gör." },
          {
            t: "Mesajlar",
            d: "Yazıyor göstergesiyle canlı birebir ve grup sohbetleri.",
          },
          {
            t: "Parti ve ses",
            d: "Bir parti kur ve konuş. ⌥V ile bas-konuş oyunun üstünde çalışır.",
          },
          { t: "Birebir arama", d: "Gelen arama oyunun üstünde görünür. ⌥A açar, ⌥D reddeder." },
          {
            t: "Share play",
            d: "Oyununu paylaş ya da bir arkadaşınınkini izle ve kontrolcünle katıl.",
          },
          {
            t: "Arkadaşının oyununa katıl",
            d: "Arkadaşların katılabileceklerini görür ve aynı oyunu açar.",
          },
          {
            t: "Profil ve liderlik",
            d: "Oyunlar, saatler ve kupalar, arkadaşlar ya da herkes arasında puanlar.",
          },
          { t: "Bildirimler", d: "Oynarken gelen istekler, davetler ve mesajlar." },
        ],
      },
    ],
    install: {
      title: "Mac için AnyPS5'i kur",
      steps: [
        "Terminal satırını yapıştır. AnyPS5'i Uygulamalar'a koyar, gerekirse Rosetta 2'yi kurar.",
        "Ya da zip'i indirip uygulamayı aç. İlk seferde Sistem Ayarları'ndaki Gizlilik ve Güvenlik bölümünden izin ver.",
        "Bir dil, bir tema ve oyun klasörünü seç.",
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
        "AnyPS5 Desktop, Windows ve Linux için PS5 tarzı launcher. Motor kendini indirir, kupalar, kayıt yedekleri ve AnyTogether içinde. Erken sürüm.",
    },
    kicker: "AnyPS5 Desktop",
    tag: "preview",
    title: ["Aynı launcher,", "PC'nde."],
    lead: "Mac launcher'ı artık Windows ve Linux'ta. İlk açılışta AnyPS5 motorunu kendisi indirir.",
    hero: {
      name: "pc-home-cosmic",
      alt: "AnyPS5 Desktop ana ekranı: örnek bir oyun seçili, Oyna ve 5 kupanın 2'si",
      frame: "pc",
    },
    facts: [
      ["Setup.exe", "yönetici gerekmez"],
      ["AppImage & .deb", "ve bir .tar.gz"],
      ["1 tık", "motoru indirmek için"],
    ],
    chapters: [
      {
        id: "engine",
        nav: "Motor",
        kicker: "Motor",
        title: "Kendini indirir.",
        lead: "İlk açılışta launcher sistemine uygun motoru indirir ve kurar.",
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
            d: "Her dosya kontrol edilir, kopan indirme kaldığı yerden sürer.",
          },
          {
            t: "Motor sürümleri",
            d: "Güncellemeleri denetle, sürüm değiştir ya da kendi klasörünü kullan.",
          },
          {
            t: "Güncelle ve oyna",
            d: "Yeni bir motor çıkınca oyunların güncelleme önerir ve yeniden açılır.",
          },
        ],
      },
      {
        id: "library",
        nav: "Kütüphane",
        kicker: "Kütüphane",
        title: "Bul, aç, oyna.",
        lead: "Oyunlarını tek klasörde bulur, sistemine göre açar ve başlatır.",
        shots: [
          { name: "pc-library", alt: "Dört örnek oyunlu kütüphane, biri kilitli biri hasarlı", frame: "pc" },
        ],
        items: [
          {
            t: "Kendi dilinde adlar",
            d: "Oyunun kendisinden okunur, simgesi, arka planı ve tema müziğiyle.",
          },
          {
            t: "Açma",
            d: "Her oyun yerel bir Windows ya da Linux programına bağlanır.",
          },
          {
            t: "Diskte hafif",
            d: "Sürücü izin verirse sabit bağlantılar açılan oyunu küçük tutar.",
          },
          {
            t: "Kayıtlar oyunla kalır",
            d: "Oyun yeniden açıldığında kayıtlar ve kupalar da taşınır.",
          },
          {
            t: "Üç hareketli tema",
            d: "Cosmic, Aurora ve Sunset, Mac'tekinin aynısı.",
          },
          { t: "Türkçe ya da English", d: "İlk açılışta seçilir." },
        ],
      },
      {
        id: "settings",
        nav: "Ayarlar",
        kicker: "Oyuna özel",
        title: "Ayarlar ve kontroller.",
        lead: "Her oyun kendi seçimlerini tutar. Her açılışta uygulanır.",
        shots: [
          {
            name: "pc-game-settings",
            alt: "Oyun ayarları: ekran, pencere boyutu, dikey senkron, katman, dil, kontroller, shader önbelleği",
            frame: "pc",
          },
          { name: "pc-controls", alt: "Kontroller paneli Daire için bir tuş bekliyor", frame: "pc" },
        ],
        items: [
          { t: "Çözünürlük", d: "Yaması genişlik ve yükseklik belirten oyunlarda." },
          { t: "Pencere ya da tam ekran", d: "Ve pencerenin boyutu." },
          { t: "Dikey senkron ve shader önbelleği", d: "Her oyun için açık ya da kapalı." },
          { t: "Oyun dili", d: "Launcher'ın dili ya da konsolun dillerinden biri." },
          { t: "Klavye düzeni", d: "Her oyun için bir tuş seç ve bir tuşa bas." },
          {
            t: "Katman ve kare üretimi",
            d: "AnyPS5-ARM'dan derlenmiş bir motorla çalışır.",
            tag: "experimental",
          },
        ],
      },
      {
        id: "trophies",
        nav: "Kupalar",
        kicker: "Kupalar ve kayıtlar",
        title: "Kazandığın hiçbir şey kaybolmaz.",
        lead: "Kupalar konsoldaki gibi görünür. Kayıtları istediğin zaman yedeklersin.",
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
            d: "Dereceler, gizli kupalar ve her birinin kazanıldığı tarih.",
          },
          {
            t: "Kayıt yedekleri",
            d: "Bir oyunun kayıtları ve kupaları zip olarak, istediğinde geri yüklenir.",
          },
          {
            t: "Çevrimdışı da oynama süresi",
            d: "Oturumlar ve kupalar diskte bekler, sonra AnyTogether'a bir kez sayılarak gider.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "AnyTogether, içinde",
        title: "Arkadaşlar, mesajlar, parti ve ses.",
        lead: "Launcher'ın AnyTogether ayarlarından giriş yap. Üst çubuğa arkadaşlar, mesajlar ve parti gelir.",
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
          { t: "Giriş", d: "E-posta kodu, passkey ya da eşleşmiş telefonundan tek dokunuş." },
          { t: "Arkadaşlar", d: "Kullanıcı adıyla ekle, her arkadaşın ne oynadığını gör." },
          {
            t: "Mesajlar",
            d: "Kontrolcüyle gönderilebilen hızlı yanıtlarla sohbetler.",
          },
          {
            t: "Parti ve ses",
            d: "Bir parti kur ya da katıl, bir tuşla ya da bas-konuşla konuş.",
          },
          {
            t: "Profiller",
            d: "Oyunlar, oynama süresi ve son kupalar, sahibinin istediği kadar gizli.",
          },
          {
            t: "Arkadaşının oyununa katıl",
            d: "Oyun, sürümü ve motor, yayıncınınkiyle karşılaştırılır.",
          },
        ],
      },
      {
        id: "phone",
        nav: "Telefon",
        kicker: "Telefon",
        title: "AnyPS5 Remote'u eşleştir.",
        lead: "Telefon uygulaması launcher'ı ağında bulur ve dört haneli bir kodla eşleşir. Oyunlarda kontrolcü olarak kullanmak için AnyPS5-ARM'dan derlenmiş bir motor gerekir.",
        shots: [
          {
            name: "pc-pairing",
            alt: "Bu telefon bağlansın mı? PC'de ve telefonda aynı dört haneli kod",
            frame: "pc",
          },
        ],
        items: [
          {
            t: "Wi-Fi ile",
            d: "Telefon launcher'ı Wi-Fi'da bulur. Güvenlik duvarı sorusuna bir kez izin ver.",
          },
          { t: "Ya da kablo", d: "Android telefon adb ile bağlanabilir." },
          {
            t: "Seni giriş yaptırır",
            d: "Giriş yapmış telefon launcher'ı tek dokunuşla giriş yaptırır, tersi de olur.",
          },
        ],
      },
    ],
    install: {
      title: "AnyPS5 Desktop'ı kur",
      steps: [
        "Windows: Setup.exe'yi çalıştır. SmartScreen uyarırsa önce Ek bilgi'yi, sonra Yine de çalıştır'ı seç. Taşınabilir bir zip de var.",
        "Linux: AppImage'ı çalıştırılabilir yapıp aç, .deb'i kur ya da .tar.gz'yi aç.",
        "Uygulamayı aç, motoru indir ve oyun klasörünü seç.",
      ],
      requirements: [
        ["Windows", "10 ya da 11, x64"],
        ["Linux", "x64, oyunlar için Ubuntu 24.04, Debian 13, Fedora 39 ya da daha yenisi"],
        [
          "Ayrıca",
          "Desteklenen bir işlemci ve ekran kartı, sahip olduğun oyunların şifresi çözülmüş kopyaları",
        ],
      ],
    },
  },
  phone: {
    meta: {
      title: "AnyPS5 Remote: telefonun DualSense olur · AnyTogether",
      description:
        "Android ve iPhone için AnyPS5 Remote, telefonunu DualSense yapar. Hareket, titreşim, Remote Play ve AnyTogether ile.",
    },
    kicker: "AnyPS5 Remote",
    title: ["Telefonun", "DualSense olur."],
    lead: "AnyPS5 Remote, telefonunu Mac'inin çalıştırdığı oyunlar için DualSense yapar. Remote Play ile oyun telefonda da görünür.",
    hero: {
      name: "phone-pad",
      alt: "Telefon kontrolcüsü: analoglar, yön tuşları, ana tuşlar, omuz tuşları, touchpad ve PS",
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
      ["Android & iOS", "ikisinde de aynı uygulama"],
    ],
    chapters: [
      {
        id: "pad",
        nav: "Kontrolcü",
        kicker: "Kontrolcü",
        title: "Her tuş, hepsi aynı anda.",
        lead: "DualSense'in tüm tuşları burada ve istediğin kadarını aynı anda basılı tutabilirsin. Oyun başlayınca devreye girer.",
        shots: [
          {
            name: "phone-live-silksong",
            alt: "Silksong telefonla oynanıyor, kontrolcü köşede",
            frame: "plain",
          },
        ],
        items: [
          {
            t: "Touchpad",
            d: "Kaydırarak taşı, dokunarak tıkla. İki parmak iki dokunuştur.",
          },
          { t: "L3 ve R3", d: "Bir analoga çift dokun, basılı kalsın." },
          {
            t: "Hareket",
            d: "Telefonun jiroskopu ve ivmeölçeri DualSense'in hareket sensörleri olur.",
          },
          { t: "Titreşim", d: "Oyunun iki motoru, biri tok, biri keskin." },
          { t: "Tetik efektleri", d: "Telefon, tetiğin geri iteceği yerde titrer." },
          { t: "Işık çubuğu", d: "Kontrolcü oyunun ışık çubuğu rengiyle parlar." },
          {
            t: "PS ve Create",
            d: "PS launcher'ı açar. Create son saniyeleri klip olarak kaydeder.",
          },
          {
            t: "Oyuna özel düzen",
            d: "Her kontrolü taşı, boyutlandır ya da gizle, aç-kapa veya turbo tuş yap.",
          },
          { t: "Gecikme görünür", d: "Kontrolcü o anki gecikmeyi gösterir." },
        ],
      },
      {
        id: "play",
        nav: "Remote Play",
        kicker: "Remote Play",
        title: "Oyun telefonun ekranında.",
        lead: "Remote Play'i aç, oyun sesiyle birlikte kontrolcünün arkasında oynar. Varsayılan olarak kapalıdır.",
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
            d: "Mac'in oyunlarına telefondan göz at. Telefonda seçtiğin Mac'te de seçilir.",
          },
          {
            t: "Koltuktan oyna",
            d: "Telefondan bir oyunu başlat, ona geri dön ya da kapat.",
          },
          { t: "Mac ne yapıyor", d: "Açma, güncelleme ya da başlatma, bir ilerleme çubuğuyla." },
          { t: "Kupalar", d: "Yeni kupa ekranın üstüne düşer, telefon titrer." },
          { t: "Launcher'ın teması", d: "Telefon launcher'ın temasını ve dilini alır." },
        ],
      },
      {
        id: "connect",
        nav: "Bağlanma",
        kicker: "Bağlanma",
        title: "Mac'i kendisi bulur.",
        lead: "İlk seferde iki ekran da aynı dört haneli kodu gösterir. Sonra kendiliğinden bağlanır.",
        shots: [
          {
            name: "phone-activity",
            alt: "Telefon, Mac'in Silksong'u güncellediğini gösteriyor, yüzde 34",
            frame: "phone",
          },
        ],
        items: [
          { t: "Wi-Fi", d: "Telefon Mac'i aynı ağda bulur. İstersen adresini de yazabilirsin." },
          {
            t: "Ya da kablo",
            d: "Android USB hata ayıklamayla bağlanır, iPhone ise Mac'e takılınca bağlanır.",
          },
          {
            t: "Dört telefona kadar",
            d: "Her oyuncuya bir. Telefon ilk tuşa basınca sıradaki oyuncu olur.",
          },
        ],
      },
      {
        id: "together",
        nav: "AnyTogether",
        kicker: "Yanında AnyTogether",
        title: "Arkadaşların, kontrolcü elindeyken.",
        lead: "Ana ekrandaki kişiler düğmesinden aç. Çıkış yapmışken telefon yalnızca kontrolcüdür.",
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
            d: "E-posta kodu ya da Mac'in hesabıyla tek dokunuş. Telefon Mac'i de giriş yaptırabilir.",
          },
          { t: "Arkadaşlar", d: "Kimin çevrimiçi olduğunu ve ne oynadığını gör, kullanıcı adıyla ekle." },
          { t: "Mesajlar", d: "Mac'teki ve sitedeki sohbetlerin aynısı." },
          { t: "Parti ve ses", d: "Telefon hâlâ kontrolcünken partinle konuş." },
          { t: "Birebir arama", d: "Bir arkadaşını arkadaş listenden ara." },
          { t: "Profil", d: "Adını, bionu ve resmini düzenle, oyunlarını ve kupalarını gör." },
          {
            t: "Aktivite ve liderlik",
            d: "Tepkilerle arkadaşların kupaları, arkadaşlar ya da herkes arasında puanlar.",
          },
          { t: "Bildirimler", d: "İstekler, davetler ve cevapsız aramalar." },
          { t: "Kontrolcüyle share play", d: "Bir arkadaşının oyununu izle, sana kontrolcü verince katıl." },
        ],
      },
    ],
    install: {
      title: "AnyPS5 Remote'u kur",
      steps: [
        "Android: AnyPS5-Remote.apk'yı telefonda aç ve tarayıcından kuruluma izin ver.",
        "iPhone: AnyPS5-Remote.ipa'yı AltStore, SideStore ya da Sideloadly ile kur. Ücretsiz Apple kimliğiyle 7 günde bir yenilenmesi gerekir, AltStore bunu kendisi yapar.",
        "Telefonu Mac'in Wi-Fi'ında tut ya da kabloyla bağla, sonra kodu bir kez onayla.",
      ],
      requirements: [
        ["Android", "Güncel herhangi bir telefon, kablo için Mac'te adb"],
        ["iPhone", "iOS 15 ve sonrası"],
        ["Mac", "Telefon destekli AnyPS5, önceden açılmış oyunlar bir kez güncellenmiş"],
      ],
    },
  },
  together: {
    meta: {
      title: "AnyTogether: AnyPS5 için arkadaşlar, parti, ses ve share play",
      description:
        "AnyTogether, AnyPS5'in çevrimiçi evi. Profil, kupalar, arkadaşlar, parti, ses ve share play tek hesapta. Açık kaynak, kendi sunucunda da çalışır.",
    },
    kicker: "AnyTogether",
    title: ["Birlikte oyna.", "Her yerden."],
    lead: "Arkadaşlar, parti ve kupalar için tek hesap. Tüm AnyPS5 uygulamalarında ve bu sitede çalışır.",
    hero: {
      name: "web-home",
      alt: "AnyTogether sitesi: arkadaşların kupalar ve tepkilerle aktivite akışı",
      frame: "browser",
    },
    heroSide: { name: "web-phone", alt: "Telefonda AnyTogether sitesinde mesajlar", frame: "tall" },
    facts: [
      ["4", "yer, tek hesap: Mac, PC, telefon ve web"],
      ["MIT", "açık kaynak, kendi sunucunda da"],
      ["0", "şifre"],
    ],
    chapters: [
      {
        id: "account",
        nav: "Hesap",
        kicker: "Hesabın",
        title: "Şifre yok, kayıt formu yok.",
        lead: "İlk girişin hesabını oluşturur. Onu istediğin zaman değiştirebilir, dışa aktarabilir ya da silebilirsin.",
        shots: [
          {
            name: "web-profile",
            alt: "Sitede bir profil: oyunlar, oynama süresi, kupalar ve puanlar",
            frame: "browser",
          },
        ],
        items: [
          { t: "E-posta kodu", d: "Gelen kutuna altı hane, her uygulamada." },
          {
            t: "Passkey",
            d: "Touch ID, Face ID, Windows Hello ya da telefonunla giriş yap.",
          },
          {
            t: "Tek dokunuş",
            d: "Giriş yapmış telefon bir launcher'ı giriş yaptırır, tersi de olur.",
          },
          {
            t: "Profiller",
            d: "Resim, ad, kullanıcı adı ve bio, oyunların, saatlerin ve kupalarınla.",
          },
          {
            t: "Parça parça gizlilik",
            d: "Oyunlarını, kupalarını, arkadaşlarını ve çevrimiçi durumunu kimin göreceğini seç.",
          },
          { t: "Verilerin", d: "Ayarlar'dan her şeyi dışa aktar ya da hesabı sil." },
        ],
      },
      {
        id: "friends",
        nav: "Arkadaşlar",
        kicker: "Arkadaşlar",
        title: "Arkadaşlar, mesajlar, parti ve arama.",
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
            d: "Kimin çevrimiçi olduğunu ve ne oynadığını gör. İstediğini engelle ya da çıkar.",
          },
          { t: "Mesajlar", d: "Yazıyor göstergesiyle birebir ve grup sohbetleri." },
          {
            t: "Partiler",
            d: "Sekiz kişiye kadar, arkadaşlara ya da herkese açık.",
          },
          {
            t: "Ses",
            d: "Oyuncudan oyuncuya, yalnızca gerektiğinde relay ile. Kimin konuştuğunu gör.",
          },
          {
            t: "Birebir arama",
            d: "Herhangi bir uygulamadan bir arkadaşını ara. Cevapsız aramalar tutulur.",
          },
          { t: "Arkadaşının oyununa katıl", d: "Aynı oyunu launcher'ından aç, sürümü kontrol edilir." },
        ],
      },
      {
        id: "share",
        nav: "Share play",
        kicker: "Share play",
        title: "İzle, sonra kontrolcüyü al.",
        lead: "Bir arkadaşın oyununu paylaşır, sen izlersin. Sana kontrolcü verdiğinde sen de oynarsın.",
        shots: [
          { name: "mac-shareplay", alt: "Mac launcher'ında share play'in yayıncı tarafı", frame: "mac" },
        ],
        items: [
          { t: "Tarayıcıda", d: "Görüntü ve sesle izle, hiçbir şey kurmadan." },
          {
            t: "2. ila 4. oyuncu",
            d: "Kontrolcün ya da klavyen sana verilen oyuncuyu oynatır. Yayıncı 1. oyuncu kalır.",
          },
          {
            t: "Yayıncının kuralları",
            d: "Kimin gireceğine, kaç kişinin izleyeceğine ve kimin çıkacağına yayıncı karar verir.",
          },
        ],
      },
      {
        id: "find",
        nav: "Oyuncu bul",
        kicker: "Oyuncu bul",
        title: "Senin oynadıklarını oynayanlarla tanış.",
        lead: "Co-op, çevrimiçi oyun ya da kupa yardımı için bir grup bul.",
        shots: [],
        items: [
          {
            t: "Grup arayanlar",
            d: "Bir oyun, saat ve dil yaz. İnsanlar katılmak ister, sen seçersin.",
          },
          { t: "Herkese açık partiler", d: "Partini herkese aç ya da birine katıl." },
          {
            t: "Oyun sayfaları",
            d: "Her oyunun sayfasında kimin oynadığı, açık partiler ve canlı share play'ler.",
          },
        ],
      },
      {
        id: "progress",
        nav: "Kupalar",
        kicker: "Kupalar ve oynama süresi",
        title: "Oynadığın her şey sayılır.",
        lead: "Her oturum ve kupa hesabına gelir, arkadaşların da görür.",
        shots: [
          {
            name: "web-leaderboards",
            alt: "Sitede liderlik tabloları: arkadaşlar arasında puanlar",
            frame: "browser",
          },
        ],
        items: [
          { t: "Nadirliğiyle kupalar", d: "Yaygından ultra nadire, oyunu oynayan herkese göre." },
          {
            t: "Aktivite akışı",
            d: "Arkadaşlarının kupaları, ilk oynayışları ve dönüm noktaları, tepkilerle.",
          },
          {
            t: "Adil liderlik tabloları",
            d: "Arkadaşlar ya da herkes arasında puan ve süre. İmkânsız kupa desenleri bir moderatörü bekler.",
          },
        ],
      },
      {
        id: "more",
        nav: "Dahası",
        kicker: "Ve",
        title: "Temalar, uyumluluk ve bildirimler.",
        lead: "Sitedeki diğer her şey.",
        shots: [
          { name: "web-themes", alt: "Sitede Tema Merkezi", frame: "browser" },
          { name: "web-compat", alt: "Sitede uyumluluk listesi", frame: "browser" },
        ],
        items: [
          {
            t: "Tema Merkezi",
            d: "Tema Stüdyosu'nda yapılan temalar, tek tuşla kurulur.",
          },
          {
            t: "Uyumluluk listesi",
            d: "Her oyunun her platformda ne kadar ilerlediği, oyuncu raporlarıyla.",
          },
          {
            t: "Bildirimler",
            d: "Web push ve senin ayarladığın bir e-posta özeti.",
          },
          {
            t: "İndirmeler",
            d: "Son sürümlerden tüm AnyPS5 derlemeleri, sağlama toplamlarıyla.",
          },
          { t: "Moderasyon", d: "Bir kişiyi, mesajı ya da temayı bildir, moderatörler inceler." },
          {
            t: "Açık kaynak",
            d: "MIT lisanslı. Tüm sunucu Docker ile tek makinede çalışır.",
          },
        ],
      },
    ],
    install: {
      title: "Kendi sunucunu kur",
      steps: [
        "2 GB belleği olan bir Linux sunucu, Docker ve bir alan adı gerekir. Sonra launcher'ların AnyTogether ayarlarından sunucunu seç.",
      ],
      requirements: [],
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
    ],
  },
  "pc.engine": {
    shots: [
      {
        name: "pc-settings-engine",
        alt: "Settings, AnyPS5 Engine: the version in use, updates, other versions and your own folder",
        caption: "Engine settings",
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
    note: "Frames from Cat Quest III shared from a Mac and played in a browser.",
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
    ],
  },
  "pc.engine": {
    shots: [
      {
        name: "pc-settings-engine",
        alt: "Ayarlar, AnyPS5 Motoru: kullanılan sürüm, güncellemeler, diğer sürümler ve kendi klasörün",
        caption: "Motor ayarları",
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
    note: "Bir Mac'ten paylaşılıp tarayıcıda oynanan Cat Quest III'ten kareler.",
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
