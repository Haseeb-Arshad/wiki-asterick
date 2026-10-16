import { useSyncExternalStore } from "react";
import type { WikiArticle, WikiSection } from "../../shared/types";
import { articlePath, webArticlePath } from "./queries";

/** Saved articles and their images live here; the service worker (public/sw.js) reads the same cache. */
export const OFFLINE_CACHE = "wa-offline-v1";

/** Offline reading needs the service worker, which only runs in the production build. */
export const offlineSupported =
  import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";

export function registerServiceWorker() {
  if (!offlineSupported) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

/** Where a page's article data is requested from (and so where its offline copy is stored). */
export function articleRequestPath(article: Pick<WikiArticle, "wiki" | "title">, webUrl?: string): string {
  return webUrl ? webArticlePath(webUrl) : articlePath(article.wiki, article.title);
}

/** The request path of a saved item (wiki article or web page), as stored for offline reading. */
export function refRequestPath(ref: { wiki: string; title: string; url?: string | null }): string {
  return ref.wiki.startsWith("web:") && ref.url ? webArticlePath(ref.url) : articlePath(ref.wiki, ref.title);
}

// ---- which articles are saved offline ---------------------------------------------------------

let keys: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<() => void>();

function setKeys(next: Set<string>) {
  keys = next;
  listeners.forEach((listener) => listener());
}

async function refreshKeys() {
  if (!offlineSupported) return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const found = new Set<string>();
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.origin === location.origin && /^\/api\/(wiki|web)\/article$/.test(url.pathname)) found.add(url.pathname + url.search);
    }
    setKeys(found);
  } catch {
    // Storage can be blocked; nothing is marked offline.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    void refreshKeys();
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The request paths of every article saved for offline reading. */
export function useOfflineKeys(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => keys,
    () => keys
  );
}

// ---- saving and forgetting ----------------------------------------------------------------------

type WorkerReply = { ok: boolean; images?: number };

async function askWorker(message: Record<string, unknown>, timeoutMs: number): Promise<WorkerReply> {
  if (!offlineSupported) return { ok: false };
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((resolve) => setTimeout(resolve, 3000))]);
  const worker = registration?.active;
  if (!worker) return { ok: false };
  return new Promise<WorkerReply>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as WorkerReply);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function sectionImages(sections: WikiSection[], into: Set<string>) {
  const parser = new DOMParser();
  for (const section of sections) {
    for (const image of parser.parseFromString(section.html, "text/html").querySelectorAll("img[src]")) {
      const src = image.getAttribute("src");
      if (src && /^https:\/\//.test(src)) into.add(src);
    }
    sectionImages(section.subsections, into);
  }
}

/** Every Wikimedia image the article shows, so it still looks right without a connection. */
export function articleImages(article: WikiArticle): string[] {
  const found = new Set<string>();
  if (article.image?.src && /^https:\/\//.test(article.image.src)) found.add(article.image.src);
  sectionImages(article.sections, found);
  return [...found].filter((src) => /^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(src));
}

/** Stores the article and its images for offline reading. Resolves true when the text is safely stored. */
export async function saveArticleOffline(article: WikiArticle, webUrl?: string): Promise<boolean> {
  const path = articleRequestPath(article, webUrl);
  const reply = await askWorker({ type: "save-offline", article: path, images: article.kind === "web" ? [] : articleImages(article) }, 45_000);
  if (reply.ok) await refreshKeys();
  return reply.ok;
}

export async function forgetArticleOffline(article: Pick<WikiArticle, "wiki" | "title">, webUrl?: string): Promise<void> {
  await askWorker({ type: "forget-offline", article: articleRequestPath(article, webUrl) }, 10_000);
  await refreshKeys();
}
