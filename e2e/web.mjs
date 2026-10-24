// The website in headless Chrome: one browser context per person, signed in through the real
// login form, with Chrome's fake microphone for voice.
import puppeteer from "puppeteer-core";

export async function launchBrowser(executablePath) {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
    ],
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A person on the website: their own browser context (cookies), pages opened in it. */
export class WebUser {
  constructor(browser, origin, name) {
    this.browser = browser;
    this.origin = origin;
    this.name = name;
    this.errors = [];
  }

  async open(path = "/", width = 1280) {
    if (!this.context) this.context = await this.browser.createBrowserContext();
    const page = await this.context.newPage();
    page.on("pageerror", (error) => this.errors.push(`${this.name} pageerror: ${error.message}`));
    await page.setViewport({ width, height: 900 });
    await page.setCookie({ name: "lang", value: "en", url: this.origin });
    await page.goto(this.origin + path, { waitUntil: "networkidle0" });
    return page;
  }

  /** The login form: email, then the code from the API's log. */
  async signIn(email, codeFor) {
    const page = await this.open("/login");
    await page.type("#email", email);
    await page.click("form.card button[type=submit]");
    await page.waitForSelector("#code", { timeout: 15_000 });
    await page.type("#code", await codeFor(email));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30_000 }).catch(() => undefined),
      page.click("form.card button[type=submit]"),
    ]);
    this.page = page;
    return page;
  }

  /** The website's own API routes (the ones its pages call), with this person's cookies. */
  async fetch(path, init = {}) {
    const page = this.page ?? (await this.open("/"));
    return page.evaluate(
      async (path, init) => {
        const response = await fetch(path, {
          ...init,
          headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        });
        const text = await response.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        return { status: response.status, body };
      },
      path,
      init,
    );
  }
}

export const has = (page, selector, ms = 10_000) =>
  page.waitForSelector(selector, { timeout: ms }).then(
    () => true,
    () => false,
  );
export const gone = (page, selector, ms = 10_000) =>
  page
    .waitForFunction((s) => !document.querySelector(s), { timeout: ms }, selector)
    .then(
      () => true,
      () => false,
    );
/** Waits until `fn` (run in the page with `args`) is truthy; false after `ms`. */
export const until = (page, fn, args = [], ms = 10_000) =>
  page.waitForFunction(fn, { timeout: ms, polling: 200 }, ...args).then(
    () => true,
    () => false,
  );
export const textOf = (page, selector) => page.$eval(selector, (e) => e.textContent).catch(() => "");
