import type { ResearchExpert, ResearchImage, ResearchLink, ResearchPage, ResearchPaper, SearchHit } from "../../shared/types.js";
import { decide as defaultDecide, decideEach, decideEachImage, decisionsEnabled, type Decide } from "../ai/decisions.js";
import { searchWeb } from "../ai/exa.js";
import { config } from "../config.js";
import { fetchSummary, searchPages } from "../wiki/api.js";
import { dominantField, fieldLeaders, imageAsData, searchDiscussions, searchImages, searchPapers, type ImageCandidate, type ResearchField } from "./sources.js";

/*
 * A research page for a topic: the closest Wikipedia articles, the papers in the archives (with
 * readable PDFs where they're open), the people who publish most on it, licensed images, articles
 * from the web and discussions. Everything is fetched in parallel; then the decision model checks
 * each list for relevance (it looks at the images themselves), and only what passes is shown.
 */

/** Keep an item when the model thinks it is at least this likely to be on topic. */
const RELEVANT = 0.5;
/**
 * Images of the topic's main subjects help even when they aren't about the topic itself (photos of sickled
 * cells on a page about gene therapy for sickle cell disease scored 0.38 to 0.58; unrelated charts and
 * diagrams 0.33 or less), so images need less.
 */
const RELEVANT_IMAGE = 0.35;
/** Discussions are noisier; ask for more. */
const RELEVANT_DISCUSSION = 0.6;

export interface ResearchDeps {
  decide?: Decide;
  /** Whether to use the decision model (defaults to the server's setting). */
  check?: boolean;
  /** Overridable for tests. */
  sources?: Partial<Sources>;
}

interface Sources {
  articles: (wiki: string, query: string) => Promise<SearchHit[]>;
  summary: typeof fetchSummary;
  papers: typeof searchPapers;
  experts: typeof fieldLeaders;
  images: typeof searchImages;
  imageData: typeof imageAsData;
  web: (query: string) => Promise<ResearchLink[]>;
  discussions: typeof searchDiscussions;
}

const defaultSources: Sources = {
  articles: (wiki, query) => searchPages(wiki, query, 8),
  summary: fetchSummary,
  papers: searchPapers,
  experts: fieldLeaders,
  images: searchImages,
  imageData: imageAsData,
  web: async (query) => {
    if (!config.exaApiKey) return [];
    const results = await searchWeb(query, { numResults: 8, maxCharacters: 400 });
    return results.map((result) => ({
      title: result.title,
      url: result.url,
      site: result.site,
      description: result.text.replace(/\s+/g, " ").trim().slice(0, 280),
      image: result.image,
      publishedDate: result.publishedDate,
    }));
  },
  discussions: searchDiscussions,
};

const settle = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
  promise.catch((error) => {
    console.error("[research]", error instanceof Error ? error.message : error);
    return fallback;
  });

/** Titles compared loosely: case, punctuation and spacing don't count. */
const titleKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Several files of one subject differ only by a trailing number ("Fountain in Mostar 02", "... (41124064215)"). */
const imageKey = (title: string) => titleKey(title).replace(/( \d+)+$/, "");

/** The same paper often appears twice (a preprint and the journal version, or two editions); keep the most cited. */
export function uniquePapers(papers: ResearchPaper[]): ResearchPaper[] {
  const best = new Map<string, ResearchPaper>();
  for (const paper of papers) {
    const key = titleKey(paper.title);
    const seen = best.get(key);
    if (!seen || paper.citedBy > seen.citedBy || (!seen.pdfUrl && paper.pdfUrl && paper.citedBy === seen.citedBy)) best.set(key, paper);
  }
  return papers.filter((paper) => best.get(titleKey(paper.title)) === paper);
}

/** Items whose probability of being on topic is high enough; the original order is kept. */
const keep = <T>(items: T[], scores: number[] | null, threshold = RELEVANT): T[] => (scores ? items.filter((_, index) => (scores[index] ?? 1) >= threshold) : items);

