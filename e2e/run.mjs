// Every AnyTogether client against one local stack: the macOS launcher (Swift), the phone (Dart),
// the Windows/Linux launcher (Dart) and the website (headless Chrome), through seven scenarios.
// See e2e/README.md for what it needs and how to run it.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBus } from "./bus.mjs";
import { WebUser, gone, has, launchBrowser, sleep, textOf, until } from "./web.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const ORIGIN = env.E2E_URL ?? "http://127.0.0.1:18490";
const RUN_DIR = env.E2E_DIR ?? join(here, ".run");
const API_LOG = env.E2E_API_LOG ?? join(RUN_DIR, "api.log");
const CHROME = env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TURN_SECRET = env.TURN_SECRET ?? "e2etestsecret";
const ONLY = (env.E2E_SCENARIOS ?? "1,2,3,4,5,6,7").split(",").map(Number);
/** Where each client's repository is; a driver whose folder is not set is not run. */
const DRIVERS = {
  swift: env.E2E_LAUNCHER_MAC && {
    cwd: env.E2E_LAUNCHER_MAC,
    command: ["swift", "test", "--filter", "TogetherCrossClientTests"],
  },
  phone: env.E2E_PHONE && { cwd: env.E2E_PHONE, command: ["flutter", "test", "test/together_e2e_test.dart"] },
  desk: env.E2E_LAUNCHER_DESKTOP && {
    cwd: env.E2E_LAUNCHER_DESKTOP,
    command: ["flutter", "test", "test/core/together_e2e_test.dart"],
  },
};
const CLIENTS = ["swift", "phone", "desk", "web"];

mkdirSync(RUN_DIR, { recursive: true });
const run = Date.now().toString(36).slice(-5);
const email = (who) => `${who}-${run}@example.com`;

// Results: scenario × client, each a list of checks.
const results = {};
const log = createWriteStream(join(RUN_DIR, "e2e.log"));
function check(scenario, client, ok, what) {
  const line = `${ok ? "PASS" : "FAIL"} [${scenario}] ${client}: ${what}`;
  console.log(line);
  log.write(`${line}\n`);
  results[scenario] ??= {};
  results[scenario][client] ??= [];
  results[scenario][client].push({ ok: Boolean(ok), what });
  return Boolean(ok);
}
const note = (text) => {
  console.log(`  · ${text}`);
  log.write(`  · ${text}\n`);
};

/** The newest sign-in code mailed to `address`, from the API's log. */
async function codeFor(address) {
  for (let tries = 0; tries < 50; tries++) {
    const text = existsSync(API_LOG) ? readFileSync(API_LOG, "utf8") : "";
    const found = [
      ...text.matchAll(new RegExp(`sign-in code for ${address.replace(/[.+]/g, "\\$&")}: (\\d{6})`, "g")),
    ].at(-1);
    if (found) return found[1];
    await sleep(200);
  }
  throw new Error(`no code for ${address} in ${API_LOG}`);
}

/** Asks `fn` until `ok(value)`, at most `ms`; the last value either way. */
async function poll(fn, ok, ms = 10_000, every = 300) {
  const end = Date.now() + ms;
  let value;
  for (;;) {
    try {
      value = await fn();
      if (ok(value)) return { ok: true, value };
    } catch (error) {
      value = error;
    }
    if (Date.now() > end) return { ok: false, value };
    await sleep(every);
  }
}

