import * as cheerio from "cheerio";
import type {
  ArticleSummary,
  NewsStory,
  OnThisDayEvent,
  PictureOfTheDay,
  SearchHit,
  TrendingArticle,
  WikiFeed,
  WikiImage,
} from "../../shared/types.js";
import { absoluteUrl, languageDirection, pathToTitle, resizeThumb, titleToPath, wikiLanguage } from "../../shared/wiki.js";
import { config } from "../config.js";
import { HttpError } from "../http.js";

const REQUEST_TIMEOUT_MS = 12_000;

async function wikiFetch<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": config.wikiUserAgent,
        "Api-User-Agent": config.wikiUserAgent,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new HttpError(504, "The wiki took too long to respond. Please try again.", "upstream_timeout");
    }
    throw new HttpError(502, "Could not reach the wiki. Check your connection and try again.", "upstream_unreachable");
  }

  if (response.status === 404) throw new HttpError(404, "That page does not exist on this wiki.", "not_found");
  if (response.status === 429) throw new HttpError(503, "The wiki is rate limiting requests. Try again shortly.", "upstream_busy");
  if (!response.ok) throw new HttpError(502, `The wiki responded with an error (${response.status}).`, "upstream_error");

  return (await response.json()) as T;
}

const encodeTitle = (title: string) => encodeURIComponent(titleToPath(title));

// ---- action=parse ---------------------------------------------------------

export interface ParseResult {
  title: string;
  html: string;
  revisionId: number;
  languages: { lang: string; title: string; autonym: string }[];
}

export async function fetchParsedPage(wiki: string, title: string): Promise<ParseResult> {
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "text|langlinks|revid",
    format: "json",
    formatversion: "2",
    redirects: "1",
    disableeditsection: "1",
    disabletoc: "1",
    disablelimitreport: "1",
  });

  const json = await wikiFetch<{
    parse?: {
      title: string;
      revid: number;
      text: string;
      langlinks?: { lang: string; title: string; autonym?: string; langname?: string }[];
    };
    error?: { code: string; info: string };
  }>(`https://${wiki}/w/api.php?${params}`);

  if (json.error) {
    if (json.error.code === "missingtitle" || json.error.code === "invalidtitle") {
      throw new HttpError(404, "That page does not exist on this wiki.", "not_found");
    }
    throw new HttpError(502, json.error.info || "The wiki could not render this page.", "upstream_error");
  }
  if (!json.parse?.text) throw new HttpError(502, "The wiki returned an empty page.", "upstream_error");

  return {
    title: json.parse.title,
    html: json.parse.text,
    revisionId: json.parse.revid,
    languages: (json.parse.langlinks ?? []).map((link) => ({
      lang: link.lang,
      title: link.title,
      autonym: link.autonym || link.langname || link.lang,
    })),
  };
}

// ---- REST summary ---------------------------------------------------------

interface RestSummary {
  type?: string;
  title: string;
  titles?: { normalized?: string };
  description?: string;
  extract?: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
  lang?: string;
  dir?: "ltr" | "rtl";
  timestamp?: string;
}

/** A thumbnail-CDN rendition close to `width`, never larger than the original. */
export function pickImage(summary: RestSummary, width: number): WikiImage | null {
  const original = summary.originalimage;
  const thumb = summary.thumbnail;

  if (thumb) {
    const src = resizeThumb(thumb.source, width, original?.width) ?? absoluteUrl(thumb.source)!;
    const renderedWidth = Number(src.match(/\/(?:[a-z-]+-)?(\d+)px-[^/]+$/)?.[1]) || thumb.width;
    const ratio = original ? original.height / original.width : thumb.height / thumb.width;
    return { src, width: renderedWidth, height: Math.round(renderedWidth * ratio) };
  }

  return original ? { src: absoluteUrl(original.source)!, width: original.width, height: original.height } : null;
}

export function toArticleSummary(wiki: string, summary: RestSummary): ArticleSummary {
  const lang = summary.lang || wikiLanguage(wiki);
  return {
    wiki,
    title: summary.titles?.normalized || pathToTitle(summary.title),
    description: summary.description ?? "",
    extract: summary.extract ?? "",
    thumbnail: pickImage(summary, 500)?.src ?? null,
    image: pickImage(summary, 1280),
    lang,
    dir: summary.dir || languageDirection(lang),
  };
}

export interface SummaryWithMeta {
  summary: ArticleSummary;
  lastEdited: string | null;
}

export async function fetchSummary(wiki: string, title: string): Promise<SummaryWithMeta> {
  const raw = await wikiFetch<RestSummary>(`https://${wiki}/api/rest_v1/page/summary/${encodeTitle(title)}`);
  return { summary: toArticleSummary(wiki, raw), lastEdited: raw.timestamp ?? null };
}

export async function fetchRandomSummary(wiki: string): Promise<ArticleSummary> {
  const raw = await wikiFetch<RestSummary>(`https://${wiki}/api/rest_v1/page/random/summary`);
  return toArticleSummary(wiki, raw);
}

// ---- search ---------------------------------------------------------------