export async function buildResearch(query: string, wiki: string, deps: ResearchDeps = {}): Promise<ResearchPage> {
  const decide = deps.decide ?? defaultDecide;
  const check = deps.check ?? decisionsEnabled();
  const source: Sources = { ...defaultSources, ...deps.sources };
  const topic = query.trim();

  // Ask the decision model which items of a list are on topic, in one batched request.
  const relevance = async (task: string, kind: string, items: string[]): Promise<number[] | null> => {
    if (!check || !items.length) return null;
    try {
      return await decideEach(
        task,
        `${kind} found for a research page about "${topic}", numbered:`,
        items,
        {
          instructions: (n) => `Is item ${n} directly about ${topic}, and useful to someone researching it (not just a passing mention, an advert or an unrelated page)?`,
          criteria: { true: "On topic and useful", false: "Off topic, a passing mention, or not useful" },
        },
        { decide, timeoutMs: 6000 }
      );
    } catch (error) {
      console.error(`[research] ${task}:`, error instanceof Error ? error.message : error);
      return null;
    }
  };

  // Each source runs its own fetch-then-check pipeline, all at the same time, so the page takes as
  // long as the slowest one rather than the sum of them.
  const hitsTask = settle(source.articles(wiki, topic), [] as SearchHit[]);

  const articlesTask = hitsTask.then(async (hits) => {
    const scores = await relevance("research articles", "Wikipedia articles", hits.map((hit) => `${hit.title}${hit.description ? `: ${hit.description}` : ""}`));
    const articles = keep(hits, scores);
    const lead = articles[0] ?? null;
    const overview = lead ? await settle(source.summary(wiki, lead.title).then((result) => result.summary), null) : null;
    return { articles, overview, checked: scores !== null };
  });

  // Images for the topic and its closest articles; the model judges every one by looking at it.
  const imagesTask = hitsTask.then(async (hits) => {
    const terms = [topic, ...hits.slice(0, 3).map((hit) => hit.title)].filter((term, index, all) => all.indexOf(term) === index);
    const candidates = await settle(source.images(terms, wiki), [] as ImageCandidate[]);
    return pickImages(topic, candidates.slice(0, 24), check, decide, source.imageData);
  });

  const papersTask = settle(source.papers(topic), { papers: [] as ResearchPaper[], count: 0, fields: new Map<string, ResearchField>() }).then(async (result) => {
    const scores = await relevance(
      "research papers",
      "Research papers",
      result.papers.map((paper) => `${paper.title}${paper.year ? ` (${paper.year})` : ""}${paper.abstract ? `. ${paper.abstract.slice(0, 260)}` : ""}`)
    );
    const relevant = keep(result.papers, scores);
    const field = await chooseField(topic, result.fields, relevant, check, decide);
    return { papers: uniquePapers(relevant).slice(0, 12), count: result.count, checked: scores !== null, field };
  });

  // The leading researchers in that field, kept when their own most cited paper really is in it
  // (thin data, mostly in the humanities, sometimes credits a paper to the wrong person).
  const expertsTask = papersTask.then(async ({ field }) => {
    if (!field) return [] as ResearchExpert[];
    const people = (await settle(source.experts(field), [] as ResearchExpert[])).filter((person) => person.topPaper);
    if (!check || !people.length) return people;
    try {
      const scores = await decideEach(
        "research experts",
        `Researchers listed as leaders in the field "${field.name}", each with their most cited paper in it, numbered:`,
        people.map((person) => `${person.name}: "${person.topPaper!.title}"${person.topPaper!.year ? ` (${person.topPaper!.year})` : ""}`),
        {
          instructions: (n) => `Is the paper of researcher ${n} genuinely research in the field "${field.name}"?`,
          criteria: { true: "In the field", false: "Not in the field" },
        },
        { decide, timeoutMs: 4000 }
      );
      return keep(people, scores);
    } catch {
      return people;
    }
  });

  const webTask = settle(source.web(topic), [] as ResearchLink[]).then(async (links) => {
    const scores = await relevance("research web", "Web pages", links.map((link) => `${link.title} (${link.site})${link.description ? `: ${link.description.slice(0, 200)}` : ""}`));
    return keep(links, scores).slice(0, 8);
  });

  const discussionsTask = settle(source.discussions(topic), [] as ResearchLink[]).then(async (links) => {
    const scores = await relevance("research discussions", "Online discussions", links.map((link) => `${link.title} (${link.site})`));
    return keep(links, scores, RELEVANT_DISCUSSION).slice(0, 6);
  });

  const [{ articles, overview: overviewSummary, checked: articlesChecked }, images, paperResult, experts, keptWeb, keptDiscussions] = await Promise.all([
    articlesTask,
    imagesTask,
    papersTask,
    expertsTask,
    webTask,
    discussionsTask,
  ]);
  const papers = paperResult.papers;

  return {
    query: topic,
    wiki,
    overview: overviewSummary
      ? { title: overviewSummary.title, description: overviewSummary.description, extract: overviewSummary.extract, image: overviewSummary.image?.src ?? overviewSummary.thumbnail }
      : null,
    articles: articles.slice(1, 7).map((article) => ({ title: article.title, description: article.description, thumbnail: article.thumbnail })),
    papers,
    paperCount: paperResult.count,
    experts,
    images,
    web: keptWeb,
    discussions: keptDiscussions,
    field: paperResult.field?.name ?? null,
    checked: check && (paperResult.checked || articlesChecked) ? "model" : "none",
    generatedAt: new Date().toISOString(),
  };
}

