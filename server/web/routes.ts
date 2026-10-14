import { Router, type Request } from "express";
import type { WikiArticle } from "../../shared/types.js";
import { parseWikiUrl } from "../../shared/wiki.js";
import { fetchContents, findSimilar } from "../ai/exa.js";
import { config } from "../config.js";
import { HttpError, TtlCache, asyncHandler, memoizeAsync, rateLimit } from "../http.js";
import { readPayload, sendPayload, toPayload, type Payload } from "../payload.js";
import { assemble, buildWebArticle, readMeta } from "./extract.js";
import { assertFetchableUrl, fetchPublicPage } from "./safe-fetch.js";

const MINUTE = 60_000;
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|r$|s$|triedRedirect$)/i;

/** One cache key per article: no fragment, no tracking parameters. */
export function canonicalUrl(raw: string): string {
  const url = assertFetchableUrl(raw.trim());
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  return url.toString();
}

async function extractWithExa(url: string): Promise<WikiArticle | null> {
  if (!config.exaApiKey) return null;
  const contents = await fetchContents(url).catch(() => null);
  if (!contents || contents.html.replace(/<[^>]+>/g, "").trim().length < 300) return null;
  return assemble({
    title: contents.title,
    contentHtml: contents.html,
    url,
    description: "",
    image: contents.image,
    site: "",
    byline: contents.author ?? "",
    published: contents.publishedDate,
    lang: "en",
  });
}

const webArticles = memoizeAsync(new TtlCache<Payload>(60, 30 * MINUTE), async (url) => {
  let article: WikiArticle | null = null;
  let failure: unknown = null;

  try {
    const page = await fetchPublicPage(url);
    article = buildWebArticle({ html: page.body, url: page.url });
    if (article && !article.image) {
      // Keep the share image even when reader mode drops it.
      article.image = readMeta(page.body, page.url).image ? { src: readMeta(page.body, page.url).image!, width: 0, height: 0 } : null;
    }
  } catch (error) {
    failure = error;
    // Addresses we refuse to fetch must not be fetched by Exa either.
    if (error instanceof HttpError && ["blocked_host", "bad_url", "not_found", "not_html"].includes(error.code ?? "")) throw error;
  }

  // Sites that block bots, or pages reader mode can't parse: try Exa's crawl.
  article ??= await extractWithExa(url);
  if (!article) {
    if (failure instanceof HttpError) throw failure;
    throw new HttpError(422, "Couldn't find an article on that page.", "no_article");
  }
  return toPayload(article);
});

export async function loadWebArticle(url: string): Promise<WikiArticle> {
  return readPayload<WikiArticle>(await webArticles(canonicalUrl(url)));
}

const similar = memoizeAsync(new TtlCache<Payload>(200, 60 * MINUTE), async (url) => {
  const results = await findSimilar(url, 6);
  return toPayload(results.map((result) => ({ title: result.title, url: result.url, site: result.site, description: result.text })));
});

function readUrl(req: Request): string {
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!raw) throw new HttpError(400, "Add a link to open.", "bad_url");
  const url = canonicalUrl(raw);
  if (parseWikiUrl(url)) throw new HttpError(400, "That's a wiki article; open it in the wiki reader.", "is_wiki");
  return url;
}

export const webRouter = Router();

webRouter.use(
  rateLimit({
    windowMs: MINUTE,
    max: 30,
    message: "You're opening links very quickly. Wait a moment and try again.",
  })
);

webRouter.get(
  "/article",
  asyncHandler(async (req, res) => {
    sendPayload(req, res, await webArticles(readUrl(req)), 600);
  })
);

webRouter.get(
  "/similar",
  asyncHandler(async (req, res) => {
    if (!config.exaApiKey) {
      res.json([]);
      return;
    }
    sendPayload(req, res, await similar(readUrl(req)), 3600);
  })
);