// The drivers
const bus = createBus();
const busPort = await bus.listen(Number(env.E2E_BUS_PORT ?? 0));
const children = [];
for (const [role, driver] of Object.entries(DRIVERS)) {
  if (!driver) continue;
  const out = createWriteStream(join(RUN_DIR, `driver-${role}.log`));
  const child = spawn(driver.command[0], driver.command.slice(1), {
    cwd: driver.cwd,
    env: {
      ...env,
      ANYTOGETHER_E2E_BUS: `http://127.0.0.1:${busPort}`,
      ANYTOGETHER_E2E_URL: ORIGIN,
      ANYTOGETHER_E2E_ROLE: role,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on("exit", (code) => note(`${role} driver exited with ${code}`));
  children.push({ role, child });
}
const roles = children.map((c) => c.role);
note(`bus on ${busPort}; waiting for ${roles.join(", ") || "no drivers"}`);
await Promise.all(roles.map((role) => bus.ready(role)));
note("drivers up");

/** A driver call: `call("swift", "friends", {as: "main"})`. */
const call = (role, cmd, args, ms) => bus.call(role, cmd, args ?? {}, ms);
const present = (role) => role === "web" || roles.includes(role);

/** Events a driver's socket received since the cursor, waited for until one matches. */
const cursors = {};
async function waitEvent(role, as, type, match = () => true, ms = 10_000) {
  const key = `${role}/${as}`;
  const found = await poll(
    async () => {
      const { next, events } = await call(role, "events", { as, since: 0 });
      cursors[key] = next;
      return events.filter((event) => event.type === type && match(event.data ?? {}));
    },
    (list) => Array.isArray(list) && list.length > 0,
    ms,
  );
  return found.ok ? found.value.at(-1).data : null;
}

const browser = await launchBrowser(CHROME);
const people = {}; // name -> {user, role, as}

async function scenario(number, title, body) {
  if (!ONLY.includes(number)) return;
  console.log(`\n=== ${number}. ${title}`);
  try {
    await body(`${number}`);
  } catch (error) {
    check(`${number}`, "all", false, `stopped: ${error.message}`);
  }
}

// 1. Sign-in
await scenario(1, "Sign-in", async (s) => {
  // Email codes, every client.
  for (const role of ["swift", "phone", "desk"]) {
    if (!present(role)) continue;
    const address = email(role);
    await call(role, "emailStart", { email: address });
    const user = await call(role, "emailVerify", { email: address, code: await codeFor(address) });
    people[role] = { user, role, as: "main" };
    check(s, role, user?.id, `email code signs in (@${user?.handle})`);
  }
  const web = new WebUser(browser, ORIGIN, "web");
  const home = await web.signIn(email("web"), codeFor);
  const signedIn = await has(home, "a.tag.nav.me");
  const handle = signedIn
    ? (await home.$eval("a.tag.nav.me", (a) => a.getAttribute("href"))).replace("/u/", "")
    : null;
  // The website's id, as everyone else sees the profile.
  const helper = roles[0];
  const profile =
    handle && helper ? await call(helper, "api", { method: "GET", path: `users/${handle}` }) : null;
  people.web = { user: { id: profile?.userId, handle }, role: "web", web };
  check(
    s,
    "web",
    signedIn && handle?.startsWith("web"),
    `email code through the login form; the header shows @${handle}`,
  );
  // A stranger for the privacy checks: nobody's friend.
  if (present("desk")) {
    await call("desk", "emailStart", { as: "stranger", email: email("stranger") });
    people.stranger = {
      user: await call("desk", "emailVerify", { as: "stranger", code: await codeFor(email("stranger")) }),
      role: "desk",
      as: "stranger",
    };
  }

  // Hand-off: the phone signs in the Mac, and the Mac the phone.
  if (present("swift") && present("phone")) {
    const handoff = await call("swift", "handoffStart", { as: "mac2", deviceName: "E2E Mac" });
    const waiting = call("swift", "handoffWait", { as: "mac2", ...handoff }, 90_000);
    await call("phone", "handoffApprove", { id: handoff.handoffId });
    const macUser = await waiting;
    check(
      s,
      "swift",
      macUser.id === people.phone.user.id,
      "hand-off: the phone's approval signs the Mac in as the phone's account",
    );
    check(s, "phone", macUser.id === people.phone.user.id, "hand-off: the phone approves the Mac's sign-in");
    const back = await call("phone", "handoffStart", { as: "phone2", deviceName: "E2E Phone" });
    const phoneWaiting = call("phone", "handoffWait", { as: "phone2", ...back }, 90_000);
    await call("swift", "handoffApprove", { id: back.handoffId });
    const phoneUser = await phoneWaiting;
    check(
      s,
      "phone",
      phoneUser.id === people.swift.user.id,
      "hand-off: the Mac's approval signs the phone in as the Mac's account",
    );
    check(
      s,
      "swift",
      phoneUser.id === people.swift.user.id,
      "hand-off: the Mac approves the phone's sign-in",
    );
  }
  if (present("desk") && present("phone")) {
    const handoff = await call("desk", "handoffStart", { as: "desk2", deviceName: "E2E PC" });
    const waiting = call("desk", "handoffWait", { as: "desk2", ...handoff }, 90_000);
    await call("phone", "handoffApprove", { id: handoff.handoffId });
    check(
      s,
      "desk",
      (await waiting).id === people.phone.user.id,
      "hand-off: the phone signs in the Windows/Linux launcher",
    );
  }

  // Device codes approved on the website.
  if (present("swift")) {
    const device = await call("swift", "deviceStart", { as: "mac3", deviceName: "E2E Mac (code)" });
    const waiting = call(
      "swift",
      "deviceWait",
      { as: "mac3", deviceCode: device.deviceCode, interval: 1 },
      120_000,
    );
    const page = await web.open(`/link?code=${encodeURIComponent(device.userCode)}`);
    await page.click("form.card button[type=submit]");
    check(s, "web", await has(page, ".card.success"), "the website approves the Mac's device code");
    const user = await waiting;
    check(
      s,
      "swift",
      user.id === people.web.user.id,
      "device code: the Mac is signed in as the website's account",
    );
    await page.close();
  }
  if (present("desk")) {
    const started = await call("desk", "websiteStart", { as: "desk3", deviceName: "E2E PC (code)" });
    // The launcher opens this page in the browser; the code is already in it.
    const url = new URL(started.page);
    check(
      s,
      "desk",
      url.origin === ORIGIN && url.pathname === "/link" && started.userCode,
      `the launcher's page carries the code (${url.pathname}?code=${started.userCode})`,
    );
    const page = await web.open(url.pathname + url.search);
    await page.click("form.card button[type=submit]");
    check(
      s,
      "web",
      await has(page, ".card.success"),
      "the website approves the Windows/Linux launcher's code from the page it opened",
    );
    const user = await call("desk", "websiteWait", { as: "desk3" }, 120_000);
    check(
      s,
      "desk",
      user.id === people.web.user.id,
      "device code: the launcher is signed in as the website's account",
    );
    await page.close();
  }
});

writeFileSync(
  join(RUN_DIR, "people.json"),
  JSON.stringify(Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.user])), null, 2),
);

// Everyone's sockets, from here on.
for (const role of ["swift", "phone", "desk"])
  if (present(role) && people[role]) await call(role, "socketStart", {});
if (present("swift")) await call("swift", "inboxLoad", {});
await sleep(1000);

// Helpers for the scenarios: friendships through the clients' own calls, rows on the website.
const idOf = (name) => people[name]?.user?.id;
const handleOf = (name) => people[name]?.user?.handle;
const nameOf = (name) => people[name]?.user?.displayName;
/** Clicks the button matching `button` inside the list row that mentions `text`. */
const clickInRow = (page, row, text, button) =>
  page.evaluate(
    (row, text, button) => {
      const li = [...document.querySelectorAll(row)].find((el) => el.textContent.includes(text));
      const target = li?.querySelector(button);
      target?.click();
      return Boolean(target);
    },
    row,
    text,
    button,
  );
