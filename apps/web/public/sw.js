/* AnyTogether's service worker: browser notifications, and a page that says "you are offline" when
 * opening the site (or the installed app) finds no connection. The only thing it caches is that one
 * static page: never a page of the site, an API answer or anything else of anyone's account. Every
 * other request goes to the network as if it were not here. */

const OFFLINE_PAGE = "/offline.html";
const CACHE = "anytogether-offline-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_PAGE, { cache: "reload" })))
      // Notifications work without the offline page.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("anytogether-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      // The page request starts while the worker wakes up, so having it costs no time.
      await self.registration.navigationPreload?.enable().catch(() => {});
      await self.clients.claim();
    })(),
  ),
);

/** Opening a page: the network's answer, always; the offline page only when there is none. */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(request));
      } catch {
        return (await caches.match(OFFLINE_PAGE)) || Response.error();
      }
    })(),
  );
});

/** A push from the API: {title, body, url, tag, unread}, already in this device's language. */
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { title: "AnyTogether", body: event.data ? event.data.text() : "" };
  }
  const url = typeof message.url === "string" && message.url.startsWith("/") ? message.url : "/notifications";
  event.waitUntil(
    (async () => {
      // Someone looking at the site already sees it there.
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (open.some((client) => client.visibilityState === "visible" && client.focused)) return;
      if (navigator.setAppBadge && typeof message.unread === "number")
        await navigator.setAppBadge(message.unread).catch(() => {});
      await self.registration.showNotification(message.title || "AnyTogether", {
        body: message.body || "",
        tag: message.tag || undefined,
        renotify: Boolean(message.tag),
        data: { url },
      });
    })(),
  );
});

/** A click opens what it is about: in a tab of the site that is already open, or a new one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (client.url !== target && "navigate" in client) await client.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/** The browser renewed the subscription: tell the API the new one (the sign-in cookie goes along). */
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    (async () => {
      const fresh = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch("/me/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The page registered this worker with its language (sw.js?lang=tr).
        body: JSON.stringify({
          ...fresh.toJSON(),
          lang: new URL(self.location.href).searchParams.get("lang") || "en",
        }),
      });
    })(),
  );
});
