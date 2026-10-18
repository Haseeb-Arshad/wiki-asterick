import type { ResearchExpert, ResearchLink, ResearchPaper } from "../../shared/types.js";
import { resizeThumb, snapThumbWidth } from "../../shared/wiki.js";
import { config } from "../config.js";

/*
 * Free, keyless sources for research pages:
 * - OpenAlex (openalex.org): about 250 million papers across every field, including everything in
 *   PubMed and arXiv, with abstracts, citation counts, open PDFs and the people who wrote them.
 * - Wikimedia Commons, searched through a Wikipedia's own API (file namespace), for licensed images.
 * - Hacker News (hn.algolia.com), for discussions of technical topics.
 */

const HEADERS = { "User-Agent": config.wikiUserAgent, Accept: "application/json" };

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return (await response.json()) as T;
}

const OPENALEX = "https://api.openalex.org";
// OpenAlex asks heavy users to identify themselves; optional, and never the reader's address.
const politeness = (): Record<string, string> => (process.env.OPENALEX_EMAIL ? { mailto: process.env.OPENALEX_EMAIL } : {});
const shortId = (id: string | null | undefined) => (id ?? "").replace(/^https:\/\/openalex\.org\//, "");

// ---- papers ------------------------------------------------------------------------------------------

interface OpenAlexWork {
  id: string;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number;
  doi?: string | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  primary_location?: { landing_page_url?: string | null; pdf_url?: string | null; source?: { display_name?: string | null } | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  authorships?: { author: { id: string | null; display_name: string | null } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_topic?: { id?: string | null; display_name?: string | null } | null;
}

/** OpenAlex stores abstracts as word → positions; put the words back in order. */
export function abstractFrom(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const WORK_FIELDS =
  "id,display_name,publication_year,cited_by_count,doi,open_access,primary_location,best_oa_location,authorships,abstract_inverted_index,primary_topic";

export function toPaper(work: OpenAlexWork): ResearchPaper {
  const pdfUrl = work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? null;
  return {
    id: shortId(work.id),
    title: (work.display_name ?? "Untitled").replace(/<[^>]+>/g, "").trim(),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    citedBy: work.cited_by_count ?? 0,
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author.display_name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 8),
    abstract: abstractFrom(work.abstract_inverted_index).slice(0, 1600),
    url: work.doi ?? work.primary_location?.landing_page_url ?? work.id,
    pdfUrl: pdfUrl && /^https?:\/\//.test(pdfUrl) ? pdfUrl : null,
    openAccess: Boolean(work.open_access?.is_oa),
  };
}

/** A research field as OpenAlex names it, e.g. "Hemoglobinopathies and Related Disorders". */
export interface ResearchField {
  id: string;
  name: string;
}

/** Papers on a topic, most relevant first, how many there are in all, and each paper's field. */
export async function searchPapers(query: string, limit = 25): Promise<{ papers: ResearchPaper[]; count: number; fields: Map<string, ResearchField> }> {
  const json = await getJson<{ meta: { count: number }; results: OpenAlexWork[] }>(
    `${OPENALEX}/works?${new URLSearchParams({ search: query, "per-page": String(limit), select: WORK_FIELDS, ...politeness() })}`
  );
  const fields = new Map<string, ResearchField>();
  for (const work of json.results) {
    if (work.primary_topic?.id) fields.set(shortId(work.id), { id: shortId(work.primary_topic.id), name: work.primary_topic.display_name ?? "" });
  }
  return { papers: json.results.map(toPaper), count: json.meta.count, fields };
}

/** The field most of these papers belong to, when at least a few of them agree. */
export function dominantField(paperIds: string[], fields: Map<string, ResearchField>, atLeast = 2): ResearchField | null {
  const counts = new Map<string, { field: ResearchField; count: number }>();
  for (const id of paperIds) {
    const field = fields.get(id);
    if (!field) continue;
    const entry = counts.get(field.id) ?? { field, count: 0 };
    entry.count += 1;
    counts.set(field.id, entry);
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return best && best.count >= atLeast ? best.field : null;
}

// ---- researchers --------------------------------------------------------------------------------------

const MIN_H_INDEX = 10;

interface OpenAlexAuthor {
  id: string;
  display_name: string;
  orcid?: string | null;
  cited_by_count?: number;
  summary_stats?: { h_index?: number } | null;
  last_known_institutions?: { display_name?: string }[] | null;
}

/**
 * The leading researchers in a field: of the people who publish most in it, the ones whose work
 * is most cited (h-index), each with their most cited paper in the field and who they most often
 * write with.
 */
export async function fieldLeaders(field: ResearchField, limit = 6): Promise<ResearchExpert[]> {
  const grouped = await getJson<{ group_by: { key: string; key_display_name: string; count: number }[] }>(
    `${OPENALEX}/works?${new URLSearchParams({ filter: `primary_topic.id:${field.id}`, group_by: "authorships.author.id", ...politeness() })}`
  );
  const prolific = grouped.group_by.filter((group) => group.key && group.key !== "unknown").slice(0, 20);
  if (!prolific.length) return [];
  const counts = new Map(prolific.map((group) => [shortId(group.key), group.count]));

  const details = await getJson<{ results: OpenAlexAuthor[] }>(
    `${OPENALEX}/authors?${new URLSearchParams({
      filter: `openalex:${[...counts.keys()].join("|")}`,
      select: "id,display_name,orcid,cited_by_count,summary_stats,last_known_institutions",
      "per-page": "20",
      ...politeness(),
    })}`
  );
  // An h-index under 10 says too little to call someone a leader (and in thin data it is often a
  // mis-merged or mis-attributed author), so they're left out.
  const leaders = details.results
    .filter((author) => (author.summary_stats?.h_index ?? 0) >= MIN_H_INDEX)
    .sort((a, b) => (b.summary_stats?.h_index ?? 0) - (a.summary_stats?.h_index ?? 0))
    .slice(0, limit);

  const topWorks = await Promise.all(
    leaders.map((author) =>
      getJson<{ results: OpenAlexWork[] }>(
        `${OPENALEX}/works?${new URLSearchParams({
          filter: `primary_topic.id:${field.id},authorships.author.id:${shortId(author.id)}`,
          sort: "cited_by_count:desc",
          "per-page": "5",
          select: WORK_FIELDS,
          ...politeness(),
        })}`
      )
        .then((json) => json.results)
        .catch(() => [] as OpenAlexWork[])
    )
  );

  return leaders.map((author, index) => {
    const id = shortId(author.id);
    const works = topWorks[index];
    const best = works[0] ? toPaper(works[0]) : null;
    // Co-authors across their most cited papers in the field.
    const together = new Map<string, number>();
    for (const work of works) {
      for (const authorship of work.authorships ?? []) {
        const name = authorship.author.display_name;
        if (!name || shortId(authorship.author.id) === id) continue;
        together.set(name, (together.get(name) ?? 0) + 1);
      }
    }
    return {
      id,
      name: author.display_name,
      institution: author.last_known_institutions?.[0]?.display_name ?? null,
      worksOnTopic: counts.get(id) ?? 0,
      hIndex: author.summary_stats?.h_index ?? null,
      citedBy: author.cited_by_count ?? 0,
      orcid: author.orcid ?? null,
      topPaper: best ? { title: best.title, year: best.year, url: best.url, pdfUrl: best.pdfUrl } : null,
      collaborators: [...together.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name),
    };
  });
}

// ---- images -----------------------------------------------------------------------------------------

/** An image found for a topic, before it is checked for relevance. */
export interface ImageCandidate {
  title: string;
  description: string;
  credit: string;
  license: string;
  filePage: string;
  width: number;
  height: number;
  /** About 500 px wide, for the page. */
  src: string;
  /** Short side of 260 px or more, for the decision model to look at; null when no thumbnail is big enough. */
  judgeSrc: string | null;
}

interface ImageInfoPage {
  title: string;
  imageinfo?: {
    url: string;
    thumburl?: string;
    descriptionurl?: string;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

const stripTags = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Licensed images from Wikimedia Commons for each search term, through a Wikipedia's API (its file
 * search includes Commons). Photos and diagrams only: no PDFs, audio, video or panoramas.
 */
export async function searchImages(terms: string[], wiki: string, perTerm = 12): Promise<ImageCandidate[]> {
  const pages = await Promise.all(
    terms.map((term) =>
      getJson<{ query?: { pages?: ImageInfoPage[] } }>(
        `https://${wiki}/w/api.php?${new URLSearchParams({
          action: "query",
          generator: "search",
          gsrsearch: term,
          gsrnamespace: "6",
          gsrlimit: String(perTerm),
          prop: "imageinfo",
          iiprop: "url|size|mime|extmetadata",
          iiurlwidth: "330",
          iiextmetadatafilter: "ImageDescription|Artist|LicenseShortName|ObjectName",
          format: "json",
          formatversion: "2",
        })}`
      )
        .then((json) => json.query?.pages ?? [])
        .catch(() => [] as ImageInfoPage[])
    )
  );

  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];
  for (const page of pages.flat()) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp|svg\+xml|gif)$/.test(info.mime) || seen.has(page.title)) continue;
    const ratio = info.width / Math.max(1, info.height);
    if (ratio > 3.2 || ratio < 0.3 || Math.min(info.width, info.height) < 250) continue;
    seen.add(page.title);
    // The model rejects images whose short side is under about 244 px. Thumbnails come in fixed
    // widths no larger than the original, so work out the size actually served.
    const wanted = Math.ceil(ratio >= 1 ? 300 * ratio : 300);
    const served = snapThumbWidth(wanted, info.width - 1) ?? info.width;
    const shortSide = ratio >= 1 ? served / ratio : served;
    const meta = info.extmetadata ?? {};
    candidates.push({
      title: stripTags(meta.ObjectName?.value ?? "") || page.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      description: stripTags(meta.ImageDescription?.value ?? "").slice(0, 300),
      credit: stripTags(meta.Artist?.value ?? "").slice(0, 120),
      license: stripTags(meta.LicenseShortName?.value ?? ""),
      filePage: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      width: info.width,
      height: info.height,
      src: resizeThumb(info.thumburl, 500, info.width) ?? info.thumburl,
      judgeSrc: shortSide >= 260 ? (resizeThumb(info.thumburl, wanted, info.width) ?? info.thumburl) : null,
    });
  }
  return candidates;
}

/** An image as inline data, which is how the decision model takes images. Null when it can't be used. */
export async function imageAsData(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": config.wikiUserAgent }, signal: AbortSignal.timeout(6000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|jpeg)/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1_500_000) return null;
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

// ---- discussions -----------------------------------------------------------------------------------

interface HnHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
}

/** Hacker News stories about a topic, with their votes and comment counts. */
export async function searchDiscussions(query: string, limit = 10): Promise<ResearchLink[]> {
  const json = await getJson<{ hits: HnHit[] }>(`https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query, tags: "story", hitsPerPage: String(limit) })}`);
  return json.hits
    .filter((hit) => hit.title)
    .map((hit) => {
      const threadUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const url = hit.url || threadUrl;
      let site = "news.ycombinator.com";
      try {
        site = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // keep the default
      }
      return {
        title: hit.title!,
        url,
        site,
        description: "",
        image: null,
        publishedDate: hit.created_at ?? null,
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        threadUrl,
      };
    });
}