const rowText = (page, row, text) =>
  page.evaluate(
    (row, text) =>
      [...document.querySelectorAll(row)].find((el) => el.textContent.includes(text))?.outerHTML ?? "",
    row,
    text,
  );
async function webAccept(fromId) {
  const answer = await people.web.web.fetch(`/me/friends/requests/${fromId}/accept`, { method: "POST" });
  if (answer.status >= 300) throw new Error(`web accept ${answer.status}`);
}
/** a asks b by handle; b accepts with its own client. */
async function befriend(a, b) {
  const ask = (who, handle) =>
    who === "web"
      ? people.web.web.fetch("/me/friends/requests", { method: "POST", body: JSON.stringify({ handle }) })
      : call(people[who].role, people[who].role === "swift" ? "askFriend" : "addFriend", {
          as: people[who].as,
          handle,
        });
  await ask(a, handleOf(b));
  if (b === "web") await webAccept(idOf(a));
  else
    await call(people[b].role, people[b].role === "swift" ? "answerFriend" : "answerFriend", {
      as: people[b].as,
      userId: idOf(a),
      accept: true,
    });
}
const friendsOf = async (who) => {
  if (people[who].role === "swift")
    return (await call("swift", "friends", { as: people[who].as })).map((f) => ({
      ...f,
      state: f.presence?.state,
    }));
  return (await call(people[who].role, "friends", { as: people[who].as })).friends;
};

// 2. Friends
await scenario(2, "Friends", async (s) => {
  const web = people.web.web;
  // The Mac asks the website; the website accepts on its friends page.
  const state = await call("swift", "askFriend", { handle: handleOf("web") });
  check(s, "swift", state === "pending", `asks @${handleOf("web")} to be friends (${state})`);
  const page = await web.open("/friends");
  check(
    s,
    "web",
    (await rowText(page, ".card .person", handleOf("swift"))).includes("primary"),
    "the request shows on the friends page",
  );
  await clickInRow(page, ".card .person", handleOf("swift"), "button.primary.small");
  const listed = await until(
    page,
    (h) => [...document.querySelectorAll(".card.raise .person")].some((li) => li.textContent.includes(h)),
    [handleOf("swift")],
  );
  check(s, "web", listed, "accepting moves the Mac into the friends list");
  check(
    s,
    "swift",
    await waitEvent("swift", "main", "friend.accepted", (d) => d.userId === idOf("web")),
    "the Mac hears friend.accepted live",
  );
  check(
    s,
    "swift",
    (await friendsOf("swift")).some((f) => f.userId === idOf("web")),
    "the website is in the Mac's friends",
  );

  // Everyone else befriends everyone, each through its own client.
  for (const [a, b] of [
    ["phone", "swift"],
    ["desk", "swift"],
    ["phone", "web"],
    ["desk", "web"],
    ["desk", "phone"],
  ])
    await befriend(a, b);
  for (const who of ["phone", "desk"]) {
    const others = ["swift", "web", who === "phone" ? "desk" : "phone"].map(idOf);
    const got = await poll(
      () => friendsOf(who),
      (list) => others.every((id) => list.some((f) => f.userId === id)),
      10_000,
    );
    check(
      s,
      who,
      got.ok,
      "the friends list fills live from friend.accepted (Mac, website, the other launcher)",
    );
  }

  // Presence: the Mac plays; the phone, the other launcher and the website see it.
  await call("swift", "presence", { state: "in_game", titleId: "PPSA01234" });
  for (const who of ["phone", "desk"]) {
    const seen = await poll(
      () => friendsOf(who),
      (list) =>
        list.some((f) => f.userId === idOf("swift") && f.state === "inGame" && f.titleId === "PPSA01234"),
      10_000,
    );
    check(s, who, seen.ok, "sees the Mac in game (PPSA01234) live from presence.updated");
  }
  const webSees = await poll(
    async () => {
      await page.reload({ waitUntil: "networkidle0" });
      return rowText(page, ".card.raise .person", handleOf("swift"));
    },
    (html) => html.includes("in_game") && html.includes("PPSA01234"),
    25_000,
    3000,
  );
  check(s, "web", webSees.ok, "the friends page shows the Mac playing PPSA01234");
  const macSees = await poll(
    () => friendsOf("swift"),
    (list) => ["phone", "desk"].every((w) => list.find((f) => f.userId === idOf(w))?.state === "online"),
  );
  check(s, "swift", macSees.ok, "the Mac sees the phone and the Windows/Linux launcher online");

  // Unfriending: the Mac removes the Windows/Linux launcher's account.
  await call("swift", "removeFriend", { userId: idOf("desk") });
  const dropped = await poll(
    () => friendsOf("desk"),
    (list) => !list.some((f) => f.userId === idOf("swift")),
  );
  check(
    s,
    "desk",
    dropped.ok && (await waitEvent("desk", "main", "friend.removed", (d) => d.userId === idOf("swift"))),
    "unfriended: the Mac leaves its list live (friend.removed)",
  );
  check(
    s,
    "swift",
    !(await friendsOf("swift")).some((f) => f.userId === idOf("desk")),
    "the Mac's list no longer has it",
  );
  await befriend("desk", "swift");

  // Blocking: a stranger befriends the website, which blocks them from the friends page menu.
  await call("desk", "socketStart", { as: "stranger" });
  await befriend("stranger", "web");
  await page.reload({ waitUntil: "networkidle0" });
  await clickInRow(page, ".card.raise .person", handleOf("stranger"), ".menu .pill.icon");
  await sleep(200);
  await clickInRow(page, ".card.raise .person", handleOf("stranger"), "button.danger[role=menuitem]");
  await sleep(200);
  await clickInRow(page, ".card.raise .person", handleOf("stranger"), ".confirm .pill.danger");
  check(
    s,
    "web",
    await until(
      page,
      (h) => ![...document.querySelectorAll(".card.raise .person")].some((li) => li.textContent.includes(h)),
      [handleOf("stranger")],
    ),
    "blocking from the menu removes the stranger",
  );
  const strangerList = await poll(
    () => call("desk", "friends", { as: "stranger" }),
    (v) => !v.friends.some((f) => f.userId === idOf("web")),
  );
  check(s, "desk", strangerList.ok, "the blocked launcher loses the website from its list live");
  const again = await call("desk", "addFriend", { as: "stranger", handle: handleOf("web") }).then(
    () => "sent",
    (e) => e.problem?.code,
  );
  check(s, "desk", again === "not_found", `the blocked launcher cannot ask again (${again})`);
  const card = await call("desk", "api", {
    as: "stranger",
    method: "GET",
    path: `users/${handleOf("web")}`,
  }).then(
    () => "shown",
    (e) => e.problem?.status,
  );
  check(s, "desk", card === 404, `nor open the website's profile (${card})`);
});