interface RestSearchPage {
  title: string;
  description: string | null;
  excerpt: string | null;
  thumbnail: { url: string } | null;
}

function stripHtml(html: string): string {
  return cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim();
}

function toSearchHit(page: RestSearchPage): SearchHit {
  return {
    title: page.title,
    description: page.description ?? "",
    excerpt: page.excerpt ? stripHtml(page.excerpt) : "",
    thumbnail: resizeThumb(page.thumbnail?.url, 120),
  };
}

/** Prefix search: fast, used for typeahead. */
export async function searchTitles(wiki: string, query: string, limit = 8): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const json = await wikiFetch<{ pages: RestSearchPage[] }>(`https://${wiki}/w/rest.php/v1/search/title?${params}`);
  return json.pages.map(toSearchHit);
}

/** Full-text search with excerpts. */
export async function searchPages(wiki: string, query: string, limit = 20): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const json = await wikiFetch<{ pages: RestSearchPage[] }>(`https://${wiki}/w/rest.php/v1/search/page?${params}`);
  return json.pages.map(toSearchHit);
}

export async function fetchRelated(wiki: string, title: string): Promise<SearchHit[]> {
  const hits = await searchPages(wiki, `morelike:${title}`, 6);
  return hits.map((hit) => ({ ...hit, thumbnail: hit.thumbnail ? resizeThumb(hit.thumbnail, 330) : null }));
}

// ---- namespaces (to tell articles from File:, Category:, etc.) ------------

export async function fetchNamespacePrefixes(wiki: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    meta: "siteinfo",
    siprop: "namespaces|namespacealiases",
    format: "json",
    formatversion: "2",
  });
  const json = await wikiFetch<{
    query: {
      namespaces: Record<string, { id: number; name: string; canonical?: string }>;
      namespacealiases: { id: number; alias: string }[];
    };
  }>(`https://${wiki}/w/api.php?${params}`);

  const prefixes = new Set<string>();
  for (const ns of Object.values(json.query.namespaces)) {
    if (ns.id === 0) continue;
    if (ns.name) prefixes.add(ns.name.toLowerCase());
    if (ns.canonical) prefixes.add(ns.canonical.toLowerCase());
  }
  for (const alias of json.query.namespacealiases) prefixes.add(alias.alias.toLowerCase());
  return [...prefixes];
}

// ---- featured feed --------------------------------------------------------

interface RestFeed {
  tfa?: RestSummary;
  mostread?: { articles: (RestSummary & { views: number; rank: number; view_history?: { views: number }[] })[] };
  image?: {
    title: string;
    thumbnail: { source: string; width: number; height: number };
    image: { source: string; width: number; height: number };
    file_page: string;
    artist?: { text?: string };
    credit?: { text?: string };
    description?: { text?: string };
  };
  news?: { story: string; links: RestSummary[] }[];
  onthisday?: { text: string; year: number; pages: RestSummary[] }[];
}

const SKIPPED_TRENDING = /^(Main_Page|Special:|Wikipedia:|Portal:|Help:|File:|Talk:)/;

export async function fetchFeed(wiki: string, date: Date): Promise<WikiFeed> {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");

  const raw = await wikiFetch<RestFeed>(`https://${wiki}/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`);

  const mostRead: TrendingArticle[] = (raw.mostread?.articles ?? [])
    .filter((article) => !SKIPPED_TRENDING.test(article.title))
    .slice(0, 10)
    .map((article, index) => ({
      ...toArticleSummary(wiki, article),
      rank: index + 1,
      views: article.views,
      trend: (article.view_history ?? []).map((point) => point.views),
    }));

  let picture: PictureOfTheDay | null = null;
  if (raw.image) {
    const image = raw.image;
    picture = {
      title: pathToTitle(image.title.replace(/^File:/, "")).replace(/\.[a-z0-9]+$/i, ""),
      description: stripHtml(image.description?.text ?? ""),
      credit: stripHtml(image.artist?.text ?? image.credit?.text ?? ""),
      src: resizeThumb(image.thumbnail.source, 1920, image.image.width) ?? absoluteUrl(image.image.source)!,
      thumb: resizeThumb(image.thumbnail.source, 960, image.image.width) ?? absoluteUrl(image.thumbnail.source)!,
      width: image.image.width,
      height: image.image.height,
      filePage: image.file_page,
    };
  }

  const news: NewsStory[] = (raw.news ?? []).slice(0, 5).map((item) => ({
    story: stripHtml(item.story),
    links: item.links.slice(0, 3).map((link) => toArticleSummary(wiki, link)),
  }));

  const onThisDay: OnThisDayEvent[] = (raw.onthisday ?? []).slice(0, 8).map((event) => ({
    year: event.year,
    text: event.text,
    pages: event.pages.slice(0, 2).map((page) => toArticleSummary(wiki, page)),
  }));

  return {
    wiki,
    date: `${yyyy}-${mm}-${dd}`,
    featured: raw.tfa ? toArticleSummary(wiki, raw.tfa) : null,
    mostRead,
    picture,
    news,
    onThisDay,
  };
}
