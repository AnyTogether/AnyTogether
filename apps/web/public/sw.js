/* AnyTogether's service worker: browser notifications only. It caches nothing and never touches
 * the site's requests. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
