// End-to-end encrypted direct messages on the website, against the local stack (stack.sh): two
// people sign in through the real login form, become friends, write to each other, and every
// state of the feature is checked and photographed headless. A third person signs in through the
// API only (an older app with no keys) for the plain fallback.
//   E2E_PORT=… e2e/stack.sh start && node e2e/e2ee-web.mjs <out-dir>
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebUser, has, launchBrowser, sleep, until } from "./web.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RUN_DIR = process.env.E2E_DIR ?? join(ROOT, "e2e/.run");
const API_LOG = join(RUN_DIR, "api.log");
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 18490}`;
const OUT = process.argv[2] ?? join(RUN_DIR, "e2ee");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const email = (who) => `${who}.${stamp}@example.com`;
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failed++;
  return ok;
};

async function codeFor(address) {
  for (let tries = 0; tries < 60; tries++) {
    const text = existsSync(API_LOG) ? readFileSync(API_LOG, "utf8") : "";
    const found = [
      ...text.matchAll(new RegExp(`sign-in code for ${address.replace(/[.+]/g, "\\$&")}: (\\d{6})`, "g")),
    ].at(-1);
    if (found) return found[1];
    await sleep(250);
  }
  throw new Error(`no code for ${address}`);
}

/** A sign-in through the API alone: a session with no device keys, like an older app. */
async function apiUser(address) {
  const api = (path, body, token) =>
    fetch(`${ORIGIN}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "anytogether-client": "launcher-macos/0.2.13 (macOS 26.6)",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  await api("/auth/email/start", { email: address });
  const done = await api("/auth/email/verify", { email: address, code: await codeFor(address) });
  return { token: done.body.accessToken, id: done.body.user.id, handle: done.body.user.handle, api };
}

