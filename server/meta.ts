import type { Request } from "express";
import { normalizeWikiHost, pathToTitle } from "../shared/wiki.js";
import { HttpError } from "./http.js";
import { loadWebArticle } from "./web/routes.js";
import { loadWikiSummary } from "./wiki/routes.js";

/** What link previews (chat apps, social sites, search results) show for a page. */
export interface PageMeta {
  /** HTTP status to answer with; 404 for an article that doesn't exist. */
  status: number;
  title: string;
  description: string;
  image: string | null;
  /** Path and query that identify the page, for og:url and the canonical link. */
  path: string;
}

const SITE = "WikiAsterisk";

const APP_PATHS = new Set(["/", "/account", "/article", "/library", "/search", "/share", "/signin", "/signup", "/web"]);

/** True for addresses the app has a page for; anything else answers 404 (and still shows the app's own "not found"). */
export function isKnownPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return APP_PATHS.has(path) || /^\/read\/[^/]+\/.+/.test(path);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${(cut.includes(" ") ? cut.replace(/\s+\S*$/, "") : cut).trimEnd()}…`;
}

/** A passage someone shared a link to, as a description: “quote” — Article. */
function describe(quote: string, title: string, fallback: string): string {
  const passage = quote.replace(/\s+/g, " ").trim();
  return passage ? `“${clip(passage, 200)}” — ${title}` : clip(fallback, 200);
}

const httpsOnly = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : null);

/**
 * Metadata for the page being requested, or null when the generic one will do
 * (or when looking it up fails, which must never stop the app from loading).
 */
export async function pageMeta(req: Request): Promise<PageMeta | null> {
  const quote = typeof req.query.quote === "string" ? req.query.quote.slice(0, 300) : "";

  const wikiPath = req.path.match(/^\/read\/([^/]+)\/(.+)$/);
  if (wikiPath) {
    let wiki: string | null;
    let title: string;
    try {
      wiki = normalizeWikiHost(decodeURIComponent(wikiPath[1]));
      title = pathToTitle(decodeURIComponent(wikiPath[2]));
    } catch {
      return null;
    }
    if (!wiki || !title || title.length > 300) return null;
    try {
      const summary = await loadWikiSummary(wiki, title);
      const lead = [summary.description, summary.extract].filter(Boolean).join(". ");
      return {
        status: 200,
        title: `${summary.title} — ${SITE}`,
        description: describe(quote, summary.title, lead || `Read ${summary.title} in a calm, focused reader.`),
        image: httpsOnly(summary.image?.src ?? summary.thumbnail),
        path: req.originalUrl.split("#")[0],
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return { status: 404, title: `Not found — ${SITE}`, description: "There's no article with that title.", image: null, path: req.originalUrl.split("#")[0] };
      }
      return null;
    }
  }

  if (req.path === "/web" && typeof req.query.url === "string" && req.query.url) {
    try {
      const article = await loadWebArticle(req.query.url);
      return {
        status: 200,
        title: `${article.title} — ${SITE}`,
        description: describe(quote, article.title, article.description || article.extract || `Read ${article.title} in a calm, focused reader.`),
        image: httpsOnly(article.image?.src),
        path: req.originalUrl.split("#")[0],
      };
    } catch {
      return null;
    }
  }

  return null;
}

/** The app's index.html with this page's title, description and preview image filled in. */
export function injectMeta(template: string, meta: PageMeta, origin: string): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = escapeHtml(origin + meta.path);

  let html = template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/, () => `<meta name="description" content="${description}" />`)
    .replace(/<meta\s+property="og:title"[^>]*>/, () => `<meta property="og:title" content="${title}" />`)
    .replace(/<meta\s+property="og:description"[^>]*>/, () => `<meta property="og:description" content="${description}" />`)
    .replace(/<meta\s+property="og:type"[^>]*>/, () => `<meta property="og:type" content="article" />`);

  const extra = [
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<link rel="canonical" href="${url}" />`,
    meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}" />` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    meta.image ? `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  html = html.replace("</head>", () => `    ${extra}\n  </head>`);
  return html;
}
