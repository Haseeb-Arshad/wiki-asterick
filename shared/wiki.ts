/**
 * Helpers shared by the server and the client for identifying Wikimedia wikis
 * and building image URLs. Keep this file dependency-free.
 */

export const WIKI_PROJECTS = [
  "wikipedia",
  "wiktionary",
  "wikivoyage",
  "wikibooks",
  "wikiquote",
  "wikinews",
  "wikiversity",
  "wikisource",
] as const;

export type WikiProject = (typeof WIKI_PROJECTS)[number];

const HOST_PATTERN = new RegExp(
  `^([a-z][a-z0-9-]{1,19})(?:\\.m)?\\.(${WIKI_PROJECTS.join("|")})\\.org$`,
  "i"
);

/** Languages offered in the UI. Any language code works when pasted as a URL. */
export const FEATURED_LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ur", name: "اردو" },
  { code: "ar", name: "العربية" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "zh", name: "中文" },
];

const RTL_LANGUAGES = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ku", "mzn", "pnb", "ps", "sd", "ug", "ur", "yi"]);

export function languageDirection(lang: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(lang.toLowerCase()) ? "rtl" : "ltr";
}

/**
 * Accepts "en", "en.wikivoyage", "en.wikipedia.org" or "en.m.wikipedia.org"
 * and returns the canonical host ("en.wikipedia.org"), or null if unsupported.
 */
export function normalizeWikiHost(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  let host = value;
  if (/^[a-z][a-z0-9-]{1,19}$/.test(value)) host = `${value}.wikipedia.org`;
  else if (!value.endsWith(".org")) host = `${value}.org`;

  const match = host.match(HOST_PATTERN);
  if (!match) return null;
  return `${match[1]}.${match[2]}.org`.toLowerCase();
}

/** Short form used in app URLs: "en" for Wikipedia, "en.wikivoyage" otherwise. */
export function wikiSlug(host: string): string {
  const [lang, project] = host.split(".");
  return project === "wikipedia" ? lang : `${lang}.${project}`;
}

export function wikiLanguage(host: string): string {
  return host.split(".")[0];
}

export function wikiProject(host: string): WikiProject {
  return host.split(".")[1] as WikiProject;
}

/** Titles are stored with spaces; URLs use underscores. */
export function titleToPath(title: string): string {
  return title.replace(/ /g, "_");
}

export function pathToTitle(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // keep the raw value when it is not valid percent-encoding
  }
  return decoded.replace(/_/g, " ").trim();
}

export function articleKey(wiki: string, title: string): string {
  return `${wiki}:${title}`;
}

export function wikiArticleUrl(wiki: string, title: string): string {
  return `https://${wiki}/wiki/${encodeURIComponent(titleToPath(title)).replace(/%2F/g, "/").replace(/%3A/g, ":")}`;
}

/**
 * Parses any supported wiki URL ("https://de.m.wikipedia.org/wiki/Mond",
 * "en.wikipedia.org/w/index.php?title=Moon") into a host and a title.
 */
export function parseWikiUrl(raw: string): { wiki: string; title: string } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }

  const wiki = normalizeWikiHost(url.hostname);
  if (!wiki) return null;

  let title = "";
  if (url.pathname.startsWith("/wiki/")) {
    title = pathToTitle(url.pathname.slice("/wiki/".length));
  } else if (url.searchParams.get("title")) {
    title = pathToTitle(url.searchParams.get("title") || "");
  }

  if (!title) return null;
  return { wiki, title };
}

/** Thumbnail widths the Wikimedia image servers will render on demand. */
const THUMB_BUCKETS = [120, 250, 330, 500, 960, 1280, 1920];

export function snapThumbWidth(width: number, maxWidth = Infinity): number | null {
  const fitting = THUMB_BUCKETS.filter((bucket) => bucket <= maxWidth);
  if (fitting.length === 0) return null;
  return fitting.find((bucket) => bucket >= width) ?? fitting[fitting.length - 1];
}

/**
 * Rewrites a Wikimedia thumbnail URL to another standard width, always below
 * the original's width (the image servers refuse anything larger). Thumbnails
 * are served from thumb.wikimedia.org, a CDN that is faster and reachable on
 * networks where upload.wikimedia.org (originals, video) is throttled.
 * Returns the URL unchanged when it is not a thumbnail.
 */
export function resizeThumb(url: string | null | undefined, width: number, originalWidth = Infinity): string | null {
  if (!url) return null;
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  if (!absolute.includes("/thumb/")) return absolute;

  const onCdn = absolute.replace("://upload.wikimedia.org/", "://thumb.wikimedia.org/");
  const target = snapThumbWidth(width, originalWidth - 1);
  if (!target) return onCdn;

  return onCdn.replace(/\/((?:[a-z-]+-)?)(\d+)px-([^/?]+)(\?.*)?$/i, (_match, prefix, _width, file) => {
    return `/${prefix}${target}px-${file}`;
  });
}

export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}
