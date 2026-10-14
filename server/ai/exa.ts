import { config } from "../config.js";
import { HttpError } from "../http.js";

export interface WebResult {
  title: string;
  url: string;
  site: string;
  publishedDate: string | null;
  author: string | null;
  favicon: string | null;
  image: string | null;
  text: string;
}

interface ExaResult {
  title?: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  favicon?: string | null;
  image?: string | null;
  text?: string | null;
  highlights?: string[];
}

async function exa<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  if (!config.exaApiKey) throw new HttpError(503, "Web search isn't configured on this server.", "exa_missing");
  let response: Response;
  try {
    response = await fetch(`https://api.exa.ai${path}`, {
      method: "POST",
      headers: { "x-api-key": config.exaApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(504, "Web search took too long. Try again.", "exa_timeout");
  }
  if (!response.ok) throw new HttpError(502, `Web search failed (${response.status}).`, "exa_error");
  return (await response.json()) as T;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Live web search with page text, for grounding answers in fresh sources. */
export async function searchWeb(query: string, { numResults = 5, maxCharacters = 2000 } = {}): Promise<WebResult[]> {
  const json = await exa<{ results: ExaResult[] }>("/search", {
    query,
    numResults,
    type: "auto",
    contents: {
      text: { maxCharacters },
      highlights: { numSentences: 3, highlightsPerUrl: 2, query },
    },
  });

  return json.results.map((result) => ({
    title: result.title?.trim() || siteOf(result.url),
    url: result.url,
    site: siteOf(result.url),
    publishedDate: result.publishedDate ?? null,
    author: result.author ?? null,
    favicon: result.favicon ?? null,
    image: result.image ?? null,
    // Highlights are the most relevant sentences; fall back to the page text.
    text: [...(result.highlights ?? []), result.text ?? ""].join("\n").slice(0, maxCharacters),
  }));
}

/** Pages similar to a URL (used for "Keep reading" under web articles). */
export async function findSimilar(url: string, numResults = 6): Promise<WebResult[]> {
  const json = await exa<{ results: ExaResult[] }>("/findSimilar", {
    url,
    numResults,
    excludeSourceDomain: false,
    contents: { summary: { query: "One sentence describing this page." } },
  });
  return json.results
    .filter((result) => result.url !== url)
    .map((result) => ({
      title: result.title?.trim() || siteOf(result.url),
      url: result.url,
      site: siteOf(result.url),
      publishedDate: result.publishedDate ?? null,
      author: result.author ?? null,
      favicon: result.favicon ?? null,
      image: result.image ?? null,
      text: (result as ExaResult & { summary?: string }).summary ?? "",
    }));
}

/** Clean page content from Exa's crawler, used when a site blocks direct fetching. */
export async function fetchContents(url: string): Promise<{ title: string; author: string | null; publishedDate: string | null; image: string | null; html: string } | null> {
  const json = await exa<{ results: ExaResult[] }>("/contents", { urls: [url], text: { includeHtmlTags: true } }, 20_000);
  const result = json.results[0];
  if (!result?.text) return null;
  return {
    title: result.title?.trim() || siteOf(url),
    author: result.author ?? null,
    publishedDate: result.publishedDate ?? null,
    image: result.image ?? null,
    html: result.text,
  };
}
