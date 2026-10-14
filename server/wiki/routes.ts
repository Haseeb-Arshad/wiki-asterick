import { Router, type Request } from "express";
import type { ArticleSummary, SearchHit, WikiArticle, WikiFeed } from "../../shared/types.js";
import { normalizeWikiHost, parseWikiUrl, pathToTitle } from "../../shared/wiki.js";
import { HttpError, TtlCache, asyncHandler, memoizeAsync, rateLimit } from "../http.js";
import { readPayload, sendPayload, toPayload, type Payload } from "../payload.js";
import {
  fetchFeed,
  fetchNamespacePrefixes,
  fetchParsedPage,
  fetchRandomSummary,
  fetchRelated,
  fetchSummary,
  searchPages,
  searchTitles,
} from "./api.js";
import { buildArticle } from "./parser.js";

function readWiki(req: Request): string {
  const wiki = normalizeWikiHost(String(req.query.wiki ?? "en"));
  if (!wiki) throw new HttpError(400, "That wiki is not supported. Try a Wikipedia or other Wikimedia link.", "bad_wiki");
  return wiki;
}

function readTitle(req: Request): string {
  const raw = typeof req.query.title === "string" ? req.query.title : "";
  const title = pathToTitle(raw);
  if (!title || title.length > 300) throw new HttpError(400, "Article title is required.", "bad_title");
  return title;
}

/** Accepts either ?url=<wiki url> or ?wiki=en&title=Moon. */
function readArticleTarget(req: Request): { wiki: string; title: string } {
  if (typeof req.query.url === "string" && req.query.url) {
    const target = parseWikiUrl(req.query.url);
    if (!target) throw new HttpError(400, "Use a link to a Wikipedia (or other Wikimedia) article.", "bad_url");
    return target;
  }
  return { wiki: readWiki(req), title: readTitle(req) };
}

// ---- cached loaders -------------------------------------------------------

const MINUTE = 60_000;

const namespaces = memoizeAsync(new TtlCache<string[]>(300, 24 * 60 * MINUTE), (wiki) => fetchNamespacePrefixes(wiki));

const articles = memoizeAsync(new TtlCache<Payload>(80, 30 * MINUTE), async (key) => {
  const [wiki, ...rest] = key.split("|");
  const title = rest.join("|");

  const [parsed, summary, prefixes] = await Promise.all([
    fetchParsedPage(wiki, title),
    fetchSummary(wiki, title).catch(() => null),
    namespaces(wiki).catch(() => [] as string[]),
  ]);

  const article = buildArticle({
    wiki,
    title: parsed.title,
    html: parsed.html,
    revisionId: parsed.revisionId,
    languages: parsed.languages,
    summary: summary?.summary ?? null,
    lastEdited: summary?.lastEdited ?? null,
    namespaces: prefixes,
  });
  return toPayload(article);
});

/** The parsed article, from the same cache the reader uses (for AI context). */
export async function loadWikiArticle(wiki: string, title: string): Promise<WikiArticle> {
  return readPayload<WikiArticle>(await articles(`${wiki}|${title}`));
}

const summaries =memoizeAsync(new TtlCache<Payload>(1000, 30 * MINUTE), async (key) => {
  const [wiki, title] = key.split("|");
  const { summary } = await fetchSummary(wiki, title);
  return toPayload(summary satisfies ArticleSummary);
});

const searches = memoizeAsync(new TtlCache<Payload>(500, 10 * MINUTE), async (key) => {
  const [mode, wiki, ...rest] = key.split("|");
  const query = rest.join("|");
  const hits: SearchHit[] = mode === "full" ? await searchPages(wiki, query) : await searchTitles(wiki, query);
  return toPayload(hits);
});

const related = memoizeAsync(new TtlCache<Payload>(300, 60 * MINUTE), async (key) => {
  const [wiki, title] = key.split("|");
  return toPayload(await fetchRelated(wiki, title));
});

const feeds = memoizeAsync(new TtlCache<Payload>(60, 30 * MINUTE), async (key) => {
  const [wiki, date] = key.split("|");
  const day = new Date(`${date}T12:00:00Z`);
  let feed: WikiFeed;
  try {
    feed = await fetchFeed(wiki, day);
  } catch (error) {
    // Early in the UTC day a wiki may not have published today's feed yet.
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    feed = await fetchFeed(wiki, new Date(day.getTime() - 24 * 60 * MINUTE));
  }
  return toPayload(feed);
});

// ---- routes ---------------------------------------------------------------

export const wikiRouter = Router();

wikiRouter.use(
  rateLimit({
    windowMs: MINUTE,
    max: 240,
    message: "You're making requests very quickly. Wait a moment and try again.",
  })
);

wikiRouter.get(
  "/article",
  asyncHandler(async (req, res) => {
    const { wiki, title } = readArticleTarget(req);
    sendPayload(req, res, await articles(`${wiki}|${title}`), 300);
  })
);

wikiRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    sendPayload(req, res, await summaries(`${readWiki(req)}|${readTitle(req)}`), 1800);
  })
);

wikiRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const wiki = readWiki(req);
    const query = String(req.query.q ?? "").trim().slice(0, 200);
    const mode = req.query.mode === "full" ? "full" : "title";
    if (!query) {
      res.json([]);
      return;
    }
    sendPayload(req, res, await searches(`${mode}|${wiki}|${query}`), 600);
  })
);

wikiRouter.get(
  "/related",
  asyncHandler(async (req, res) => {
    sendPayload(req, res, await related(`${readWiki(req)}|${readTitle(req)}`), 3600);
  })
);

wikiRouter.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const wiki = readWiki(req);
    if (!wiki.endsWith(".wikipedia.org")) throw new HttpError(404, "Daily highlights are only available for Wikipedia.", "no_feed");

    const requested = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    const date = requested ?? new Date().toISOString().slice(0, 10);
    sendPayload(req, res, await feeds(`${wiki}|${date}`), 1800);
  })
);

wikiRouter.get(
  "/random",
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await fetchRandomSummary(readWiki(req)));
  })
);
