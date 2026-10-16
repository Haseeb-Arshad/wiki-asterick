// WikiAsterisk service worker: keeps the app opening offline and holds saved articles.
//
// - The app shell and built files are cached as they're used, so the app starts offline.
// - Articles you save are stored (text and images) in a separate cache that survives updates.
// - Everything else (accounts, library sync, AI, search, the home feed) always goes to the network.

const VERSION = "v1";
const STATIC = `wa-static-${VERSION}`;
const OFFLINE = "wa-offline-v1"; // saved articles and their images; never cleared by an update
const SHELL = "/";
const MAX_IMAGES = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.add(new Request(SHELL, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("wa-static-") && name !== STATIC).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

const isArticleApi = (url) => url.pathname === "/api/wiki/article" || url.pathname === "/api/web/article";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isArticleApi(url)) {
      event.respondWith(articleResponse(request));
    } else if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") {
      // Network only.
    } else if (request.mode === "navigate") {
      event.respondWith(navigationResponse(request));
    } else if (url.pathname.startsWith("/assets/")) {
      event.respondWith(staticResponse(request, false));
    } else if (/^\/(FONTT|icons)\//.test(url.pathname) || /\.(?:svg|webmanifest)$/.test(url.pathname)) {
      event.respondWith(staticResponse(request, true));
    }
    return;
  }

  if (request.destination === "image") event.respondWith(imageResponse(request));
});

/** Saved articles are kept fresh while online and served from the cache when the network fails. */
async function articleResponse(request) {
  const offline = await caches.open(OFFLINE);
  try {
    const response = await fetch(request);
    if (response.ok && (await offline.match(request, { ignoreVary: true }))) {
      await offline.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const saved = await offline.match(request, { ignoreVary: true });
    if (saved) return saved;
    throw error;
  }
}

/** Pages load from the network; offline they fall back to the cached app shell, which routes itself. */
async function navigationResponse(request) {
  const cache = await caches.open(STATIC);
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.includes("text/html")) await cache.put(SHELL, response.clone());
    return response;
  } catch (error) {
    const shell = await cache.match(SHELL);
    if (shell) return shell;
    throw error;
  }
}

/** Built files are cached for good; fonts and icons are refreshed quietly in the background. */
async function staticResponse(request, revalidate) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const refresh = () =>
    fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
  if (cached) {
    if (revalidate) refresh().catch(() => undefined);
    return cached;
  }
  return refresh();
}

/** Images of saved articles come from the cache; every other image loads as usual. */
async function imageResponse(request) {
  const offline = await caches.open(OFFLINE);
  const saved = await offline.match(request.url, { ignoreVary: true });
  return saved || fetch(request);
}

// ---- saving and forgetting articles -----------------------------------------------------

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (payload) => event.ports && event.ports[0] && event.ports[0].postMessage(payload);
  if (data.type === "save-offline") {
    event.waitUntil(saveArticle(data, reply).then((images) => reply({ ok: true, stage: "done", images }), () => reply({ ok: false })));
  } else if (data.type === "forget-offline") {
    event.waitUntil(caches.open(OFFLINE).then((cache) => cache.delete(data.article, { ignoreVary: true })).then(() => reply({ ok: true }), () => reply({ ok: false })));
  }
});

// Replies twice: as soon as the article text is stored (the page can confirm then), and when the images
// are done. A page with many images can take a while, and the text is what makes it readable offline.
async function saveArticle({ article, images = [] }, reply) {
  const offline = await caches.open(OFFLINE);
  const request = new Request(article, { headers: { "x-wa-request": "1" }, credentials: "same-origin" });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`article ${response.status}`);
  await offline.put(request, response);
  reply({ ok: true, stage: "text" });

  // Images are best effort: a few failing never blocks the text. Only readable (CORS) copies are
  // stored, since opaque ones count hugely against the storage quota.
  let saved = 0;
  const queue = images.slice(0, 80);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let src = queue.shift(); src; src = queue.shift()) {
        try {
          if (await offline.match(src, { ignoreVary: true })) continue;
          const image = await fetch(src, { mode: "cors" });
          if (image.ok) {
            await offline.put(src, image);
            saved += 1;
          }
        } catch {
          // Skip this image.
        }
      }
    })
  );
  await trimImages(offline);
  return saved;
}

/** Keeps the image count bounded by dropping the oldest ones. */
async function trimImages(cache) {
  const keys = (await cache.keys()).filter((key) => !new URL(key.url).pathname.startsWith("/api/") || new URL(key.url).origin !== self.location.origin);
  const extra = keys.length - MAX_IMAGES;
  for (let index = 0; index < extra; index += 1) await cache.delete(keys[index]);
}