const shot = async (page, name) => {
  await sleep(450);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  shot ${name}.png`);
};

const browser = await launchBrowser(CHROME);
try {
  const utku = new WebUser(browser, ORIGIN, "utku");
  const ayse = new WebUser(browser, ORIGIN, "ayse");
  await utku.signIn(email("utku"), codeFor);
  await ayse.signIn(email("ayse"), codeFor);
  // Friends, through API sessions of the same accounts.
  const apiU = await apiUser(email("utku"));
  const apiA = await apiUser(email("ayse"));
  await apiU.api("/me/friends/requests", { handle: apiA.handle }, apiU.token);
  await apiA.api(`/me/friends/requests/${apiU.id}/accept`, {}, apiA.token);
  const made = await apiU.api("/conversations", { members: [apiA.id] }, apiU.token);
  const conversationId = made.body.id;

  // Each browser registers its own device on the messages page.
  const pageU = await utku.open(`/messages?c=${conversationId}`);
  const pageA = await ayse.open(`/messages?c=${conversationId}`);
  check(await has(pageU, ".e2ee-lock.on", 20_000), "the thread shows it is end-to-end encrypted");
  await has(pageA, ".e2ee-lock.on", 20_000);
  const devices = await apiU.api(`/e2ee/devices?users=${apiU.id},${apiA.id}`, undefined, apiU.token);
  check(
    devices.body?.users?.every((u) => u.devices.length === 1),
    "each browser registered one device (the API-only sessions none)",
  );

  // A sealed message, both ways.
  await pageU.type(".composer textarea", "Merhaba Ayşe, this one is sealed 🔒");
  await pageU.keyboard.press("Enter");
  check(
    await until(
      pageA,
      () =>
        [...document.querySelectorAll(".bubble")].some((b) => b.textContent?.includes("this one is sealed")),
      [],
      15_000,
    ),
    "Ayşe's browser opens Utku's sealed message",
  );
  await pageA.type(".composer textarea", "Got it. Comparing the safety number now.");
  await pageA.keyboard.press("Enter");
  check(
    await until(
      pageU,
      () =>
        [...document.querySelectorAll(".bubble")].some((b) =>
          b.textContent?.includes("Comparing the safety"),
        ),
      [],
      15_000,
    ),
    "Utku's browser opens Ayşe's reply",
  );
  const stored = await apiU.api(`/conversations/${conversationId}/messages`, undefined, apiU.token);
  check(
    stored.body?.messages?.length === 2 &&
      stored.body.messages.every((m) => m.sealed && m.text === "[encrypted message]"),
    "the server has only ciphertext (an older client sees the stand-in)",
  );
  const plainTry = await apiU.api(
    `/conversations/${conversationId}/messages`,
    { clientId: crypto.randomUUID(), text: "plain?" },
    apiU.token,
  );
  check(plainTry.status === 409 && plainTry.body?.code === "e2ee_required", "a plain message is refused now");
  await shot(pageU, "web-thread-desktop");

  // The sheet with the safety number: the same digits on both sides.
  await pageU.click(".e2ee-lock");
  await has(pageU, "dialog.e2ee-sheet[open]");
  const digitsU = await pageU.$$eval(".e2ee-digits li", (l) => l.map((e) => e.textContent).join(""));
  await pageA.click(".e2ee-lock");
  await has(pageA, "dialog.e2ee-sheet[open]");
  const digitsA = await pageA.$$eval(".e2ee-digits li", (l) => l.map((e) => e.textContent).join(""));
  check(/^\d{60}$/.test(digitsU) && digitsU === digitsA, "both see the same 60-digit safety number");
  await shot(pageU, "web-safety-desktop");
  await pageU.click(".e2ee-safety .pill");
  await shot(pageU, "web-safety-compared-desktop");
  await pageU.keyboard.press("Escape");
  await pageA.keyboard.press("Escape");

  // Ayşe signs in on one more device: Utku is told, and the compared mark goes.
  const { newDevice, publicDevice } = await import("../packages/e2ee/src/index.ts");
  const extra = publicDevice(newDevice(), apiA.id);
  await fetch(`${ORIGIN}/api/v1/me/e2ee/device`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiA.token}`,
      "anytogether-client": "launcher-macos/0.2.13 (macOS 26.6)",
    },
    body: JSON.stringify({ signKey: extra.signKey, boxKey: extra.boxKey, sig: extra.sig, name: "Phone" }),
  });
  check(await has(pageU, ".e2ee-changed", 15_000), "Utku sees that Ayşe's devices changed");
  await shot(pageU, "web-devices-changed-desktop");
  const afterChange = await apiU.api(`/e2ee/devices?users=${apiA.id}`, undefined, apiU.token);
  await pageU.type(".composer textarea", "Sealed for your new phone too.");
  await pageU.keyboard.press("Enter");
  await sleep(1500);
  const latest = (
    await apiU.api(`/conversations/${conversationId}/messages`, undefined, apiU.token)
  ).body.messages.at(-1);
  check(
    latest?.sealed && afterChange.body.users[0].devices.every((d) => d.id in latest.sealed.keys),
    "the next message is sealed for the new device as well",
  );

  // A phone-width look.
  const phoneU = await utku.open(`/messages?c=${conversationId}`, 390);
  await phoneU.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await has(phoneU, ".e2ee-lock.on", 20_000);
  await shot(phoneU, "web-thread-phone");
  await phoneU.click(".e2ee-lock");
  await has(phoneU, "dialog.e2ee-sheet[open]");
  await shot(phoneU, "web-safety-phone");

  // Someone on an older app: the conversation stays plain, and says so.
  const old = await apiUser(email("old"));
  await apiU.api("/me/friends/requests", { handle: old.handle }, apiU.token);
  await old.api(`/me/friends/requests/${apiU.id}/accept`, {}, old.token);
  const plainChat = (await apiU.api("/conversations", { members: [old.id] }, apiU.token)).body.id;
  const pagePlain = await utku.open(`/messages?c=${plainChat}`);
  check(await has(pagePlain, ".e2ee-line", 20_000), "a chat with an older app is labelled not encrypted");
  await pagePlain.type(".composer textarea", "Plain, as before.");
  await pagePlain.keyboard.press("Enter");
  await sleep(1500);
  const plainStored = (await old.api(`/conversations/${plainChat}/messages`, undefined, old.token)).body
    .messages;
  check(
    plainStored?.[0]?.text === "Plain, as before." && !plainStored[0].sealed,
    "the older app gets it as plain text",
  );
  await shot(pagePlain, "web-plain-desktop");

  // Reporting a sealed message sends its key: the report keeps what it said.
  const target = stored.body.messages[0];
  const pageR = await ayse.open(`/messages?c=${conversationId}`);
  await has(pageR, ".msg:not(.mine) .msg-menu button", 20_000);
  await pageR.click(".msg:not(.mine) .msg-menu button");
  await pageR.evaluate(() =>
    [...document.querySelectorAll("[role=menuitem]")].find((b) => b.textContent === "Report")?.click(),
  );
  await has(pageR, "dialog.sheet[open] .reasons");
  await shot(pageR, "web-report-desktop");
  await pageR.evaluate(() =>
    document.querySelector("dialog.sheet[open] .reasons input, dialog.sheet[open] .reasons button")?.click(),
  );
  await pageR.evaluate(() => document.querySelector("dialog.sheet[open] form button[type=submit]")?.click());
  check(
    await has(pageR, "dialog.sheet[open] .notice.success", 10_000),
    `the sealed message ${target.id.slice(0, 8)} was reported`,
  );

  const errors = [...utku.errors, ...ayse.errors];
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