// 3. Messages
await scenario(3, "Messages", async (s) => {
  const web = people.web.web;
  // A direct message from the Mac: the website's header counts it live, the thread shows it.
  const home = await web.open("/friends");
  const dm = await call("swift", "conversationWith", { userId: idOf("web") });
  await call("swift", "send", { conversationId: dm.id, text: "Hello website, from the Mac" });
  check(
    s,
    "web",
    await until(home, () => document.querySelector("a[href='/messages'] .badge")?.textContent === "1"),
    "the header's unread badge counts the Mac's message live",
  );
  const thread = await web.open(`/messages?c=${dm.id}`);
  check(
    s,
    "web",
    await until(thread, () =>
      [...document.querySelectorAll(".bubble")].some((b) =>
        b.textContent.includes("Hello website, from the Mac"),
      ),
    ),
    "the thread shows it",
  );
  check(
    s,
    "swift",
    await waitEvent(
      "swift",
      "main",
      "conversation.read",
      (d) => d.userId === idOf("web") && d.conversationId === dm.id,
    ),
    "the Mac hears the website read it",
  );
  check(
    s,
    "web",
    await until(home, () => !document.querySelector("a[href='/messages'] .badge")),
    "reading it clears the badge on the website's other tab",
  );
  await home.close();

  // A group: Mac, website, phone, Windows/Linux launcher.
  const group = await call("swift", "group", {
    userIds: ["web", "phone", "desk"].map(idOf),
    title: "E2E group",
  });
  check(s, "swift", group.kind === "group" && group.members.length === 4, "the Mac starts a group of four");
  const g = group.id;
  const page = await web.open(`/messages?c=${g}`);
  await call("swift", "send", { conversationId: g, text: "1 from the Mac" });
  check(
    s,
    "web",
    await until(page, () =>
      [...document.querySelectorAll(".bubble")].some((b) => b.textContent.includes("1 from the Mac")),
    ),
    "the group thread shows the Mac's message live",
  );
  for (const who of ["phone", "desk"]) {
    const got = await poll(
      () => call(who, "messages"),
      (m) =>
        m.conversations.some((c) => c.id === g && c.last === "1 from the Mac" && c.unread === 1) &&
        m.unread >= 1,
    );
    check(
      s,
      who,
      got.ok,
      `the new group arrives live with the message, unread 1 (total ${got.value?.unread})`,
    );
  }
  // The website types, then sends.
  for (const who of ["phone", "desk"]) await call(who, "show", { id: g });
  await page.type(".composer textarea", "2 from the website");
  check(
    s,
    "swift",
    (
      await poll(
        () => call("swift", "typingWho", { conversation: g }),
        (list) => list.includes(idOf("web")),
      )
    ).ok,
    "the Mac shows the website typing",
  );
  check(
    s,
    "desk",
    (
      await poll(
        () => call("desk", "messages"),
        (m) => m.typing.includes(idOf("web")),
      )
    ).ok,
    "the Windows/Linux launcher shows the website typing",
  );
  check(
    s,
    "phone",
    await waitEvent("phone", "main", "typing", (d) => d.userId === idOf("web") && d.conversationId === g),
    "the phone's socket gets the typing event (the phone shows no typing yet)",
  );
  await page.click(".composer .primary.send");
  for (const who of ["phone", "desk"]) {
    const got = await poll(
      () => call(who, "messages"),
      (m) =>
        m.thread.some((x) => x.text === "2 from the website") &&
        m.conversations.find((c) => c.id === g)?.unread === 0,
    );
    check(s, who, got.ok, "the open thread gets the website's message live and stays read");
  }
  check(
    s,
    "swift",
    (
      await poll(
        () => call("swift", "typingWho", { conversation: g }),
        (list) => !list.includes(idOf("web")),
      )
    ).ok,
    "the website's message ends its typing on the Mac",
  );
  // The phone, then the Windows/Linux launcher.
  await call("phone", "sendMessage", { text: "3 from the phone" });
  check(
    s,
    "desk",
    (
      await poll(
        () => call("desk", "messages"),
        (m) => m.thread.some((x) => x.text === "3 from the phone"),
      )
    ).ok,
    "the phone's message arrives live",
  );
  check(
    s,
    "web",
    await until(page, () =>
      [...document.querySelectorAll(".bubble")].some((b) => b.textContent.includes("3 from the phone")),
    ),
    "the website shows the phone's message",
  );
  await call("desk", "typing");
  check(s, "web", await has(page, ".typing"), "the website shows the Windows/Linux launcher typing");
  await call("desk", "sendMessage", { text: "4 from the launcher" });
  check(
    s,
    "web",
    await until(page, () =>
      [...document.querySelectorAll(".bubble")].some((b) => b.textContent.includes("4 from the launcher")),
    ),
    "the website shows the launcher's message",
  );
  check(
    s,
    "phone",
    (
      await poll(
        () => call("phone", "messages"),
        (m) => m.thread.some((x) => x.text === "4 from the launcher"),
      )
    ).ok,
    "the phone gets the launcher's message live",
  );
  // Unread on the Mac: its inbox, kept by events, against the server's count.
  const inbox = await poll(
    () => call("swift", "inbox"),
    (i) => i.conversations?.find((c) => c.id === g)?.unread === 3,
  );
  const server = await call("swift", "unread");
  check(
    s,
    "swift",
    inbox.ok &&
      inbox.value.conversations[0].id === g &&
      inbox.value.conversations[0].last === "4 from the launcher",
    `the inbox counts 3 unread in the group live, newest on top (${JSON.stringify(inbox.value?.conversations?.[0])})`,
  );
  check(
    s,
    "swift",
    server === inbox.value?.unread,
    `the server's unread count agrees (${server} = ${inbox.value?.unread})`,
  );
  const messages = await call("swift", "messages", { conversationId: g });
  await call("swift", "markRead", { conversationId: g, seq: messages.at(-1).seq });
  check(
    s,
    "swift",
    (
      await poll(
        () => call("swift", "inbox"),
        (i) => i.conversations.find((c) => c.id === g)?.unread === 0,
      )
    ).ok && (await call("swift", "unread")) === 0,
    "reading it clears both (conversation.read from its own device)",
  );
  await page.close();
  await thread.close();
});