/** How sure the model must be of the field before the page names its leading researchers. */
const SURE_OF_FIELD = 0.5;

/**
 * The research field the topic belongs to, chosen by the decision model from the fields of the
 * papers found. Counting papers per field isn't enough: a topic's papers spread over many fields,
 * and two papers applying transformers to eye scans once made "Retinal Imaging" the largest.
 * Without the model, the field most of the relevant papers share is used, when at least 3 agree.
 */
async function chooseField(
  topic: string,
  fields: Map<string, ResearchField>,
  relevant: ResearchPaper[],
  check: boolean,
  decide: Decide
): Promise<ResearchField | null> {
  const candidates = [...new Map([...fields.values()].filter((field) => field.name).map((field) => [field.id, field])).values()];
  if (!candidates.length) return null;
  if (!check) return dominantField(relevant.map((paper) => paper.id), fields, 3);
  try {
    const answers = await decide(
      "research field",
      `A reader is researching "${topic}". These are the research fields of the papers found about it.`,
      {
        field: {
          type: "choice",
          instructions: `Which research field is "${topic}" mainly part of?`,
          criteria: Object.fromEntries(candidates.slice(0, 20).map((field) => [field.id, field.name])),
        },
      },
      { timeoutMs: 4000 }
    );
    const chosen = candidates.find((field) => field.id === answers.field.choice);
    return chosen && (answers.field.probabilities[answers.field.choice] ?? 0) >= SURE_OF_FIELD ? chosen : null;
  } catch (error) {
    console.error("[research] field:", error instanceof Error ? error.message : error);
    return dominantField(relevant.map((paper) => paper.id), fields, 3);
  }
}

/** The images that help explain the topic, as judged by a model that looks at each one. */
async function pickImages(topic: string, candidates: ImageCandidate[], check: boolean, decide: Decide, imageData: typeof imageAsData): Promise<ResearchImage[]> {
  const toImage = (candidate: ImageCandidate): ResearchImage => ({
    src: candidate.src,
    width: candidate.width,
    height: candidate.height,
    title: candidate.title,
    description: candidate.description,
    credit: candidate.credit,
    license: candidate.license,
    filePage: candidate.filePage,
  });
  if (!check || !candidates.length) return candidates.slice(0, 8).map(toImage);

  try {
    // An image the model can't look at can't be vouched for, so it isn't shown.
    const data = await Promise.all(candidates.map((candidate) => (candidate.judgeSrc ? imageData(candidate.judgeSrc) : Promise.resolve(null))));
    const usable = candidates.map((candidate, index) => ({ candidate, dataUrl: data[index] })).filter((item): item is { candidate: ImageCandidate; dataUrl: string } => Boolean(item.dataUrl));
    const scores = await decideEachImage(
      "research images",
      `Images found for a research page about "${topic}", numbered:`,
      usable.map((item) => ({ label: [item.candidate.title, item.candidate.description.slice(0, 160)].filter(Boolean).join(": "), dataUrl: item.dataUrl })),
      {
        instructions: (n) => `Does image ${n} help a reader understand ${topic} (a relevant photo, diagram, chart or structure, not something unrelated or decorative)?`,
        criteria: { true: "Relevant and useful", false: "Unrelated or not useful" },
      },
      { decide, timeoutMs: 8000 }
    );
    const kept = usable.filter((_, index) => (scores[index] ?? 0) >= RELEVANT_IMAGE).length;
    console.log(`[research] images for "${topic}": kept ${kept} of ${usable.length} (${candidates.length} found)`);
    if (process.env.RESEARCH_DEBUG) usable.forEach((item, index) => console.log(`  ${(scores[index] ?? 0).toFixed(2)} ${item.candidate.title.slice(0, 70)}`));
    return usable
      .map((item, index) => ({ item, score: scores[index] ?? 0 }))
      .filter((entry) => entry.score >= RELEVANT_IMAGE)
      .sort((a, b) => b.score - a.score)
      // Several files of the same subject (one building, one diagram) show once.
      .filter((entry, index, all) => all.findIndex((other) => imageKey(other.item.candidate.title) === imageKey(entry.item.candidate.title)) === index)
      .slice(0, 12)
      .map((entry) => toImage(entry.item.candidate));
  } catch (error) {
    console.error("[research] images:", error instanceof Error ? error.message : error);
    return candidates.slice(0, 8).map(toImage);
  }
}
