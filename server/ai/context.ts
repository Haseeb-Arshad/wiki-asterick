import * as cheerio from "cheerio";
import type { WikiArticle, WikiSection } from "../../shared/types.js";
import { normalizeWikiHost } from "../../shared/wiki.js";
import { HttpError } from "../http.js";
import { loadWebArticle } from "../web/routes.js";
import { loadWikiArticle } from "../wiki/routes.js";

export type ContextRef = { kind: "wiki"; wiki: string; title: string } | { kind: "web"; url: string };

export function readContextRef(value: unknown): ContextRef | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as Record<string, unknown>;
  if (ref.kind === "wiki" && typeof ref.wiki === "string" && typeof ref.title === "string") {
    const wiki = normalizeWikiHost(ref.wiki);
    if (!wiki || !ref.title.trim() || ref.title.length > 300) throw new HttpError(400, "Unknown article.");
    return { kind: "wiki", wiki, title: ref.title.trim() };
  }
  if (ref.kind === "web" && typeof ref.url === "string" && ref.url.length < 2000) {
    return { kind: "web", url: ref.url };
  }
  return null;
}

export async function loadArticle(ref: ContextRef): Promise<WikiArticle> {
  return ref.kind === "wiki" ? loadWikiArticle(ref.wiki, ref.title) : loadWebArticle(ref.url);
}

const STOP_WORDS = new Set(
  "the a an and or but of to in on at for with from by about as is are was were be been it its this that these those what which who whom whose when where why how does did do can could should would will shall may might must not no than then there their them they he she his her you your we our i me my article explain tell more please".split(
    " "
  )
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP_WORDS.has(word));
}

interface Chunk {
  title: string;
  text: string;
  order: number;
}

function sectionText(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  $("sup, .table-scroll, style, figure img").remove();
  const blocks = $("p, li, blockquote, dd, dt, figcaption, h3, h4")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return (blocks.length ? blocks : [$("div").text().replace(/\s+/g, " ").trim()]).join("\n");
}

function flatten(sections: WikiSection[], into: Chunk[] = []): Chunk[] {
  for (const section of sections) {
    into.push({ title: section.title, text: sectionText(section.html), order: into.length });
    flatten(section.subsections, into);
  }
  return into;
}

/**
 * Plain-text context for the model: the lead and infobox always, then the
 * sections that share the most words with the question, in reading order,
 * until the character budget runs out.
 */
export function buildContextText(article: WikiArticle, question: string, budget = 28_000): string {
  const chunks = flatten(article.sections);
  const wanted = new Set(terms(question));

  const scored = chunks.map((chunk) => {
    if (chunk.order === 0) return { chunk, score: Infinity };
    const words = terms(`${chunk.title} ${chunk.title} ${chunk.text}`);
    let score = 0;
    for (const word of words) if (wanted.has(word)) score += 1;
    // Normalise so long sections don't win just by length.
    return { chunk, score: score / Math.sqrt(words.length + 20) };
  });

  const picked: Chunk[] = [];
  let used = 0;
  const facts = article.infobox.map((row) => `${row.label}: ${row.value}`).join("\n");
  if (facts) used += facts.length;

  for (const { chunk } of [...scored].sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order)) {
    const cost = chunk.text.length + chunk.title.length + 8;
    if (used + cost > budget) {
      if (picked.length && used > budget * 0.8) break;
      continue;
    }
    picked.push(chunk);
    used += cost;
  }

  picked.sort((a, b) => a.order - b.order);
  const parts = [
    facts ? `Key facts:\n${facts}` : "",
    ...picked.map((chunk) => (chunk.title ? `## ${chunk.title}\n${chunk.text}` : chunk.text)),
  ].filter(Boolean);
  const omitted = chunks.length - picked.length;
  if (omitted > 0) parts.push(`(${omitted} other section${omitted === 1 ? "" : "s"} not included: ${chunks.filter((c) => !picked.includes(c) && c.title).map((c) => c.title).slice(0, 25).join("; ")})`);
  return parts.join("\n\n");
}