// 4. Parties
let partyId;
let partyPage;
await scenario(4, "Parties", async (s) => {
  const web = people.web.web;
  partyPage = await web.open("/party");
  await partyPage.click(".start-party button.primary");
  check(s, "web", await has(partyPage, ".party-page .members-head"), "the website starts a party");
  partyId = (await web.fetch("/me/social/me/party")).body?.party?.id;
  for (const who of ["swift", "phone", "desk"]) {
    const invited = await clickInRow(
      partyPage,
      ".party-page .card .person",
      `@${handleOf(who)}`,
      "button.pill",
    );
    check(s, "web", invited, `invites @${handleOf(who)} from the party page`);
    await sleep(300);
  }
  check(
    s,
    "swift",
    await waitEvent("swift", "main", "party.invite", (d) => d.partyId === partyId),
    "the Mac hears the invite live",
  );
  check(
    s,
    "swift",
    (await call("swift", "myParty")).invites.some((i) => i.partyId === partyId),
    "and lists it",
  );
  for (const who of ["phone", "desk"])
    check(
      s,
      who,
      (
        await poll(
          () => call(who, "parties"),
          (p) => p.invites.some((i) => i.partyId === partyId && i.from === idOf("web")),
        )
      ).ok,
      "the invite shows live, from the website",
    );
  const joined = await call("swift", "joinParty", { partyId });
  check(
    s,
    "swift",
    joined.members.some((m) => m.userId === idOf("swift")),
    "the Mac joins",
  );
  for (const who of ["phone", "desk"]) await call(who, "joinParty", { partyId });
  check(
    s,
    "web",
    await until(partyPage, () => document.querySelector(".members-head .n")?.textContent === "4"),
    "the party page shows four members live",
  );
  for (const who of ["phone", "desk"]) {
    const got = await poll(
      () => call(who, "parties"),
      (p) => p.party?.members.length === 4 && p.invites.length === 0,
    );
    check(
      s,
      who,
      got.ok,
      `its party shows all four (member_joined), invite gone (${got.value?.party?.members?.length})`,
    );
  }
  // The website hands the lead to the Mac.
  await clickInRow(partyPage, ".party-page .card.raise .person", `@${handleOf("swift")}`, ".menu .pill.icon");
  await sleep(200);
  await clickInRow(
    partyPage,
    ".party-page .card.raise .person",
    `@${handleOf("swift")}`,
    "button[role=menuitem]:not(.danger)",
  );
  check(
    s,
    "web",
    await until(
      partyPage,
      (h) =>
        [...document.querySelectorAll(".card.raise .person")]
          .find((li) => li.textContent.includes(h))
          ?.querySelector(".crown"),
      [`@${handleOf("swift")}`],
    ),
    "the crown moves to the Mac",
  );
  check(
    s,
    "swift",
    (
      await poll(
        () => call("swift", "myParty"),
        (m) => m.party?.leaderId === idOf("swift"),
      )
    ).ok,
    "the Mac leads now",
  );
  for (const who of ["phone", "desk"])
    check(
      s,
      who,
      (
        await poll(
          () => call(who, "parties"),
          (p) => p.party?.leaderId === idOf("swift"),
        )
      ).ok,
      "sees the Mac lead (party.updated)",
    );
  // The Mac, now leader, removes the Windows/Linux launcher.
  await call("swift", "kick", { userId: idOf("desk"), partyId });
  const kicked = await poll(
    () => call("desk", "parties"),
    (p) => p.kicked && !p.party,
  );
  check(s, "desk", kicked.ok, "kicked: out of the party, told so");
  check(
    s,
    "phone",
    (
      await poll(
        () => call("phone", "parties"),
        (p) => p.party?.members.length === 3 && !p.party.members.includes(idOf("desk")),
      )
    ).ok,
    "sees three left",
  );
  check(
    s,
    "web",
    await until(partyPage, () => document.querySelector(".members-head .n")?.textContent === "3"),
    "the party page shows three",
  );
  check(s, "swift", (await call("swift", "myParty")).party.members.length === 3, "the Mac's party has three");
});

// 5. Calls: the Mac relays the signalling for a peer connection that stands in for its voice
// (a browser page here: the launcher's WebRTC itself is not under test, its signalling is).
const turnFor = (servers, userId) => {
  const relay = servers.find((server) => server.urls.some((url) => url.startsWith("turn:")));
  if (!relay) return "no TURN server";
  const [expiry, user] = relay.username.split(":");
  const expected = createHmac("sha1", TURN_SECRET).update(relay.username).digest("base64");
  if (user !== userId) return `username for ${user}`;
  if (Number(expiry) * 1000 < Date.now() + 11 * 3600_000) return "expires too soon";
  return relay.credential === expected ? "ok" : "credential does not verify";
};
async function standIn() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/login`);
  await page.evaluate(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    window.pc = pc;
    window.candidates = [];
    pc.onicecandidate = (event) => event.candidate && window.candidates.push(event.candidate.toJSON());
  });
  return page;
}
/** Passes signals between the stand-in and the Mac's socket until the stand-in is connected. */
async function relay(page, callId, peer, device, offering) {
  const sent = { candidates: 0 };
  const used = new Set();
  const kinds = [];
  if (offering) {
    const offer = await page.evaluate(async () => {
      const offer = await window.pc.createOffer();
      await window.pc.setLocalDescription(offer);
      return window.pc.localDescription.toJSON();
    });
    await call("swift", "signal", { to: peer, device, call: callId, kind: "offer", data: offer });
    kinds.push("sent offer");
  }
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const signals = await call("swift", "decodeSignals");
    for (const [index, signal] of signals.entries()) {
      if (used.has(index) || signal.call !== callId || signal.from !== peer) continue;
      used.add(index);
      kinds.push(`got ${signal.kind}`);
      if (signal.kind === "answer")
        await page.evaluate((d) => window.pc.setRemoteDescription(d), { type: signal.type, sdp: signal.sdp });
      if (signal.kind === "offer") {
        const answer = await page.evaluate(
          async (d) => {
            await window.pc.setRemoteDescription(d);
            const answer = await window.pc.createAnswer();
            await window.pc.setLocalDescription(answer);
            return window.pc.localDescription.toJSON();
          },
          { type: signal.type, sdp: signal.sdp },
        );
        await call("swift", "signal", { to: peer, device, call: callId, kind: "answer", data: answer });
        kinds.push("sent answer");
      }
      if (signal.kind === "candidate" && signal.candidate)
        await page.evaluate((c) => window.pc.addIceCandidate(c).catch(() => undefined), {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        });
    }
    const fresh = await page.evaluate((from) => window.candidates.slice(from), sent.candidates);
    for (const candidate of fresh)
      await call("swift", "signal", { to: peer, device, call: callId, kind: "candidate", data: candidate });
    sent.candidates += fresh.length;
    if ((await page.evaluate(() => window.pc.connectionState)) === "connected")
      return { connected: true, kinds };
    await sleep(250);
  }
  return { connected: false, kinds, state: await page.evaluate(() => window.pc.connectionState) };
}
const summary = (kinds) => [...new Set(kinds)].join(", ");

await scenario(5, "Calls signalling", async (s) => {
  const web = people.web.web;
  if (!partyId) throw new Error("no party from scenario 4");
  // Party voice: the website is in first (fake microphone), the Mac joins and offers.
  partyPage ??= await web.open("/party");
  await partyPage.click(".voice-join .primary");
  check(s, "web", await has(partyPage, ".voice-controls .mic"), "the website joins the party's voice");
  await sleep(500);
  const joined = await call("swift", "joinCall", { partyId });
  const callId = joined.join.call.id;
  check(
    s,
    "swift",
    turnFor(joined.join.iceServers, idOf("swift")) === "ok",
    `the ICE servers carry TURN REST credentials that verify (${turnFor(joined.join.iceServers, idOf("swift"))})`,
  );
  check(
    s,
    "swift",
    joined.join.iceServers.some((x) => x.urls.some((u) => u.startsWith("stun:"))) && joined.join.expiresAt,
    "and STUN, and when they expire",
  );
  const webPeer = joined.peersToCall.find((p) => p.userId === idOf("web"));
  check(s, "swift", webPeer?.device, "the newcomer Mac is to call the website's device");
  const page = await standIn();
  const party = await relay(page, callId, idOf("web"), webPeer.device, true);
  check(
    s,
    "swift",
    party.connected,
    `offer → answer → candidates through the gateway, connected (${summary(party.kinds)})`,
  );
  check(
    s,
    "web",
    await until(
      partyPage,
      (h) =>
        [...document.querySelectorAll(".card.raise .person")]
          .find((li) => li.textContent.includes(h))
          ?.querySelector(".in-voice"),
      [nameOf("swift")],
    ),
    "the party page shows the Mac in voice",
  );
  check(
    s,
    "phone",
    (
      await poll(
        () => call("phone", "parties"),
        (p) => p.party?.inCall.includes(idOf("swift")) && p.party.inCall.includes(idOf("web")),
      )
    ).ok,
    "the phone's party shows the website and the Mac in the call",
  );
  await call("swift", "setMuted", { muted: true, callId });
  check(
    s,
    "web",
    await until(
      partyPage,
      (n) =>
        [...document.querySelectorAll(".card.raise .person")]
          .find((li) => li.textContent.includes(n))
          ?.querySelector(".in-voice.muted"),
      [nameOf("swift")],
    ),
    "the Mac mutes: the website shows it muted",
  );
  await partyPage.click(".voice-controls .mic");
  const mute = await poll(
    () => call("swift", "decodeMutes"),
    (list) => list.some((m) => m.userId === idOf("web") && m.muted && m.callId === callId),
  );
  check(s, "swift", mute.ok, "the website mutes: the Mac reads call.updated");
  await call("swift", "leaveCall", { callId });
  check(
    s,
    "web",
    await until(
      partyPage,
      (n) =>
        ![...document.querySelectorAll(".card.raise .person")]
          .find((li) => li.textContent.includes(n))
          ?.querySelector(".in-voice"),
      [nameOf("swift")],
    ),
    "the Mac leaves the voice",
  );
  await partyPage.click(".voice-controls .pill.danger").catch(() => undefined);
  await page.browserContext().close();

  // A 1:1 call: the website rings the Mac from the friends page; the Mac answers and offers.
  const friends = await web.open("/friends");
  await sleep(1500);
  await clickInRow(friends, ".card.raise .person", handleOf("swift"), ".call-btn");
  const ringing = await waitEvent("swift", "main", "call.ringing", (d) => d.from?.userId === idOf("web"));
  check(
    s,
    "swift",
    ringing?.callId && ringing.device,
    "the Mac rings (call.ringing, with the caller's device)",
  );
  check(s, "web", await has(friends, ".call-panel.is-calling"), "the website shows calling");
  const answered = await call("swift", "answerCall", { callId: ringing.callId });
  check(
    s,
    "swift",
    turnFor(answered.join.iceServers, idOf("swift")) === "ok",
    "answering gives verified relay credentials",
  );
  const caller = answered.peersToCall.find((p) => p.userId === idOf("web"));
  check(s, "swift", caller?.device === ringing.device, "and the caller's device to call");
  const page2 = await standIn();
  const direct = await relay(page2, ringing.callId, idOf("web"), caller.device, true);
  check(s, "swift", direct.connected, `offer → answer → candidates, connected (${summary(direct.kinds)})`);
  check(s, "web", await has(friends, ".call-panel.is-live", 15_000), "the website's call goes live");
  await call("swift", "setMuted", { muted: true, callId: ringing.callId });
  check(s, "web", await has(friends, ".call-panel .muted-badge"), "the Mac mutes: the website shows it");
  await call("swift", "leaveCall", { callId: ringing.callId });
  check(
    s,
    "web",
    await has(friends, ".call-panel.is-ended"),
    "the Mac hangs up: the website shows the call ended",
  );
  await page2.browserContext().close();
  await friends.close();
});

// 6. Sync
const GAME = { titleId: "PPSA09999", gameName: "E2E Quest" };
await scenario(6, "Sync", async (s) => {
  const web = people.web.web;
  const synced = await call("swift", "syncPlay", {
    ...GAME,
    seconds: 5400,
    trophies: [
      { id: 0, grade: "platinum", name: "All of it", detail: "Every trophy" },
      { id: 1, grade: "bronze", name: "First steps", detail: "Start", earned: true },
      { id: 2, grade: "gold", name: "Deep dive", detail: "Go deep", earned: true },
    ],
  });
  check(s, "swift", synced.empty, "the session and two trophies go up, the outbox empties");
  const profile = await web.open(`/u/${handleOf("swift")}`);
  check(
    s,
    "web",
    await until(
      profile,
      (n) => [...document.querySelectorAll(".games .game .name")].some((e) => e.textContent.includes(n)),
      [GAME.gameName],
    ),
    "the Mac's profile lists the game",
  );
  const trophies = await profile.$$eval(".trophies .trophy .name", (list) => list.map((e) => e.textContent));
  check(
    s,
    "web",
    trophies.includes("First steps") && trophies.includes("Deep dive"),
    `and the trophies (${trophies.join(", ")})`,
  );
  const boards = await web.open("/leaderboards");
  check(
    s,
    "web",
    (await boards.content()).includes(handleOf("swift")) ||
      (await boards.content()).includes(nameOf("swift")),
    "the friends leaderboard has the Mac",
  );
  const feed = await web.open("/");
  check(
    s,
    "web",
    await until(feed, (n) => document.body.textContent.includes(n), ["Deep dive"], 10_000),
    "the activity feed shows the Mac's trophy",
  );
  check(
    s,
    "desk",
    (await call("desk", "api", { method: "GET", path: `users/${handleOf("swift")}/library` })).games?.some(
      (g) => g.titleId === GAME.titleId,
    ),
    "a friend's launcher reads the game in the Mac's library",
  );
  // Privacy: the defaults keep the library to friends.
  const stranger = await call("desk", "api", {
    as: "stranger",
    method: "GET",
    path: `users/${handleOf("swift")}/library`,
  }).then(
    (v) => (v.private ? "private" : `shown ${v.games?.length}`),
    (e) => `refused ${e.problem?.status}`,
  );
  check(
    s,
    "desk",
    stranger === "private" || stranger.startsWith("refused 403"),
    `a stranger does not see it (${stranger})`,
  );
  const strangerTrophies = await call("desk", "api", {
    as: "stranger",
    method: "GET",
    path: `users/${handleOf("swift")}/trophies`,
  }).then(
    (v) => (v.private ? "private" : `shown ${v.trophies?.length}`),
    (e) => `refused ${e.problem?.status}`,
  );
  check(
    s,
    "desk",
    strangerTrophies === "private" || strangerTrophies.startsWith("refused 403"),
    `nor the trophies (${strangerTrophies})`,
  );
  await call("swift", "privacy", { section: "trophies", visibility: "nobody" });
  await profile.reload({ waitUntil: "networkidle0" });
  check(
    s,
    "web",
    !(await profile.$(".trophies .trophy")),
    "the Mac hides its trophies from everyone: the website's profile shows none",
  );
  const page = await call("swift", "profilePage", { handle: handleOf("swift") });
  check(s, "swift", page.trophies?.shown?.length === 2, "the owner still sees its own");
  await call("swift", "privacy", { section: "trophies", visibility: "friends" });
  await profile.close();
  await boards.close();
  await feed.close();
});

// 7. Game sessions
await scenario(7, "Game sessions", async (s) => {
  const version = { gameVersion: "1.02", engineBuild: "0.2.14-e2e" };
  const session = await call("swift", "openGame", { titleId: GAME.titleId, ...version, capacity: 4 });
  check(
    s,
    "swift",
    session.joinable && session.host.userId === idOf("swift"),
    "the Mac opens a joinable session",
  );
  const seen = await poll(
    () => friendsOf("desk"),
    (list) => list.find((f) => f.userId === idOf("swift"))?.game?.joinable === true,
  );
  const game = seen.value?.find?.((f) => f.userId === idOf("swift"))?.game;
  check(
    s,
    "desk",
    seen.ok && game.sessionId === session.id && game.players === 1 && game.capacity === 4,
    "the Windows/Linux launcher sees the Mac's game joinable in its presence",
  );
  check(
    s,
    "desk",
    (await call("desk", "mismatch", {
      id: session.id,
      gameVersion: "1.01",
      engineBuild: version.engineBuild,
    })) === "gameVersion",
    "its own copy, 1.01, is told apart before trying",
  );
  const refused = await call("desk", "joinGame", {
    id: session.id,
    gameVersion: "1.01",
    engineBuild: version.engineBuild,
  }).then(
    () => "joined",
    (e) => e.problem?.code,
  );
  check(s, "desk", refused === "version_mismatch", `the server refuses a mismatched join (${refused})`);
  const joined = await call("desk", "joinGame", { id: session.id, ...version });
  check(
    s,
    "desk",
    joined.players.some((p) => p.userId === idOf("desk")),
    "the matching version joins",
  );
  const bridge = (await call("desk", "games")).bridge;
  check(
    s,
    "desk",
    bridge?.role === "guest" && bridge.session.id === session.id,
    "and writes the engine's bridge file as the guest",
  );
  check(
    s,
    "swift",
    await waitEvent(
      "swift",
      "main",
      "game_session.updated",
      (d) => d.id === session.id && d.players?.some((p) => p.userId === idOf("desk")),
    ),
    "the Mac hears the player join (game_session.updated)",
  );
  // Each player's own properties, seen by the other.
  await call("desk", "api", {
    method: "PUT",
    path: `game-sessions/${session.id}/members/me`,
    body: { properties: { endpoint: "desk:9000" } },
  });
  await call("swift", "api", {
    method: "PUT",
    path: `game-sessions/${session.id}/members/me`,
    body: { properties: { endpoint: "mac:9000" } },
  });
  const macView = await call("swift", "api", { method: "GET", path: `game-sessions/${session.id}` });
  const deskMember = macView.members?.find((m) => m.userId === idOf("desk"));
  check(
    s,
    "swift",
    deskMember?.properties?.endpoint === "desk:9000" && deskMember.device,
    "the Mac reads the launcher's properties and device",
  );
  const deskView = await poll(
    () => call("desk", "getGame", { id: session.id }),
    (v) => v.members?.some((m) => m.userId === idOf("swift") && m.properties?.endpoint === "mac:9000"),
  );
  check(s, "desk", deskView.ok, "the launcher reads the Mac's properties");
  // A game signal from the launcher's socket reaches the Mac.
  await call("desk", "frame", {
    frame: {
      op: "signal",
      to: idOf("swift"),
      session: session.id,
      kind: "message",
      data: { hello: "from the launcher" },
    },
  });
  const signal = await waitEvent(
    "swift",
    "main",
    "game_session.signal",
    (d) => d.sessionId === session.id && d.from === idOf("desk"),
  );
  check(
    s,
    "swift",
    signal?.data?.hello === "from the launcher" && signal.kind === "message",
    "game_session.signal from the launcher reaches the Mac",
  );
  // The host ends it.
  await call("swift", "endGame", { id: session.id });
  check(
    s,
    "desk",
    await waitEvent("desk", "main", "game_session.ended", (d) => d.sessionId === session.id),
    "the launcher hears the session end",
  );
  const after = await poll(
    () => call("desk", "games"),
    (g) => !g.session && !g.bridge,
  );
  check(s, "desk", after.ok, "and drops it, bridge file and all");
  check(
    s,
    "desk",
    (
      await poll(
        () => friendsOf("desk"),
        (list) => !list.find((f) => f.userId === idOf("swift"))?.game,
      )
    ).ok,
    "the Mac's presence no longer offers the game",
  );
});

// The table
for (const { role } of children) await call(role, "done", {}, 10_000).catch(() => undefined);
await browser.close();
for (const error of people.web?.web?.errors ?? []) note(error);
const scenarios = Object.keys(results).sort();
const cell = (list) =>
  !list
    ? "n/a"
    : list.every((c) => c.ok)
      ? `pass (${list.length})`
      : `FAIL (${list.filter((c) => !c.ok).length}/${list.length})`;
const table = [`| scenario | ${CLIENTS.join(" | ")} |`, `|---|${CLIENTS.map(() => "---").join("|")}|`];
for (const s of scenarios)
  table.push(
    `| ${s} | ${CLIENTS.map((c) => cell(results[s][c] ?? (results[s].all && c === "swift" ? results[s].all : undefined))).join(" | ")} |`,
  );
console.log(`\n${table.join("\n")}`);
writeFileSync(join(RUN_DIR, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(join(RUN_DIR, "results.md"), `${table.join("\n")}\n`);
bus.close();
const failed = Object.values(results).some((byClient) =>
  Object.values(byClient).some((list) => list.some((c) => !c.ok)),
);
process.exit(failed ? 1 : 0);
